"""
Unit tests for services/extractor.py — concept and relationship extractor.

Requirements:
    8.3 (structured JSON with confidence)
    8.5 (log malformed, continue)
    9.3 (six valid edge types)
    9.4 (discard invalid types, log warning)
"""

import json
import logging
from unittest.mock import MagicMock, patch

import pytest

import services.extractor as extractor_module
from services.extractor import (
    ExtractionResult,
    RawConcept,
    RawRelationship,
    _validate_concept,
    _validate_relationship,
    extract_concepts,
    extract_all_chunks,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_VALID_CONCEPT_DICT = {
    "name": "Attention Mechanism",
    "domain": "Machine Learning",
    "summary": "A mechanism that allows neural networks to focus on relevant parts of input.",
    "confidence": 0.95,
}

_VALID_REL_DICT = {
    "from": "Transformer Architecture",
    "to": "Attention Mechanism",
    "type": "IS_PREREQUISITE_FOR",
    "confidence": 0.90,
}

_VALID_LLM_RESPONSE = json.dumps({
    "concepts": [_VALID_CONCEPT_DICT],
    "relationships": [_VALID_REL_DICT],
})


def _make_mock_client(response: str):
    """Return a mock GroqClient whose .call() returns *response*."""
    mock = MagicMock()
    mock.call.return_value = response
    return mock


# ---------------------------------------------------------------------------
# _validate_concept
# ---------------------------------------------------------------------------

class TestValidateConcept:
    def test_valid_concept_returns_dataclass(self):
        result = _validate_concept(_VALID_CONCEPT_DICT)
        assert isinstance(result, RawConcept)
        assert result.name == "Attention Mechanism"
        assert result.domain == "Machine Learning"
        assert result.confidence == 0.95

    def test_empty_name_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "name": ""}
        assert _validate_concept(bad) is None

    def test_whitespace_only_name_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "name": "   "}
        assert _validate_concept(bad) is None

    def test_missing_name_returns_none(self):
        bad = {k: v for k, v in _VALID_CONCEPT_DICT.items() if k != "name"}
        assert _validate_concept(bad) is None

    def test_empty_domain_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "domain": ""}
        assert _validate_concept(bad) is None

    def test_empty_summary_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "summary": ""}
        assert _validate_concept(bad) is None

    def test_confidence_below_zero_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "confidence": -0.1}
        assert _validate_concept(bad) is None

    def test_confidence_above_one_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "confidence": 1.01}
        assert _validate_concept(bad) is None

    def test_confidence_zero_is_valid(self):
        result = _validate_concept({**_VALID_CONCEPT_DICT, "confidence": 0.0})
        assert result is not None
        assert result.confidence == 0.0

    def test_confidence_one_is_valid(self):
        result = _validate_concept({**_VALID_CONCEPT_DICT, "confidence": 1.0})
        assert result is not None
        assert result.confidence == 1.0

    def test_confidence_as_int_is_accepted(self):
        result = _validate_concept({**_VALID_CONCEPT_DICT, "confidence": 1})
        assert result is not None
        assert result.confidence == 1.0

    def test_non_string_confidence_returns_none(self):
        bad = {**_VALID_CONCEPT_DICT, "confidence": "high"}
        assert _validate_concept(bad) is None


# ---------------------------------------------------------------------------
# _validate_relationship
# ---------------------------------------------------------------------------

