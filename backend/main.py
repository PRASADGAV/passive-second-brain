"""
main.py — FastAPI application entry point for Passive Second Brain backend.

Responsibilities:
- App initialisation with CORS middleware
- Structured JSON logging (level, component, message, timestamp)
- Global exception handler mapping common errors to 422/502/503/500
- GET /health endpoint
"""

import logging
import os
import sys
import time
import traceback
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

# Ensure repository root is in sys.path so 'backend.*' imports resolve cleanly everywhere
_repo_root = str(Path(__file__).resolve().parent.parent)
if _repo_root not in sys.path:
    sys.path.insert(0, _repo_root)

from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from backend.auth import verify_api_key  # noqa: F401 — re-exported for consumers
from backend.services.graph_db import Neo4jService
from backend.services.vector_db import VectorDBService
from backend.services.groq_client import GroqClient
from backend.services.scheduler import create_scheduler, run_pipeline
from backend.routers.ingest import router as ingest_router
from backend.routers.graph import router as graph_router
from backend.routers.memory import router as memory_router
from backend.routers.digest import router as digest_router
from backend.routers.chat import router as chat_router
from backend.routers.gaps import router as gaps_router
from backend.routers.report import router as report_router
from backend.routers.playground import router as playground_router

# ---------------------------------------------------------------------------
# Load environment variables from .env (if present)
# ---------------------------------------------------------------------------
load_dotenv()

# ---------------------------------------------------------------------------
# Structured JSON logging
# ---------------------------------------------------------------------------

class StructuredJSONFormatter(logging.Formatter):
    """Emit log records as a single-line JSON object.

    Required fields per design §Error Log Schema:
        level, component, message, timestamp
    Optional extra fields (e.g. request_id, exc_info) are included when present.
    """

    def format(self, record: logging.LogRecord) -> str:
        import json

        log_obj: dict = {
            "timestamp": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "component": record.name,
            "message": record.getMessage(),
        }

        # Attach exception traceback when available
        if record.exc_info:
            log_obj["exc_info"] = self.formatException(record.exc_info)

        # Attach any extra fields passed via Logger.extra
        for key, value in record.__dict__.items():
            if key not in (
                "name", "msg", "args", "levelname", "levelno", "pathname",
                "filename", "module", "exc_info", "exc_text", "stack_info",
                "lineno", "funcName", "created", "msecs", "relativeCreated",
                "thread", "threadName", "processName", "process", "message",
            ):
                log_obj[key] = value

        return json.dumps(log_obj, default=str)


def configure_logging() -> None:
    """Configure root logger with structured JSON output to stdout."""
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(StructuredJSONFormatter())
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    # Remove any default handlers added by libraries before our handler
    root.handlers.clear()
    root.addHandler(handler)


configure_logging()
logger = logging.getLogger("psb.main")

# ---------------------------------------------------------------------------
# Lifespan (startup / shutdown hooks)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Passive Second Brain backend starting up")
    # Initialise services and store on app.state for dependency injection
    app.state.neo4j = Neo4jService()
    app.state.vector_db = VectorDBService()
    app.state.groq = GroqClient()

    try:
        app.state.neo4j.init_schema()
        logger.info("Neo4j schema initialised successfully")
    except Exception as exc:
        logger.warning("Neo4j schema init warning: %s", exc)

    # Start nightly pipeline scheduler
    try:
        app.state.scheduler = create_scheduler(
            graph_db=app.state.neo4j,
            vector_db=app.state.vector_db,
        )
        app.state.scheduler.start()
    except Exception as exc:
        logger.warning("Scheduler startup warning: %s", exc)
        app.state.scheduler = None

    app.state.pipeline_status = {"status": "idle", "last_run": None, "items_processed": 0, "error": None}
    app.state.ws_manager = ws_manager
    logger.info("All services initialised successfully")
    yield
    if getattr(app.state, "scheduler", None):
        app.state.scheduler.shutdown(wait=False)
    if hasattr(app.state, "neo4j") and app.state.neo4j:
        try:
            app.state.neo4j.close()
        except Exception:
            pass
    logger.info("Passive Second Brain backend shutting down")

# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="Passive Second Brain API",
    version="1.0.0",
    description=(
        "REST API for the Passive Second Brain personal knowledge management system. "
        "Manages content ingestion, knowledge graph operations, RAG chat, and daily digests."
    ),
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)

# ---------------------------------------------------------------------------
# CORS middleware
# ---------------------------------------------------------------------------
# Allowed origins are driven by the CORS_ORIGINS environment variable so the
# same codebase works in dev and production without code changes:
#
#   Dev (Docker):   not set → defaults below allow localhost:5173 + extension
#   Production:     set CORS_ORIGINS=https://your-frontend.vercel.app
#
# NOTE: allow_credentials=True is incompatible with allow_origins=["*"].
#       We always use an explicit list so credentials are handled correctly.
# ---------------------------------------------------------------------------

_cors_env = os.getenv("CORS_ORIGINS", "")
if _cors_env.strip():
    ALLOWED_ORIGINS: list[str] = [o.strip() for o in _cors_env.split(",") if o.strip()]
else:
    # Default dev origins — localhost frontend + Chrome Extension
    ALLOWED_ORIGINS: list[str] = [
        "http://localhost:5173",
        "http://localhost:3000",
        "chrome-extension://*",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"chrome-extension://.*",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ingest_router)
app.include_router(graph_router)
app.include_router(memory_router)
app.include_router(digest_router)
app.include_router(chat_router)
app.include_router(gaps_router)
app.include_router(report_router)
app.include_router(playground_router)

# ---------------------------------------------------------------------------
# Global exception handler
# ---------------------------------------------------------------------------

@app.exception_handler(ValidationError)
async def pydantic_validation_error_handler(
    request: Request, exc: ValidationError
) -> JSONResponse:
    """Return 422 for Pydantic validation failures with field-level detail."""
    request_id = str(uuid.uuid4())
    logger.warning(
        "Pydantic validation error",
        extra={"request_id": request_id, "path": str(request.url), "detail": exc.errors()},
    )
    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={"detail": exc.errors(), "request_id": request_id},
    )


@app.exception_handler(Exception)
async def global_exception_handler(
    request: Request, exc: Exception
) -> JSONResponse:
    """
    Catch-all handler that maps known error types to appropriate HTTP status
    codes and logs the full exception trace per Requirement 24.1.

    Mapping:
        ValidationError (fastapi/pydantic)  → 422
        Neo4jError / ServiceUnavailable     → 503
        GroqAPIError / APIError             → 502
        Unexpected                          → 500
    """
    request_id = str(uuid.uuid4())
    exc_type = type(exc).__name__
    full_trace = traceback.format_exc()

    # Determine HTTP status and user-facing message based on exception type
    exc_module = getattr(type(exc), "__module__", "") or ""

    if isinstance(exc, ValidationError):
        http_status = status.HTTP_422_UNPROCESSABLE_ENTITY
        error_code = "VALIDATION_ERROR"
        user_message = "Request validation failed."
    elif "neo4j" in exc_module.lower() or exc_type in (
        "ServiceUnavailable", "Neo4jError", "TransientError", "DatabaseError"
    ):
        http_status = status.HTTP_503_SERVICE_UNAVAILABLE
        error_code = "GRAPH_DB_UNAVAILABLE"
        user_message = "Knowledge graph service is temporarily unavailable. Please retry."
    elif "groq" in exc_module.lower() or exc_type in (
        "GroqError", "APIError", "APIConnectionError", "RateLimitError"
    ):
        http_status = status.HTTP_502_BAD_GATEWAY
        error_code = "LLM_API_ERROR"
        user_message = "LLM inference service returned an error."
    else:
        http_status = status.HTTP_500_INTERNAL_SERVER_ERROR
        error_code = "INTERNAL_ERROR"
        user_message = "An unexpected error occurred."

    # Log full trace per Requirement 24.1
    logger.error(
        user_message,
        extra={
            "request_id": request_id,
            "error_code": error_code,
            "exc_type": exc_type,
            "path": str(request.url),
            "method": request.method,
            "trace": full_trace,
        },
    )

    return JSONResponse(
        status_code=http_status,
        content={
            "error": error_code,
            "message": user_message,
            "request_id": request_id,
        },
    )

