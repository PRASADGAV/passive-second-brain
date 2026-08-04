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

import logging
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
# In-memory session store (keyed by session_id)
# Each session stores the last 10 turns: [{role, content}]
# ---------------------------------------------------------------------------
_sessions: dict[str, list[dict]] = {}
MAX_SESSION_TURNS = 10


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

    # Resolve or create session
    import uuid
    session_id = body.session_id or str(uuid.uuid4())
    if session_id not in _sessions:
        _sessions[session_id] = []

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