class TestValidateRelationship:
    def test_valid_relationship_returns_dataclass(self):
        result = _validate_relationship(_VALID_REL_DICT)
        assert isinstance(result, RawRelationship)
        assert result.from_concept == "Transformer Architecture"
        assert result.to_concept == "Attention Mechanism"
        assert result.type == "IS_PREREQUISITE_FOR"
        assert result.confidence == 0.90

    def test_all_six_valid_edge_types_accepted(self):
        valid_types = [
            "IS_PREREQUISITE_FOR",
            "IS_SUBSET_OF",
            "EXTENDS",
            "CONTRADICTS",
            "IS_USED_IN",
            "CO_OCCURS_WITH",
        ]
        for edge_type in valid_types:
            raw = {**_VALID_REL_DICT, "type": edge_type}
            result = _validate_relationship(raw)
            assert result is not None, f"{edge_type} should be valid"
            assert result.type == edge_type

    def test_invalid_edge_type_returns_none_and_logs_warning(self, caplog):
        bad = {**_VALID_REL_DICT, "type": "KNOWS_ABOUT"}
        with caplog.at_level(logging.WARNING, logger="services.extractor"):
            result = _validate_relationship(bad)
        assert result is None
        assert "KNOWS_ABOUT" in caplog.text

    def test_empty_from_returns_none(self):
        bad = {**_VALID_REL_DICT, "from": ""}
        assert _validate_relationship(bad) is None

    def test_empty_to_returns_none(self):
        bad = {**_VALID_REL_DICT, "to": ""}
        assert _validate_relationship(bad) is None

    def test_confidence_out_of_range_returns_none(self):
        bad = {**_VALID_REL_DICT, "confidence": 2.5}
        assert _validate_relationship(bad) is None

    def test_from_concept_key_also_accepted(self):
        raw = {
            "from_concept": "A",
            "to_concept": "B",
            "type": "EXTENDS",
            "confidence": 0.8,
        }
        result = _validate_relationship(raw)
        assert result is not None
        assert result.from_concept == "A"
        assert result.to_concept == "B"


# ---------------------------------------------------------------------------
# extract_concepts
# ---------------------------------------------------------------------------

class TestExtractConcepts:
    def test_valid_response_returns_populated_result(self):
        with patch.object(extractor_module, "_groq_client", _make_mock_client(_VALID_LLM_RESPONSE)):
            result = extract_concepts("Some text about transformers.")
        assert len(result.concepts) == 1
        assert result.concepts[0].name == "Attention Mechanism"
        assert len(result.relationships) == 1
        assert result.relationships[0].type == "IS_PREREQUISITE_FOR"

    def test_malformed_json_returns_empty_result_and_logs_warning(self, caplog):
        with patch.object(extractor_module, "_groq_client", _make_mock_client("not valid json {")):
            with caplog.at_level(logging.WARNING, logger="services.extractor"):
                result = extract_concepts("chunk", chunk_index=3)
        assert result.concepts == []
        assert result.relationships == []
        assert "3" in caplog.text  # chunk_index in log

    def test_llm_exception_returns_empty_result_and_logs_error(self, caplog):
        mock_client = MagicMock()
        mock_client.call.side_effect = RuntimeError("Connection refused")
        with patch.object(extractor_module, "_groq_client", mock_client):
            with caplog.at_level(logging.ERROR, logger="services.extractor"):
                result = extract_concepts("chunk", chunk_index=7)
        assert result.concepts == []
        assert result.relationships == []
        assert "Connection refused" in caplog.text

    def test_invalid_concept_confidence_is_discarded(self):
        response = json.dumps({
            "concepts": [
                {**_VALID_CONCEPT_DICT, "confidence": 99.0},  # invalid
                _VALID_CONCEPT_DICT,  # valid
            ],
            "relationships": [],
        })
        with patch.object(extractor_module, "_groq_client", _make_mock_client(response)):
            result = extract_concepts("text")
        assert len(result.concepts) == 1

    def test_invalid_relationship_type_is_discarded_and_logged(self, caplog):
        response = json.dumps({
            "concepts": [],
            "relationships": [
                {**_VALID_REL_DICT, "type": "INVENTED_TYPE"},
                _VALID_REL_DICT,  # valid
            ],
        })
        with patch.object(extractor_module, "_groq_client", _make_mock_client(response)):
            with caplog.at_level(logging.WARNING, logger="services.extractor"):
                result = extract_concepts("text")
        assert len(result.relationships) == 1
        assert result.relationships[0].type == "IS_PREREQUISITE_FOR"
        assert "INVENTED_TYPE" in caplog.text

    def test_non_dict_json_root_returns_empty(self, caplog):
        with patch.object(extractor_module, "_groq_client", _make_mock_client('["list", "not", "dict"]')):
            with caplog.at_level(logging.WARNING, logger="services.extractor"):
                result = extract_concepts("text")
        assert result.concepts == []
        assert result.relationships == []

    def test_empty_concepts_and_relationships_lists(self):
        response = json.dumps({"concepts": [], "relationships": []})
        with patch.object(extractor_module, "_groq_client", _make_mock_client(response)):
            result = extract_concepts("very short text")
        assert result.concepts == []
        assert result.relationships == []

    def test_chunk_index_defaults_to_zero(self):
        with patch.object(extractor_module, "_groq_client", _make_mock_client(_VALID_LLM_RESPONSE)):
            result = extract_concepts("text")
        assert isinstance(result, ExtractionResult)

    def test_missing_concepts_key_treated_as_empty(self):
        response = json.dumps({"relationships": [_VALID_REL_DICT]})
        with patch.object(extractor_module, "_groq_client", _make_mock_client(response)):
            result = extract_concepts("text")
        assert result.concepts == []
        assert len(result.relationships) == 1

    def test_non_dict_items_in_lists_are_skipped(self):
        response = json.dumps({
            "concepts": ["not a dict", _VALID_CONCEPT_DICT],
            "relationships": [42, _VALID_REL_DICT],
        })
        with patch.object(extractor_module, "_groq_client", _make_mock_client(response)):
            result = extract_concepts("text")
        assert len(result.concepts) == 1
        assert len(result.relationships) == 1


