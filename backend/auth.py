"""
auth.py — API key authentication dependency for Passive Second Brain.

Extracted here to avoid circular imports between main.py and routers.

Usage:
    from backend.auth import verify_api_key
    ...
    @router.get("/protected", dependencies=[Depends(verify_api_key)])
"""

import logging
import os

from fastapi import HTTPException, Security, status
from fastapi.security import APIKeyHeader

logger = logging.getLogger("psb.auth")

_api_key_header = APIKeyHeader(name="X-API-Key", auto_error=False)


async def verify_api_key(api_key: str = Security(_api_key_header)) -> str:
    """Validate the X-API-Key header against PSB_API_KEY from the environment.

    Returns the validated key on success.
    Raises HTTP 401 if the header is missing or the key does not match.
    """
    expected_key = os.getenv("PSB_API_KEY", "")
    if not expected_key:
        logger.warning("PSB_API_KEY is not set; denying all authenticated requests")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="API key not configured on server.",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    if not api_key or api_key != expected_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid X-API-Key header.",
            headers={"WWW-Authenticate": "ApiKey"},
        )
    return api_key
