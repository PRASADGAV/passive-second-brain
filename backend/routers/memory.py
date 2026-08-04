"""
memory.py — Memory alerts and SM-2 review router for Passive Second Brain.

Endpoints:
  GET  /memory/alerts         — list concepts above forgetting threshold
  POST /memory/review/{id}    — record a review event for a concept

Requirements:
    14.1 Identify nodes below threshold
    14.3 Record view as review event
    14.4 Configurable threshold
"""

import logging
import os
from fastapi import APIRouter, Depends, HTTPException, Request, status

try:
    from backend.auth import verify_api_key
    from backend.services.sm2 import compute_forget_score, update_sm2_on_review
except ModuleNotFoundError:
    from auth import verify_api_key
    from services.sm2 import compute_forget_score, update_sm2_on_review

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/memory", tags=["memory"])

DEFAULT_THRESHOLD = float(os.environ.get("FORGETTING_THRESHOLD", "0.7"))


@router.get(
    "/alerts",
    summary="List concepts approaching or past forgetting threshold",
    dependencies=[Depends(verify_api_key)],
)
async def memory_alerts(
    request: Request,
    threshold: float = DEFAULT_THRESHOLD,
) -> dict:
    """
    Return all ConceptNodes whose ``forget_score`` exceeds *threshold*.

    Default threshold is 0.7 (configurable via query param or
    ``FORGETTING_THRESHOLD`` env var).
    """
    if threshold < 0.0 or threshold > 1.0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="threshold must be between 0.0 and 1.0.",
        )

    fading_nodes = request.app.state.neo4j.get_fading_nodes(threshold=threshold)

    # Re-compute live forget scores for accuracy
    alerts = []
    for node in fading_nodes:
        live_score = compute_forget_score(node)
        if live_score > threshold:
            alerts.append({
                "concept_id": node.concept_id,
                "name": node.name,
                "domain": node.domain,
                "forget_score": live_score,
                "last_seen": node.last_seen.isoformat() if hasattr(node.last_seen, 'isoformat') else str(node.last_seen),
                "ease_factor": node.ease_factor,
                "rep_interval": node.rep_interval,
            })

    # Sort by forget_score descending (most forgotten first)
    alerts.sort(key=lambda x: x["forget_score"], reverse=True)

    return {
        "threshold": threshold,
        "count": len(alerts),
        "alerts": alerts,
    }


@router.post(
    "/review/{concept_id}",
    summary="Record a review event for a concept",
    dependencies=[Depends(verify_api_key)],
)
async def review_concept(concept_id: str, request: Request) -> dict:
    """
    Treat viewing a concept as a successful review event.

    Updates SM-2 fields (ease_factor, rep_interval, rep_count, last_seen)
    and recalculates the forget_score.

    Requirement 14.3: record view as review event.
    """
    node = request.app.state.neo4j.get_node(concept_id)
    if node is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Concept '{concept_id}' not found.",
        )

    # Compute SM-2 update (quality=4 — correct with slight hesitation)
    sm2_result = update_sm2_on_review(node, quality=4)

    # Write updated fields back to Neo4j
    request.app.state.neo4j.update_node_sm2_fields(concept_id, sm2_result)

    # Recompute forget score after update
    # Create a mock node-like object with updated fields for scoring
    class _Updated:
        last_seen = sm2_result["last_seen"]
        rep_interval = sm2_result["rep_interval"]
        ease_factor = sm2_result["ease_factor"]

    # Just-reviewed — score should be near 0
    from datetime import datetime, timezone
    _updated = _Updated()
    _updated.last_seen = datetime.fromisoformat(sm2_result["last_seen"])
    new_score = compute_forget_score(_updated)

    # Update forget_score in graph
    request.app.state.neo4j.batch_update_forget_scores(
        [{"concept_id": concept_id, "forget_score": new_score}]
    )

    logger.info(
        "memory.review: concept %s reviewed (new ef=%.4f ri=%d rc=%d score=%.4f)",
        concept_id,
        sm2_result["ease_factor"],
        sm2_result["rep_interval"],
        sm2_result["rep_count"],
        new_score,
    )

    return {
        "concept_id": concept_id,
        "status": "reviewed",
        "updated": {
            "ease_factor": sm2_result["ease_factor"],
            "rep_interval": sm2_result["rep_interval"],
            "rep_count": sm2_result["rep_count"],
            "forget_score": new_score,
        },
    }
