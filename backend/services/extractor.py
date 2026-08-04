"""
extractor.py — Concept and relationship extractor for Passive Second Brain.

Takes a text chunk and uses the Groq LLM to extract structured concepts and
relationships. Validates extracted data against the schema before returning.

Requirements:
    8.3 (structured JSON with confidence)
    8.5 (log malformed, continue)
    9.3 (six valid edge types)
    9.4 (discard invalid types, log warning)
"""

import json
import logging
from dataclasses import dataclass, field
from typing import List, Optional

try:
    from backend.models.schemas import EdgeType
except ModuleNotFoundError:
    from models.schemas import EdgeType

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Valid edge type values (derived from EdgeType enum for fast lookup)
# ---------------------------------------------------------------------------
_VALID_EDGE_TYPES = {e.value for e in EdgeType}


# ---------------------------------------------------------------------------
# Internal dataclasses
# ---------------------------------------------------------------------------

@dataclass
class RawConcept:
    name: str
    domain: str
    summary: str
    confidence: float


@dataclass
class RawRelationship:
    from_concept: str
    to_concept: str
    type: str
    confidence: float


@dataclass
class ExtractionResult:
    concepts: List[RawConcept] = field(default_factory=list)
    relationships: List[RawRelationship] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Module-level singleton — lazy-initialised on first call so tests can mock
# ---------------------------------------------------------------------------
_groq_client = None


def _get_groq_client():
    """Return the shared GroqClient singleton, creating it on first call."""
    global _groq_client
    if _groq_client is None:
        try:
            from backend.services.groq_client import GroqClient
        except ModuleNotFoundError:
            from services.groq_client import GroqClient
        _groq_client = GroqClient()
    return _groq_client


# ---------------------------------------------------------------------------
# Validation helpers
# ---------------------------------------------------------------------------

def _validate_concept(raw: dict) -> Optional[RawConcept]:
    """
    Validate a raw concept dict from the LLM response.

    Returns a RawConcept if valid, None otherwise.
    """
    name = raw.get("name", "")
    domain = raw.get("domain", "")
    summary = raw.get("summary", "")
    confidence = raw.get("confidence")

    if not isinstance(name, str) or not name.strip():
        return None
    if not isinstance(domain, str) or not domain.strip():
        return None
    if not isinstance(summary, str) or not summary.strip():
        return None
    if not isinstance(confidence, (int, float)):
        return None
    confidence = float(confidence)
    if not (0.0 <= confidence <= 1.0):
        return None

    return RawConcept(
        name=name.strip(),
        domain=domain.strip(),
        summary=summary.strip(),
        confidence=confidence,
    )


def _validate_relationship(raw: dict) -> Optional[RawRelationship]:
    """
    Validate a raw relationship dict from the LLM response.

    Returns a RawRelationship if valid, None otherwise.
    Logs a warning and returns None for invalid 'type' values (requirement 9.4).
    """
    # The prompt uses "from" / "to" keys; support both "from"/"to" and
    # "from_concept"/"to_concept" for robustness.
    from_concept = raw.get("from") or raw.get("from_concept", "")
    to_concept = raw.get("to") or raw.get("to_concept", "")
    rel_type = raw.get("type", "")
    confidence = raw.get("confidence")

    if not isinstance(from_concept, str) or not from_concept.strip():
        return None
    if not isinstance(to_concept, str) or not to_concept.strip():
        return None
    if rel_type not in _VALID_EDGE_TYPES:
        logger.warning(
            "extractor: discarding relationship with invalid type %r "
            "(from=%r, to=%r)",
            rel_type,
            from_concept,
            to_concept,
        )
        return None
    if not isinstance(confidence, (int, float)):
        return None
    confidence = float(confidence)
    if not (0.0 <= confidence <= 1.0):
        return None

    return RawRelationship(
        from_concept=from_concept.strip(),
        to_concept=to_concept.strip(),
        type=rel_type,
        confidence=confidence,
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def extract_concepts(chunk: str, chunk_index: int = 0) -> ExtractionResult:
    """
    Extract concepts and relationships from a single text chunk.

    Calls the Groq LLM with the concept extraction system prompt and parses
    the JSON response. Validates each extracted item and discards invalid ones.

    Args:
        chunk:       The text chunk to process.
        chunk_index: Zero-based index of this chunk (used in log messages).

    Returns:
        An ExtractionResult containing validated concepts and relationships.
        Returns an empty ExtractionResult on LLM failure or malformed JSON.
    """
    try:
        from backend.prompts.extract import CONCEPT_EXTRACTION_SYSTEM_PROMPT
    except ModuleNotFoundError:
        from prompts.extract import CONCEPT_EXTRACTION_SYSTEM_PROMPT

    # --- Call the LLM -------------------------------------------------------
    try:
        client = _get_groq_client()
        raw_response = client.call(CONCEPT_EXTRACTION_SYSTEM_PROMPT, chunk)
    except Exception as exc:
        logger.error(
            "extractor: LLM call failed for chunk %d: %s",
            chunk_index,
            exc,
            exc_info=True,
        )
        return ExtractionResult()

    # --- Parse JSON ---------------------------------------------------------
    try:
        parsed = json.loads(raw_response)
    except (json.JSONDecodeError, ValueError):
        logger.warning(
            "extractor: malformed JSON response for chunk %d — skipping. "
            "Response prefix: %.200r",
            chunk_index,
            raw_response,
        )
        return ExtractionResult()

    if not isinstance(parsed, dict):
        logger.warning(
            "extractor: unexpected JSON root type (%s) for chunk %d — skipping.",
            type(parsed).__name__,
            chunk_index,
        )
        return ExtractionResult()

    # --- Validate concepts --------------------------------------------------
    concepts: List[RawConcept] = []
    for raw_concept in parsed.get("concepts", []):
        if not isinstance(raw_concept, dict):
            continue
        concept = _validate_concept(raw_concept)
        if concept is not None:
            concepts.append(concept)

    # --- Validate relationships ---------------------------------------------
    relationships: List[RawRelationship] = []
    for raw_rel in parsed.get("relationships", []):
        if not isinstance(raw_rel, dict):
            continue
        relationship = _validate_relationship(raw_rel)
        if relationship is not None:
            relationships.append(relationship)

    logger.debug(
        "extractor: chunk %d → %d concept(s), %d relationship(s)",
        chunk_index,
        len(concepts),
        len(relationships),
    )

    return ExtractionResult(concepts=concepts, relationships=relationships)


def extract_all_chunks(chunks: List[str]) -> ExtractionResult:
    """
    Extract concepts and relationships from a list of text chunks.

    Processes each chunk in sequence and merges all results into a single
    ExtractionResult.

    Args:
        chunks: List of text chunks to process.

    Returns:
        A merged ExtractionResult combining all chunks' concepts and
        relationships.
    """
    merged = ExtractionResult()
    for i, chunk in enumerate(chunks):
        result = extract_concepts(chunk, chunk_index=i)
        merged.concepts.extend(result.concepts)
        merged.relationships.extend(result.relationships)

    logger.debug(
        "extractor: processed %d chunk(s) → %d total concept(s), "
        "%d total relationship(s)",
        len(chunks),
        len(merged.concepts),
        len(merged.relationships),
    )

    return merged
