"""
digest_gen.py — Daily learning digest generator for Passive Second Brain.

Generates a human-readable DigestEntry each night after the pipeline completes.
Uses Groq LLM to write a personalised summary of the day's learning activity.

Requirements:
    15.1 LLM generates digest after pipeline completes
    15.2 Digest includes new concepts, edges, domains, fading concepts
    15.3 Store with date timestamp in persistent local storage
    15.5 Retain 30 days of digests
    15.6 Digest failure must NOT abort the rest of the pipeline
"""

import json
import logging
import os
from datetime import date, datetime, timezone
from pathlib import Path
from typing import List, Optional

logger = logging.getLogger("psb.digest_gen")

DIGEST_DIR     = Path("data") / "digests"
DIGEST_RETAIN  = 30   # days to keep

# ---------------------------------------------------------------------------
# Lazy-init Groq client
# ---------------------------------------------------------------------------
_groq_client = None

def _get_groq_client():
    global _groq_client
    if _groq_client is None:
        try:
            from backend.services.groq_client import GroqClient
        except ModuleNotFoundError:
            from services.groq_client import GroqClient
        _groq_client = GroqClient()
    return _groq_client


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def generate_digest(pipeline_stats: dict) -> dict:
    """
    Generate and persist a daily learning digest.

    Args:
        pipeline_stats: Dict from run_pipeline() containing items_processed,
                        nodes_added, edges_added, etc.

    Returns:
        The DigestEntry dict that was saved, or a minimal error dict on failure.

    This function NEVER raises — all exceptions are caught and logged so the
    pipeline continues (Requirement 15.6).
    """
    today = date.today()
    digest_path = DIGEST_DIR / f"{today.isoformat()}.json"

    try:
        # Build stats summary for LLM
        nodes_added  = pipeline_stats.get("nodes_added", 0)
        edges_added  = pipeline_stats.get("edges_added", 0)
        items_done   = pipeline_stats.get("items_processed", 0)

        # Fetch fading concepts from graph (best-effort)
        fading_concepts: List[str] = []
        domains_covered: List[str] = []
        try:
            from backend.services.graph_db import Neo4jService
            from backend.services.sm2 import compute_forget_score
            graph_db = Neo4jService()
            all_nodes = graph_db.get_all_nodes(skip=0, limit=10_000)
            FORGETTING_THRESHOLD = float(os.environ.get("FORGETTING_THRESHOLD", "0.7"))
            for node in all_nodes:
                score = compute_forget_score(node)
                if score > FORGETTING_THRESHOLD:
                    fading_concepts.append(node.concept_id)
                if node.domain and node.domain not in domains_covered:
                    domains_covered.append(node.domain)
            graph_db.close()
        except Exception as exc:
            logger.warning("digest_gen: could not fetch graph data: %s", exc)

        # Generate summary text via Groq
        summary_text = ""
        try:
            from backend.prompts.digest import DIGEST_GENERATION_SYSTEM_PROMPT
        except ModuleNotFoundError:
            from prompts.digest import DIGEST_GENERATION_SYSTEM_PROMPT

        user_content = (
            f"Today's learning stats:\n"
            f"- New concepts added: {nodes_added}\n"
            f"- New relationships discovered: {edges_added}\n"
            f"- Sources processed: {items_done}\n"
            f"- Domains covered: {', '.join(domains_covered) or 'None'}\n"
            f"- Concepts approaching forgetting threshold: {len(fading_concepts)}\n"
        )

        try:
            client = _get_groq_client()
            summary_text = client.call(DIGEST_GENERATION_SYSTEM_PROMPT, user_content)
        except Exception as exc:
            logger.warning("digest_gen: LLM call failed, using fallback summary: %s", exc)
            summary_text = (
                f"Today you processed {items_done} source(s), adding {nodes_added} "
                f"new concept(s) and {edges_added} relationship(s) to your knowledge graph."
            )

        # Build DigestEntry dict
        digest_entry = {
            "date":               today.isoformat(),
            "new_concepts_count": nodes_added,
            "new_edges_count":    edges_added,
            "domains_covered":    domains_covered,
            "fading_concepts":    fading_concepts,
            "summary_text":       summary_text,
            "generated_at":       datetime.now(timezone.utc).isoformat(),
        }

        # Persist to disk (Requirement 15.3)
        DIGEST_DIR.mkdir(parents=True, exist_ok=True)
        digest_path.write_text(
            json.dumps(digest_entry, indent=2, ensure_ascii=False),
            encoding="utf-8",
        )
        logger.info("digest_gen: digest saved to %s", digest_path)

        # Prune old digests (keep last 30 days — Requirement 15.5)
        _prune_old_digests()

        return digest_entry

    except Exception as exc:
        logger.error(
            "digest_gen: digest generation failed (pipeline unaffected): %s",
            exc,
            exc_info=True,
        )
        return {"error": str(exc), "date": today.isoformat()}


def get_today_digest() -> Optional[dict]:
    """Return today's digest dict, or None if not yet generated."""
    path = DIGEST_DIR / f"{date.today().isoformat()}.json"
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None


def get_digest_history(days: int = 30) -> List[dict]:
    """Return the last `days` digest entries, newest first."""
    if not DIGEST_DIR.exists():
        return []
    digests = []
    for path in sorted(DIGEST_DIR.glob("*.json"), reverse=True)[:days]:
        try:
            digests.append(json.loads(path.read_text(encoding="utf-8")))
        except Exception:
            pass
    return digests


def _prune_old_digests() -> None:
    """Delete digest files older than DIGEST_RETAIN days."""
    if not DIGEST_DIR.exists():
        return
    all_files = sorted(DIGEST_DIR.glob("*.json"), reverse=True)
    for old_file in all_files[DIGEST_RETAIN:]:
        try:
            old_file.unlink()
            logger.debug("digest_gen: pruned old digest %s", old_file.name)
        except Exception:
            pass
