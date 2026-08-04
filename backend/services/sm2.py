"""
sm2.py — SM-2 Spaced Repetition algorithm for Passive Second Brain.

Computes forget_score for every ConceptNode using exponential decay based on
the SM-2 algorithm (the algorithm that powers Anki flashcards), adapted for
graph nodes updated passively from real learning behaviour.

Formula:
    retention    = exp(-days_since_seen / (rep_interval * ease_factor))
    forget_score = round(1 - retention, 4)
    Result ∈ [0.0, 1.0]  where 0 = just seen (fresh), 1 = likely forgotten

SM-2 update rules (from SuperMemo):
    quality grades 0-5  (5 = perfect recall, 0 = complete blackout)
    ease_factor ∈ [1.3, 5.0]
    rep_interval grows multiplicatively with ease_factor on each successful review

Requirements:
    13.1 Recalculate every node nightly
    13.2 SM-2 formula with exponential decay
    13.3 Update ease_factor, rep_interval, rep_count, forget_score
    13.4 forget_score ∈ [0.0, 1.0]
    13.5 Re-encounter = successful review event
"""

import math
import logging
from datetime import datetime, timezone
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    try:
        from backend.models.schemas import ConceptNode
    except ModuleNotFoundError:
        from models.schemas import ConceptNode

logger = logging.getLogger("psb.sm2")


# ---------------------------------------------------------------------------
# Core formula
# ---------------------------------------------------------------------------

def compute_forget_score(node) -> float:
    """
    Compute the forgetting score for a ConceptNode using exponential decay.

    forget_score = round(1 - exp(-days_since_seen / (rep_interval * ease_factor)), 4)

    Args:
        node: A ConceptNode (or any object with last_seen, rep_interval, ease_factor).

    Returns:
        Float in [0.0, 1.0]. 0.0 = very fresh, 1.0 = completely forgotten.
    """
    try:
        now = datetime.now(timezone.utc)

        # Handle both timezone-aware and naive datetimes
        last_seen = node.last_seen
        if hasattr(last_seen, 'tzinfo') and last_seen.tzinfo is None:
            last_seen = last_seen.replace(tzinfo=timezone.utc)

        days_since_seen = max(0.0, (now - last_seen).total_seconds() / 86400.0)

        rep_interval = max(1, node.rep_interval)
        ease_factor  = max(1.3, min(5.0, node.ease_factor))

        retention    = math.exp(-days_since_seen / (rep_interval * ease_factor))
        forget_score = 1.0 - retention

        return round(min(1.0, max(0.0, forget_score)), 4)

    except Exception as exc:
        logger.warning("sm2.compute_forget_score failed for node %s: %s",
                       getattr(node, 'concept_id', '?'), exc)
        return 0.0


# ---------------------------------------------------------------------------
# SM-2 update after review
# ---------------------------------------------------------------------------

def update_sm2_on_review(node, quality: int = 4) -> dict:
    """
    Update SM-2 parameters after a review event.

    Args:
        node:    A ConceptNode object (or any object with ease_factor,
                 rep_interval, rep_count).
        quality: Review quality grade 0-5.
                 5 = perfect recall, 4 = correct with hesitation,
                 3 = correct with difficulty, < 3 = failed.

    Returns:
        Dict with updated: ease_factor, rep_interval, rep_count, last_seen.
        Caller is responsible for writing these values back to the node/DB.

    SM-2 rules:
        if quality >= 3 (passed):
            rep_count 0 → interval = 1
            rep_count 1 → interval = 6
            rep_count > 1 → interval = round(prev_interval * ease_factor)
            rep_count += 1
        if quality < 3 (failed):
            rep_count = 0, interval = 1 (reset)
        ease_factor = max(1.3, ef + 0.1 - (5-q)*(0.08 + (5-q)*0.02))
    """
    quality = max(0, min(5, int(quality)))

    ef = max(1.3, min(5.0, float(node.ease_factor)))
    ri = max(1, int(node.rep_interval))
    rc = max(0, int(node.rep_count))

    # Update ease factor (always, regardless of pass/fail)
    ef_delta = 0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)
    ef = max(1.3, min(5.0, ef + ef_delta))

    if quality >= 3:
        # Successful review
        if rc == 0:
            ri = 1
        elif rc == 1:
            ri = 6
        else:
            ri = max(1, round(ri * ef))
        rc += 1
    else:
        # Failed review — reset
        rc = 0
        ri = 1

    return {
        "ease_factor":  round(ef, 4),
        "rep_interval": ri,
        "rep_count":    rc,
        "last_seen":    datetime.now(timezone.utc).isoformat(),
    }
