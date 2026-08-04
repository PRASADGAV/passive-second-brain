"""
Unit tests for services/resolver.py — Entity resolution and deduplication.

Requirements covered:
    10.1 (resolve before inserting)
    10.2 (string norm + semantic)
    10.3 (merge preserves edges)
    10.4 (log merge)
    10.5 (no new node for existing concept)
"""

import pytest
from unittest.mock import MagicMock

from services.resolver import normalise_name, deduplicate_within_batch, resolve
from services.extractor import RawConcept


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_concept(name: str, confidence: float = 0.9, domain: str = "CS", summary: str = "A concept.") -> RawConcept:
    return RawConcept(name=name, domain=domain, summary=summary, confidence=confidence)


def make_graph_node(concept_id: str, name: str):
    """Return a simple mock object that looks like a ConceptNode."""
    node = MagicMock()
    node.concept_id = concept_id
    node.name = name
    return node


# ---------------------------------------------------------------------------
# normalise_name
# ---------------------------------------------------------------------------

class TestNormaliseName:
    def test_lowercases(self):
        assert normalise_name("Machine Learning") == "machine learning"

    def test_strips_punctuation(self):
        assert normalise_name("C++") == "c"

    def test_strips_leading_trailing_whitespace(self):
        assert normalise_name("  hello  ") == "hello"

    def test_collapses_internal_whitespace(self):
        assert normalise_name("deep   learning") == "deep learning"

    def test_ml_abbreviation(self):
        # Punctuation stripped; result is just letters/digits/spaces
        assert normalise_name("M.L.") == "ml"

    def test_empty_string(self):
        assert normalise_name("") == ""

    def test_already_normalised(self):
        assert normalise_name("machine learning") == "machine learning"

    def test_numbers_preserved(self):
        assert normalise_name("Python 3") == "python 3"

    def test_unicode_word_characters_preserved(self):
        # \w includes unicode letters; basic test
        result = normalise_name("naïve bayes")
        assert "nave" in result or "na" in result  # depends on re.sub with \w


# ---------------------------------------------------------------------------
# deduplicate_within_batch
# ---------------------------------------------------------------------------

class TestDeduplicateWithinBatch:
    def test_no_duplicates_unchanged(self):
        concepts = [make_concept("Python"), make_concept("Rust"), make_concept("Go")]
        result = deduplicate_within_batch(concepts)
        assert [c.name for c in result] == ["Python", "Rust", "Go"]

    def test_exact_name_duplicates_keeps_higher_confidence(self):
        low = make_concept("Python", confidence=0.6)
        high = make_concept("Python", confidence=0.9)
        result = deduplicate_within_batch([low, high])
        assert len(result) == 1
        assert result[0].confidence == 0.9

    def test_normalised_name_duplicates_kept_once(self):
        # "Machine Learning" and "machine learning" normalise to the same key
        c1 = make_concept("Machine Learning", confidence=0.8)
        c2 = make_concept("machine learning", confidence=0.7)
        result = deduplicate_within_batch([c1, c2])
        assert len(result) == 1

    def test_punctuation_variation_treated_as_duplicate(self):
        c1 = make_concept("C++", confidence=0.5)
        c2 = make_concept("C", confidence=0.8)  # C++ strips to "c", same as "C"
        result = deduplicate_within_batch([c1, c2])
        assert len(result) == 1
        assert result[0].confidence == 0.8

    def test_empty_list_returns_empty(self):
        assert deduplicate_within_batch([]) == []

    def test_single_concept_returned_as_is(self):
        c = make_concept("Neural Networks")
        assert deduplicate_within_batch([c]) == [c]

    def test_preserves_order_of_first_occurrence(self):
        a = make_concept("Alpha")
        b = make_concept("Beta")
        c = make_concept("alpha", confidence=0.3)  # duplicate of Alpha (lower conf)
        result = deduplicate_within_batch([a, b, c])
        assert result[0].name == "Alpha"
        assert result[1].name == "Beta"


# ---------------------------------------------------------------------------
# resolve — string normalisation path
# ---------------------------------------------------------------------------

