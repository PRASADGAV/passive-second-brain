"""
Property tests for services/extractor.py

Property 10: Concept Extraction Response Schema Validity
    Assert every concept has non-empty name/domain/summary and confidence in [0.0, 1.0].

Property 11: Relationship Type Validation
    Use st.text() for relationship type field; assert types outside the six valid
    values are discarded and not inserted.

# Feature: passive-second-brain, Property 10: extraction response schema validity
# Feature: passive-second-brain, Property 11: relationship type validation

Requirements: 8.3, 8.4, 9.3
"""

import json
from unittest.mock import MagicMock, patch

from hypothesis import given, settings, assume
from hypothesis import strategies as st

import services.extractor as extractor_module
from services.extractor import (
    ExtractionResult,
    RawConcept,
    _validate_concept,
    _validate_relationship,
    extract_concepts,
)
from models.schemas import EdgeType

# The six valid edge types
_VALID_EDGE_TYPES = {e.value for e in EdgeType}


# ---------------------------------------------------------------------------
# Strategies for generating valid and invalid concept dicts
# ---------------------------------------------------------------------------

_valid_concept_strategy = st.fixed_dictionaries({
    "name": st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
    "domain": st.text(min_size=1, max_size=50).filter(lambda s: s.strip()),
    "summary": st.text(min_size=1, max_size=200).filter(lambda s: s.strip()),
    "confidence": st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
})

_valid_edge_type = st.sampled_from(list(_VALID_EDGE_TYPES))

_valid_relationship_strategy = st.fixed_dictionaries({
    "from": st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
    "to": st.text(min_size=1, max_size=100).filter(lambda s: s.strip()),
    "type": _valid_edge_type,
    "confidence": st.floats(min_value=0.0, max_value=1.0, allow_nan=False),
})


def _make_mock_client(response: str):
    mock = MagicMock()
    mock.call.return_value = response
    return mock


# ---------------------------------------------------------------------------
# Property 10: Concept Extraction Response Schema Validity
# ---------------------------------------------------------------------------

class TestProperty10ExtractionSchema:
    """
    # Feature: passive-second-brain, Property 10: extraction response schema validity
    # Validates: Requirements 8.3, 8.4
    """

    @given(concept=_valid_concept_strategy)
    @settings(max_examples=100)
    def test_valid_concept_passes_validation(self, concept: dict):
        """Any concept with non-empty name/domain/summary and confidence in [0,1]
        must pass validation."""
        result = _validate_concept(concept)
        assert result is not None
        assert result.name.strip() != ""
        assert result.domain.strip() != ""
        assert result.summary.strip() != ""
        assert 0.0 <= result.confidence <= 1.0

    @given(
        concepts=st.lists(_valid_concept_strategy, min_size=1, max_size=5),
        relationships=st.lists(_valid_relationship_strategy, min_size=0, max_size=3),
    )
    @settings(max_examples=100)
    def test_extraction_result_schema_validity(self, concepts, relationships):
        """
        When the LLM returns valid JSON with proper concepts and relationships,
        every concept in the ExtractionResult must have:
          - non-empty name, domain, summary
          - confidence in [0.0, 1.0]
        """
        llm_response = json.dumps({
            "concepts": concepts,
            "relationships": relationships,
        })

        with patch.object(extractor_module, "_groq_client", _make_mock_client(llm_response)):
            result = extract_concepts("test chunk")

        for c in result.concepts:
            assert isinstance(c, RawConcept)
            assert c.name.strip() != "", "Concept name must be non-empty"
            assert c.domain.strip() != "", "Concept domain must be non-empty"
            assert c.summary.strip() != "", "Concept summary must be non-empty"
            assert 0.0 <= c.confidence <= 1.0, (
                f"Confidence {c.confidence} out of [0.0, 1.0]"
            )

    @given(
        confidence=st.floats().filter(
            lambda f: f < 0.0 or f > 1.0
        ).filter(lambda f: not (f != f)),  # exclude NaN
    )
    @settings(max_examples=100)
    def test_invalid_confidence_rejected(self, confidence: float):
        """Concepts with confidence outside [0.0, 1.0] must be rejected."""
        concept = {
            "name": "Test Concept",
            "domain": "Test",
            "summary": "A concept.",
            "confidence": confidence,
        }
        result = _validate_concept(concept)
        assert result is None, (
            f"Concept with confidence={confidence} should be rejected"
        )


# ---------------------------------------------------------------------------
# Property 11: Relationship Type Validation
# ---------------------------------------------------------------------------

class TestProperty11RelationshipType:
    """
    # Feature: passive-second-brain, Property 11: relationship type validation
    # Validates: Requirements 9.3
    """

    @given(rel_type=st.text(min_size=1, max_size=50))
    @settings(max_examples=100)
    def test_invalid_edge_type_is_discarded(self, rel_type: str):
        """
        Any relationship type that is NOT one of the six valid EdgeType values
        must be discarded (return None from _validate_relationship).
        """
        assume(rel_type not in _VALID_EDGE_TYPES)

        raw = {
            "from": "Concept A",
            "to": "Concept B",
            "type": rel_type,
            "confidence": 0.9,
        }
        result = _validate_relationship(raw)
        assert result is None, (
            f"Relationship with invalid type {rel_type!r} should be discarded"
        )

    @given(rel_type=_valid_edge_type)
    @settings(max_examples=100)
    def test_valid_edge_type_is_accepted(self, rel_type: str):
        """All six valid edge types must be accepted."""
        raw = {
            "from": "Concept A",
            "to": "Concept B",
            "type": rel_type,
            "confidence": 0.9,
        }
        result = _validate_relationship(raw)
        assert result is not None, (
            f"Relationship with valid type {rel_type!r} should be accepted"
        )
        assert result.type == rel_type

    @given(
        invalid_types=st.lists(
            st.text(min_size=1, max_size=30).filter(lambda t: t not in _VALID_EDGE_TYPES),
            min_size=1,
            max_size=5,
        )
    )
    @settings(max_examples=100)
    def test_invalid_types_not_in_extraction_result(self, invalid_types: list):
        """
        When the LLM returns relationships with invalid types alongside valid
        ones, the invalid types must not appear in the ExtractionResult.
        """
        relationships = []
        for inv_type in invalid_types:
            relationships.append({
                "from": "A",
                "to": "B",
                "type": inv_type,
                "confidence": 0.8,
            })
        # Add one valid relationship
        relationships.append({
            "from": "A",
            "to": "B",
            "type": "EXTENDS",
            "confidence": 0.9,
        })

        llm_response = json.dumps({
            "concepts": [],
            "relationships": relationships,
        })

        with patch.object(extractor_module, "_groq_client", _make_mock_client(llm_response)):
            result = extract_concepts("text")

        # Only valid types should survive
        for rel in result.relationships:
            assert rel.type in _VALID_EDGE_TYPES, (
                f"Invalid type {rel.type!r} was not discarded"
            )
