"""
digest.py — Daily learning digest REST API router for Passive Second Brain.

Endpoints:
  GET /digest/today     — return today's digest (404 if not yet generated)
  GET /digest/history   — return the last 30 digest entries

Requirements:
    15.4 Dashboard shows latest digest
    15.5 30-day access
"""

import logging
from fastapi import APIRouter, Depends, HTTPException, status

try:
    from backend.auth import verify_api_key
    from backend.services.digest_gen import get_today_digest, get_digest_history
except ModuleNotFoundError:
    from auth import verify_api_key
    from services.digest_gen import get_today_digest, get_digest_history

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/digest", tags=["digest"])


@router.get(
    "/today",
    summary="Get today's learning digest",
    dependencies=[Depends(verify_api_key)],
)
async def digest_today() -> dict:
    """
    Return the daily digest for today.

    Returns 404 if the nightly pipeline has not yet run or digest
    generation failed.
    """
    digest = get_today_digest()
    if digest is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No digest available for today. The nightly pipeline may not have run yet.",
        )
    return digest


@router.get(
    "/history",
    summary="Get digest history (last 30 days)",
    dependencies=[Depends(verify_api_key)],
)
async def digest_history(days: int = 30) -> dict:
    """
    Return the most recent *days* digest entries, newest first.

    Default is 30 days of history (Requirement 15.5).
    """
    if days < 1 or days > 365:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="days must be between 1 and 365.",
        )
    digests = get_digest_history(days=days)
    return {
        "count": len(digests),
        "digests": digests,
    }