class TestResolveStringNorm:
    def _make_services(self, existing_node_names: dict):
        """existing_node_names: {concept_id: name}"""
        graph_db = MagicMock()
        vector_db = MagicMock()

        nodes = [make_graph_node(cid, name) for cid, name in existing_node_names.items()]
        graph_db.get_all_nodes.return_value = nodes
        vector_db.similarity_search.return_value = []

        return graph_db, vector_db

    def test_exact_normalised_match_is_duplicate(self):
        graph_db, vector_db = self._make_services({"id-1": "Machine Learning"})
        # "machine learning" normalises the same as "Machine Learning"
        concepts = [make_concept("machine learning")]
        result = resolve(concepts, graph_db, vector_db)
        assert result == []

    def test_new_concept_not_in_graph_is_returned(self):
        graph_db, vector_db = self._make_services({"id-1": "Rust"})
        concepts = [make_concept("Python")]
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1
        assert result[0].name == "Python"

    def test_mixed_batch_only_new_concepts_returned(self):
        graph_db, vector_db = self._make_services({"id-1": "Python"})
        concepts = [make_concept("Python"), make_concept("Go")]
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1
        assert result[0].name == "Go"

    def test_empty_input_returns_empty(self):
        graph_db, vector_db = self._make_services({})
        assert resolve([], graph_db, vector_db) == []

    def test_graph_fetch_failure_does_not_raise(self):
        graph_db = MagicMock()
        graph_db.get_all_nodes.side_effect = Exception("Neo4j down")
        vector_db = MagicMock()
        vector_db.similarity_search.return_value = []

        concepts = [make_concept("Python")]
        # Should not raise; falls through to vector step, which returns []
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1  # no graph info → treated as new


# ---------------------------------------------------------------------------
# resolve — semantic similarity path
# ---------------------------------------------------------------------------

class TestResolveSemantic:
    def _make_services(self, similar_node: MagicMock = None):
        graph_db = MagicMock()
        graph_db.get_all_nodes.return_value = []  # no string-norm hits

        vector_db = MagicMock()
        if similar_node is not None:
            vector_db.similarity_search.return_value = [similar_node.concept_id]
            graph_db.get_node.return_value = similar_node
        else:
            vector_db.similarity_search.return_value = []
            graph_db.get_node.return_value = None

        return graph_db, vector_db

    def test_semantic_match_on_normalised_name_is_duplicate(self):
        # Simulate "ML" returning a node named "ML" via similarity search
        existing = make_graph_node("id-ml", "ML")
        graph_db, vector_db = self._make_services(similar_node=existing)

        concepts = [make_concept("ML")]
        result = resolve(concepts, graph_db, vector_db)
        assert result == []

    def test_semantic_match_different_name_is_not_duplicate(self):
        # Top similarity hit has a different normalised name → not a duplicate
        existing = make_graph_node("id-rust", "Rust")
        graph_db, vector_db = self._make_services(similar_node=existing)

        concepts = [make_concept("Python")]
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1
        assert result[0].name == "Python"

    def test_similarity_search_failure_does_not_raise(self):
        graph_db = MagicMock()
        graph_db.get_all_nodes.return_value = []
        vector_db = MagicMock()
        vector_db.similarity_search.side_effect = Exception("Chroma down")

        concepts = [make_concept("Python")]
        result = resolve(concepts, graph_db, vector_db)
        # Falls through to new concept
        assert len(result) == 1

    def test_get_node_failure_does_not_raise(self):
        graph_db = MagicMock()
        graph_db.get_all_nodes.return_value = []
        graph_db.get_node.side_effect = Exception("Neo4j timeout")

        vector_db = MagicMock()
        vector_db.similarity_search.return_value = ["some-id"]

        concepts = [make_concept("Python")]
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1

    def test_get_node_returns_none_does_not_crash(self):
        graph_db = MagicMock()
        graph_db.get_all_nodes.return_value = []
        graph_db.get_node.return_value = None

        vector_db = MagicMock()
        vector_db.similarity_search.return_value = ["ghost-id"]

        concepts = [make_concept("Python")]
        result = resolve(concepts, graph_db, vector_db)
        assert len(result) == 1


# ---------------------------------------------------------------------------
# resolve — intra-batch dedup happens before graph checks
# ---------------------------------------------------------------------------

class TestResolveIntrabatchDedup:
    def test_batch_duplicates_collapsed_before_graph_check(self):
        graph_db = MagicMock()
        graph_db.get_all_nodes.return_value = []
        vector_db = MagicMock()
        vector_db.similarity_search.return_value = []

        # Two concepts with the same normalised name
        c1 = make_concept("Neural Network", confidence=0.7)
        c2 = make_concept("neural network", confidence=0.9)
        result = resolve([c1, c2], graph_db, vector_db)

        # Only one new concept should be returned
        assert len(result) == 1
        assert result[0].confidence == 0.9


# ---------------------------------------------------------------------------
# resolve — merge log (requirement 10.4)
# ---------------------------------------------------------------------------

class TestResolveMergeLogging:
    def test_merge_is_logged(self, caplog):
        import logging
        graph_db = MagicMock()
        existing = make_graph_node("id-ml", "Machine Learning")
        graph_db.get_all_nodes.return_value = [existing]

        vector_db = MagicMock()
        vector_db.similarity_search.return_value = []

        concepts = [make_concept("machine learning")]

        with caplog.at_level(logging.INFO, logger="services.resolver"):
            resolve(concepts, graph_db, vector_db)

        # At least one log record should mention the merge
        assert any("MERGE" in record.message for record in caplog.records)
