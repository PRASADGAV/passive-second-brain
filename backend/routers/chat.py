"""
chat.py — Chat REST API router for Passive Second Brain.

Endpoints:
  POST /chat — submit a question and receive a grounded RAG answer

Requirements:
    16.1 Chat interface API
    16.4 Source citations in response
    16.5 ≤ 3s response time
    16.6 Multi-turn session context
"""

import json
import logging
import os
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel

try:
    from backend.auth import verify_api_key
    from backend.services.rag import query as rag_query
except ModuleNotFoundError:
    from auth import verify_api_key
    from services.rag import query as rag_query

logger = logging.getLogger(__name__)

router = APIRouter(tags=["chat"])

# ---------------------------------------------------------------------------
# Session store — in-memory with disk persistence
#
# Sessions are written to data/sessions/<session_id>.json so multi-turn
# conversation history survives server restarts (common on the free Render tier
# which spins down after 15 minutes of inactivity).
# ---------------------------------------------------------------------------
_sessions: dict[str, list[dict]] = {}
MAX_SESSION_TURNS = 10

# Directory for persisted session files.
# Resolves to <repo_root>/data/sessions locally and /app/data/sessions on Render.
# Falls back gracefully — _save_session never raises.
_SESSION_DIR = Path(os.environ.get("PSB_DATA_DIR", Path(__file__).resolve().parent.parent / "data")) / "sessions"


def _session_path(session_id: str) -> Path:
    return _SESSION_DIR / f"{session_id}.json"


def _load_session(session_id: str) -> list[dict]:
    """Load session history from disk, or return empty list if not found."""
    path = _session_path(session_id)
    try:
        if path.exists():
            return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        logger.warning("chat: failed to load session %s from disk: %s", session_id, exc)
    return []


def _save_session(session_id: str, history: list[dict]) -> None:
    """Persist session history to disk. Silently swallows write errors."""
    try:
        _SESSION_DIR.mkdir(parents=True, exist_ok=True)
        _session_path(session_id).write_text(
            json.dumps(history, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    except Exception as exc:
        logger.warning("chat: failed to save session %s to disk: %s", session_id, exc)


class ChatRequest(BaseModel):
    query: str
    session_id: Optional[str] = None


class ChatResponse(BaseModel):
    answer: str
    citations: list
    session_id: str
    latency_ms: float


@router.post(
    "/chat",
    summary="Ask a question — get a RAG-grounded answer",
    response_model=ChatResponse,
    dependencies=[Depends(verify_api_key)],
)
async def chat(body: ChatRequest, request: Request) -> ChatResponse:
    """
    Submit a natural-language question. The system retrieves relevant
    concepts from the knowledge graph (vector + graph hybrid search)
    and generates a grounded answer with source citations.

    Multi-turn: pass ``session_id`` to maintain conversation context
    across requests. Sessions store the last 10 turns in-memory.
    """
    if not body.query or not body.query.strip():
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="query must be a non-empty string.",
        )

    # Resolve or create session — check in-memory cache first, then disk
    import uuid
    session_id = body.session_id or str(uuid.uuid4())
    if session_id not in _sessions:
        _sessions[session_id] = _load_session(session_id)

    session_history = _sessions[session_id]

    # Execute RAG pipeline
    result = rag_query(
        q=body.query.strip(),
        session_history=session_history,
        graph_db=request.app.state.neo4j,
        vector_db=request.app.state.vector_db,
        groq_client=request.app.state.groq,
    )

    # Update session history (keep last MAX_SESSION_TURNS turns)
    session_history.append({"role": "user", "content": body.query.strip()})
    session_history.append({"role": "assistant", "content": result["answer"]})
    # Trim to last N turns
    if len(session_history) > MAX_SESSION_TURNS * 2:
        _sessions[session_id] = session_history[-(MAX_SESSION_TURNS * 2):]

    # Persist trimmed history to disk so it survives restarts
    _save_session(session_id, _sessions[session_id])

    logger.info(
        "chat: session=%s latency=%.0fms citations=%d",
        session_id,
        result.get("latency_ms", 0),
        len(result.get("citations", [])),
    )

    return ChatResponse(
        answer=result["answer"],
        citations=result.get("citations", []),
        session_id=session_id,
        latency_ms=result.get("latency_ms", 0),
    )
