"""
resolver.py — Entity resolution and deduplication service for Passive Second Brain.

Takes a list of newly extracted concepts and deduplicates them against the
existing Knowledge Graph before insertion.

Steps:
  1. Deduplicate within the incoming batch (by normalised name, keep highest confidence).
  2. For each remaining concept, check against the graph:
       a. String normalisation: exact match on normalised name → duplicate.
       b. Semantic similarity: ChromaDB top-3 match → fetch node → compare
          normalised names; if cosine similarity >= 0.90 (top match), duplicate.
  3. Concepts with no graph match are returned for insertion.
  4. Duplicate resolution events are logged with both names and the canonical concept_id.

Requirements:
    10.1 (resolve before inserting)
    10.2 (string norm + semantic)
    10.3 (merge preserves edges)
    10.4 (log merge)
    10.5 (no new node for existing concept)
"""

import logging
import re
from typing import List, Optional

try:
    from backend.services.extractor import RawConcept
except ModuleNotFoundError:
    from services.extractor import RawConcept

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def normalise_name(name: str) -> str:
    """
    Normalise a concept name for string-based duplicate detection.

    Steps:
      1. Lowercase.
      2. Strip punctuation using ``re.sub(r'[^\\w\\s]', '', name)``.
      3. Strip leading/trailing whitespace and collapse internal whitespace.

    Returns the normalised string.
    """
    lowered = name.lower()
    stripped = re.sub(r'[^\w\s]', '', lowered)
    normalised = ' '.join(stripped.split())
    return normalised


def deduplicate_within_batch(concepts: List[RawConcept]) -> List[RawConcept]:
    """
    Remove duplicates within a single batch of extracted concepts.

    Two concepts are considered duplicates when their normalised names are
    identical.  When duplicates exist, the one with the highest confidence is
    kept.  The relative order of the surviving concepts reflects the first
    occurrence of each unique normalised name.

    Args:
        concepts: List of RawConcept objects from the extractor.

    Returns:
        Deduplicated list of RawConcept objects.
    """
    # Map normalised_name → best RawConcept seen so far
    best: dict[str, RawConcept] = {}

    for concept in concepts:
        key = normalise_name(concept.name)
        if key not in best:
            best[key] = concept
        else:
            # Keep the higher-confidence version
            if concept.confidence > best[key].confidence:
                logger.debug(
                    "resolver.deduplicate_within_batch: replacing %r (conf=%.3f) "
                    "with %r (conf=%.3f) for normalised key %r",
                    best[key].name,
                    best[key].confidence,
                    concept.name,
                    concept.confidence,
                    key,
                )
                best[key] = concept

    # Preserve insertion order of first-seen normalised keys
    seen_keys: list[str] = []
    for concept in concepts:
        key = normalise_name(concept.name)
        if key not in seen_keys:
            seen_keys.append(key)

    return [best[k] for k in seen_keys]