# ---------------------------------------------------------------------------
# Health endpoint
# ---------------------------------------------------------------------------

@app.get(
    "/health",
    summary="Health check",
    response_description="Returns connectivity status for all services.",
    tags=["system"],
)
async def health_check(request: Request) -> dict:
    """
    Liveness + readiness probe. Returns HTTP 200 with status of all three
    downstream services: Neo4j, ChromaDB, and Groq API.
    """
    # Neo4j connectivity check
    try:
        request.app.state.neo4j.get_stats()
        neo4j_status = "connected"
    except Exception:
        neo4j_status = "unavailable"

    # ChromaDB connectivity check
    try:
        request.app.state.vector_db.similarity_search("health-check", top_k=1)
        chroma_status = "connected"
    except Exception:
        chroma_status = "unavailable"

    # Groq: just verify key is configured (no API call on every health check)
    groq_status = "configured" if os.getenv("GROQ_API_KEY") else "not_configured"

    return {
        "status": "ok",
        "version": "1.0.0",
        "services": {
            "neo4j": neo4j_status,
            "chromadb": chroma_status,
            "groq": groq_status,
        },
    }


# ---------------------------------------------------------------------------
# Pipeline status and manual trigger endpoints
# ---------------------------------------------------------------------------

@app.get("/pipeline/status", summary="Get latest pipeline run status", tags=["pipeline"])
async def pipeline_status(request: Request) -> dict:
    """Returns the status of the most recent pipeline run."""
    return request.app.state.pipeline_status


@app.post(
    "/pipeline/trigger",
    summary="Manually trigger the nightly pipeline",
    tags=["pipeline"],
    dependencies=[Depends(verify_api_key)],
)
async def trigger_pipeline(request: Request) -> dict:
    """Immediately enqueue a pipeline run outside the scheduled window."""
    if request.app.state.pipeline_status.get("status") == "running":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Pipeline is already running.",
        )

    async def _run():
        request.app.state.pipeline_status["status"] = "running"
        request.app.state.pipeline_status["error"] = None
        try:
            result = await run_pipeline(
                graph_db=request.app.state.neo4j,
                vector_db=request.app.state.vector_db,
            )
            request.app.state.pipeline_status.update({
                "status": "success",
                "last_run": result.get("started_at"),
                "items_processed": result.get("items_processed", 0),
                "error": None,
            })
        except Exception as exc:
            request.app.state.pipeline_status.update({
                "status": "failed",
                "error": str(exc),
            })

    import asyncio
    asyncio.create_task(_run())
    return {"message": "Pipeline triggered", "status": "running"}


# ---------------------------------------------------------------------------
# WebSocket manager and /ws endpoint
# Requirements: 17.5 (real-time graph updates), design §WebSocket Events
# ---------------------------------------------------------------------------

from typing import List as _List

class WebSocketManager:
    """Manages active WebSocket connections and broadcasts events."""

    def __init__(self):
        self.active_connections: _List[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        logger.info("ws: client connected (%d total)", len(self.active_connections))

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("ws: client disconnected (%d remaining)", len(self.active_connections))

    async def broadcast(self, message: dict):
        """Broadcast a JSON event to all connected clients."""
        import json as _json
        data = _json.dumps(message)
        dead = []
        for ws in self.active_connections:
            try:
                await ws.send_text(data)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)


# Module-level WebSocket manager — shared across the app
ws_manager = WebSocketManager()


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """
    WebSocket endpoint for live graph updates.
    Clients receive node_added, edge_added, and pipeline_status events.
    No authentication required for read-only event stream.
    """
    await ws_manager.connect(websocket)
    try:
        while True:
            # Keep connection alive; clients don't send messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        ws_manager.disconnect(websocket)
    except Exception:
        ws_manager.disconnect(websocket)


# Mount frontend static files if running in production bundle (Hugging Face / Single Container)
from fastapi.staticfiles import StaticFiles
if os.path.exists("static"):
    app.mount("/", StaticFiles(directory="static", html=True), name="static")

# ---------------------------------------------------------------------------
# Application entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        reload=bool(os.getenv("DEVELOPER_MODE", "false").lower() == "true"),
        log_config=None,  # Disable uvicorn's default logging; use ours
    )