# ---------------------------------------------------------------------------
# extract_all_chunks
# ---------------------------------------------------------------------------

class TestExtractAllChunks:
    def test_empty_chunks_returns_empty_result(self):
        result = extract_all_chunks([])
        assert result.concepts == []
        assert result.relationships == []

    def test_results_from_all_chunks_are_merged(self):
        response_a = json.dumps({
            "concepts": [_VALID_CONCEPT_DICT],
            "relationships": [],
        })
        response_b = json.dumps({
            "concepts": [
                {**_VALID_CONCEPT_DICT, "name": "Transformer Architecture"}
            ],
            "relationships": [_VALID_REL_DICT],
        })
        mock_client = MagicMock()
        mock_client.call.side_effect = [response_a, response_b]
        with patch.object(extractor_module, "_groq_client", mock_client):
            result = extract_all_chunks(["chunk one", "chunk two"])
        assert len(result.concepts) == 2
        assert len(result.relationships) == 1

    def test_single_chunk_behaves_like_extract_concepts(self):
        with patch.object(extractor_module, "_groq_client", _make_mock_client(_VALID_LLM_RESPONSE)):
            result = extract_all_chunks(["single chunk text"])
        assert len(result.concepts) == 1
        assert len(result.relationships) == 1

    def test_failed_chunk_does_not_abort_remaining_chunks(self):
        """A failed LLM call on chunk 0 must not prevent chunk 1 from processing."""
        mock_client = MagicMock()
        mock_client.call.side_effect = [
            RuntimeError("Network error"),  # chunk 0 fails
            _VALID_LLM_RESPONSE,            # chunk 1 succeeds
        ]
        with patch.object(extractor_module, "_groq_client", mock_client):
            result = extract_all_chunks(["bad chunk", "good chunk"])
        assert len(result.concepts) == 1  # only from chunk 1

    def test_malformed_json_chunk_does_not_abort_remaining_chunks(self):
        mock_client = MagicMock()
        mock_client.call.side_effect = [
            "{ broken json",   # chunk 0 malformed
            _VALID_LLM_RESPONSE,  # chunk 1 ok
        ]
        with patch.object(extractor_module, "_groq_client", mock_client):
            result = extract_all_chunks(["chunk 0", "chunk 1"])
        assert len(result.concepts) == 1

    def test_chunk_index_passed_correctly(self):
        """Verify each chunk receives the correct sequential index."""
        captured_indices = []
        original_extract = extractor_module.extract_concepts

        def spy_extract(chunk, chunk_index=0):
            captured_indices.append(chunk_index)
            return ExtractionResult()

        with patch.object(extractor_module, "extract_concepts", side_effect=spy_extract):
            extract_all_chunks(["a", "b", "c"])

        assert captured_indices == [0, 1, 2]