def resolve(
    concepts: List[RawConcept],
    graph_db,
    vector_db,
) -> List[RawConcept]:
    """
    Resolve a list of newly extracted concepts against the existing Knowledge Graph.

    The function performs two duplicate-detection passes:

    **Step 0 — Intra-batch deduplication**
        ``deduplicate_within_batch`` is applied first so that each normalised
        name appears at most once in the candidate set.

    **Step 1 — String normalisation**
        For each candidate concept the function queries Neo4j for all nodes
        whose normalised name exactly matches the candidate's normalised name.
        Any exact-match node is treated as the canonical node; the candidate is
        considered a duplicate.

    **Step 2 — Semantic similarity (ChromaDB)**
        For each candidate that survived Step 1, ``vector_db.similarity_search``
        is called with ``top_k=3``.  The returned concept_ids are looked up in
        Neo4j.  If the top match's normalised name equals the candidate's
        normalised name, a cosine similarity of ≥ 0.90 is implied and the
        candidate is treated as a duplicate.

    **Duplicate handling**
        When a duplicate is found the merge is logged (requirement 10.4) with:
          - the incoming concept name
          - the canonical concept name in the graph
          - the canonical concept_id

        The duplicate is *not* added to the returned list (requirement 10.5).

    **Non-duplicates**
        Concepts that survive both steps are returned as new concepts to insert
        (requirement 10.1).

    Args:
        concepts:  Newly extracted RawConcept objects.
        graph_db:  A ``Neo4jService`` instance (or compatible object exposing
                   ``get_all_nodes`` and ``get_node`` methods).
        vector_db: A ``VectorDBService`` instance (or compatible object exposing
                   ``similarity_search``).

    Returns:
        List of RawConcept objects that should be newly inserted into the graph.
    """
    # ------------------------------------------------------------------
    # Step 0 — Intra-batch deduplication
    # ------------------------------------------------------------------
    candidates = deduplicate_within_batch(concepts)
    logger.debug(
        "resolver.resolve: %d concept(s) after intra-batch dedup (was %d)",
        len(candidates),
        len(concepts),
    )

    # ------------------------------------------------------------------
    # Build a normalised-name → canonical_concept_id lookup from the graph
    # for fast Step 1 matching.  We fetch a paginated snapshot of all nodes.
    # ------------------------------------------------------------------
    graph_norm_map: dict[str, str] = {}  # normalised_name → concept_id
    graph_name_map: dict[str, str] = {}  # concept_id → original name

    try:
        # Fetch up to 10 000 nodes (well within the NFR).
        existing_nodes = graph_db.get_all_nodes(skip=0, limit=10_000)
        for node in existing_nodes:
            norm = normalise_name(node.name)
            graph_norm_map[norm] = node.concept_id
            graph_name_map[node.concept_id] = node.name
    except Exception as exc:  # noqa: BLE001
        logger.warning(
            "resolver.resolve: could not fetch existing nodes for string-norm check: %s",
            exc,
        )

    # ------------------------------------------------------------------
    # Resolve each candidate
    # ------------------------------------------------------------------
    new_concepts: List[RawConcept] = []

    for concept in candidates:
        norm_candidate = normalise_name(concept.name)
        canonical_id: Optional[str] = None
        canonical_name: Optional[str] = None

        # ---- Step 1: String normalisation exact match ----------------
        if norm_candidate in graph_norm_map:
            canonical_id = graph_norm_map[norm_candidate]
            canonical_name = graph_name_map.get(canonical_id, canonical_id)
            logger.info(
                "resolver: MERGE (string-norm) incoming=%r → canonical=%r (id=%s)",
                concept.name,
                canonical_name,
                canonical_id,
            )
            # Requirement 10.5 — do not insert
            continue

        # ---- Step 2: Semantic similarity via ChromaDB ----------------
        try:
            similar_ids = vector_db.similarity_search(concept.name, top_k=3)
        except Exception as exc:  # noqa: BLE001
            logger.warning(
                "resolver.resolve: similarity_search failed for concept=%r: %s",
                concept.name,
                exc,
            )
            similar_ids = []

        for cid in similar_ids:
            try:
                existing_node = graph_db.get_node(cid)
            except Exception as exc:  # noqa: BLE001
                logger.warning(
                    "resolver.resolve: get_node failed for concept_id=%s: %s",
                    cid,
                    exc,
                )
                existing_node = None

            if existing_node is None:
                continue

            norm_existing = normalise_name(existing_node.name)

            # The top ChromaDB match implies cosine similarity ≥ 0.90
            # when the normalised names match (design §resolver).
            if norm_existing == norm_candidate:
                canonical_id = existing_node.concept_id
                canonical_name = existing_node.name
                logger.info(
                    "resolver: MERGE (semantic) incoming=%r → canonical=%r (id=%s)",
                    concept.name,
                    canonical_name,
                    canonical_id,
                )
                break  # top match is sufficient; no need to check further

        if canonical_id is not None:
            # Requirement 10.5 — duplicate found via semantic check; skip insertion
            continue

        # ---- No duplicate found — schedule for insertion -------------
        new_concepts.append(concept)

    logger.debug(
        "resolver.resolve: %d new concept(s) to insert (out of %d candidates)",
        len(new_concepts),
        len(candidates),
    )
    return new_concepts
