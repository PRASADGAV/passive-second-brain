"""
scheduler.py — Nightly batch processing pipeline for Passive Second Brain.

Orchestrates all 10 pipeline steps for every pending CaptureItem:
  1. Load pending items from capture queue
  2. Clean / chunk text
  3. Extract concepts + relationships via Groq LLM
  4. Entity resolution + deduplication
  5. Upsert Concept nodes to Neo4j
  6. Upsert vector embeddings to ChromaDB
  7. Update SM-2 forgetting scores for all nodes
  8. Generate daily learning digest

Recovery semantics:
  - Each item is processed in an isolated try/except; one failure never aborts
    the batch (Requirement 7.4, 24.1–24.3).
  - A checkpoint file records completed item IDs so a resumed run skips
    already-processed items (Requirement 24.3).
  - A PIPELINE_SLOW_WARNING is logged if the batch exceeds 300 s.
  - Concurrent chunk processing uses asyncio.gather + asyncio.Semaphore(5)
    to respect Groq rate limits while maximising throughput.

APScheduler integration:
  - CronTrigger(hour=PIPELINE_HOUR) fires the pipeline nightly.
  - PIPELINE_HOUR defaults to 23 (11 PM) and is overridable via env var.

Requirements:
    7.1  APScheduler trigger
    7.2  Default 23:00
    7.3  Configurable time
    7.4  Process all queued items
    7.7  50 items in ≤ 5 minutes
    22.1 Pipeline throughput NFR
    24.1 Full exception trace logged
    24.2 Unprocessed items preserved on failure
    24.3 Resumable — skip already-completed items
"""

import asyncio
import json
import logging
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import List, Optional

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

try:
    from backend.models.schemas import (
        CaptureItem, CaptureStatus, ConceptNode, EdgeType
    )
    from backend.services.chunker import chunk
    from backend.services.extractor import extract_all_chunks
    from backend.services.resolver import resolve
    from backend.services.graph_db import Neo4jService
    from backend.services.vector_db import VectorDBService
    from backend.services.sm2 import compute_forget_score, update_sm2_on_review
    from backend.services.digest_gen import generate_digest
except ModuleNotFoundError:
    from models.schemas import CaptureItem, CaptureStatus, ConceptNode, EdgeType
    from services.chunker import chunk
    from services.extractor import extract_all_chunks
    from services.resolver import resolve
    from services.graph_db import Neo4jService
    from services.vector_db import VectorDBService
    from services.sm2 import compute_forget_score, update_sm2_on_review
    from services.digest_gen import generate_digest

logger = logging.getLogger("psb.scheduler")

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PIPELINE_HOUR     = int(os.environ.get("PIPELINE_HOUR", "23"))
QUEUE_DIR         = Path("data") / "capture_queue"
CHECKPOINT_FILE   = Path("data") / "pipeline_checkpoint.json"
PIPELINE_WARN_SEC = 300          # log warning if run exceeds 5 minutes
GROQ_CONCURRENCY  = 5            # max concurrent Groq API calls


# ---------------------------------------------------------------------------
# Checkpoint helpers  (Requirement 24.3 — resumable)
# ---------------------------------------------------------------------------

def _load_checkpoint() -> set:
    """Load set of already-completed item IDs from the checkpoint file."""
    if not CHECKPOINT_FILE.exists():
        return set()
    try:
        data = json.loads(CHECKPOINT_FILE.read_text(encoding="utf-8"))
        return set(data.get("completed_ids", []))
    except Exception:
        return set()


def _save_checkpoint(completed_ids: set) -> None:
    """Persist the set of completed item IDs to disk."""
    CHECKPOINT_FILE.parent.mkdir(parents=True, exist_ok=True)
    CHECKPOINT_FILE.write_text(
        json.dumps({"completed_ids": list(completed_ids), "updated_at": datetime.now(timezone.utc).isoformat()}),
        encoding="utf-8",
    )


def _clear_checkpoint() -> None:
    """Remove checkpoint file after a successful full run."""
    if CHECKPOINT_FILE.exists():
        CHECKPOINT_FILE.unlink()


# ---------------------------------------------------------------------------
# Queue helpers
# ---------------------------------------------------------------------------

def _load_pending_items() -> List[CaptureItem]:
    """
    Load all CaptureItems with status=pending from the capture queue directory.
    Returns list sorted by captured_at (oldest first).
    """
    if not QUEUE_DIR.exists():
        return []

    items = []
    for path in sorted(QUEUE_DIR.glob("*.json")):
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            item = CaptureItem(**data)
            if item.status == CaptureStatus.pending:
                items.append(item)
        except Exception as exc:
            logger.warning("scheduler: failed to load queue item %s: %s", path.name, exc)

    return items


def _mark_item_status(item_id: str, status: CaptureStatus) -> None:
    """Update the status field of a queue item JSON file."""
    path = QUEUE_DIR / f"{item_id}.json"
    if not path.exists():
        return
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        data["status"] = status.value
        path.write_text(json.dumps(data, indent=2), encoding="utf-8")
    except Exception as exc:
        logger.warning("scheduler: failed to update status for %s: %s", item_id, exc)


# ---------------------------------------------------------------------------
# Per-item processing
# ---------------------------------------------------------------------------

async def _process_item(
    item: CaptureItem,
    graph_db: Neo4jService,
    vector_db: VectorDBService,
    semaphore: asyncio.Semaphore,
    stats: dict,
) -> None:
    """
    Process a single CaptureItem through the full extraction pipeline.

    Uses semaphore to limit concurrent Groq API calls.
    All exceptions are caught — failures log and continue (Requirement 24.1).
    """
    item_id = str(item.id)

    try:
        _mark_item_status(item_id, CaptureStatus.processing)

        raw_text = item.raw_text or ""
        if not raw_text.strip():
            logger.info("scheduler: skipping empty item %s", item_id)
            _mark_item_status(item_id, CaptureStatus.completed)
            return

        # Step 2 — Chunk text
        chunks = chunk(raw_text)
        if not chunks:
            _mark_item_status(item_id, CaptureStatus.completed)
            return

        # Step 3 — Extract concepts + relationships (rate-limited via semaphore)
        async with semaphore:
            extraction = await asyncio.to_thread(extract_all_chunks, chunks)

        if not extraction.concepts:
            logger.info("scheduler: no concepts extracted from item %s", item_id)
            _mark_item_status(item_id, CaptureStatus.completed)
            return

        # Step 4 — Entity resolution / deduplication
        new_concepts = await asyncio.to_thread(
            resolve, extraction.concepts, graph_db, vector_db
        )

        # Step 5 — Upsert Concept nodes to Neo4j
        now = datetime.now(timezone.utc)
        domain = item.domain or (extraction.concepts[0].domain if extraction.concepts else "General")

        for raw_concept in new_concepts:
            node = ConceptNode(
                concept_id=str(uuid.uuid4()),
                name=raw_concept.name[:200],
                domain=raw_concept.domain or domain,
                summary=raw_concept.summary[:500],
                source_url=item.source_url,
                created_at=now,
                last_seen=now,
            )
            await asyncio.to_thread(graph_db.upsert_node, node)
            stats["nodes_added"] += 1

            # Step 6 — Upsert embedding to ChromaDB
            await asyncio.to_thread(
                vector_db.upsert_embedding,
                node.concept_id,
                node.name,
                node.summary,
                {"domain": node.domain, "source_url": node.source_url, "forget_score": 0.0},
            )

        # Upsert edges — build the name→id map ONCE before the loop (not inside it)
        if extraction.relationships:
            try:
                source_nodes = graph_db.get_all_nodes(skip=0, limit=10000)
                source_map = {n.name.lower(): n.concept_id for n in source_nodes}
            except Exception as exc:
                logger.warning("scheduler: failed to build name→id map: %s", exc)
                source_map = {}

            for rel in extraction.relationships:
                try:
                    src_id = source_map.get(rel.from_concept.lower())
                    tgt_id = source_map.get(rel.to_concept.lower())
                    if src_id and tgt_id:
                        await asyncio.to_thread(
                            graph_db.upsert_edge,
                            src_id, tgt_id, rel.type, rel.confidence, now
                        )
                        stats["edges_added"] += 1
                except Exception as exc:
                    logger.warning("scheduler: failed to upsert edge %s->%s: %s",
                                   rel.from_concept, rel.to_concept, exc)

        _mark_item_status(item_id, CaptureStatus.completed)
        stats["items_processed"] += 1
        logger.info("scheduler: completed item %s (%d concepts)", item_id, len(new_concepts))

    except Exception as exc:
        logger.error(
            "scheduler: ITEM FAILED %s: %s\n%s",
            item_id,
            exc,
            traceback.format_exc(),
            extra={"component": "scheduler", "item_id": item_id},
        )
        _mark_item_status(item_id, CaptureStatus.failed)
        stats["items_failed"] += 1


# ---------------------------------------------------------------------------
# Main pipeline run
# ---------------------------------------------------------------------------

async def run_pipeline(
    graph_db: Optional[Neo4jService] = None,
    vector_db: Optional[VectorDBService] = None,
) -> dict:
    """
    Execute the full nightly pipeline.

    Args:
        graph_db:  Optional injected Neo4jService (used in tests).
        vector_db: Optional injected VectorDBService (used in tests).

    Returns:
        Stats dict: {items_processed, items_failed, nodes_added, edges_added,
                     elapsed_seconds, status}
    """
    t_start = time.time()
    stats = {
        "items_processed": 0,
        "items_failed": 0,
        "nodes_added": 0,
        "edges_added": 0,
        "elapsed_seconds": 0.0,
        "status": "running",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }

    logger.info("scheduler: pipeline run started")

    # Lazy-init services if not injected
    if graph_db is None:
        graph_db = Neo4jService()
    if vector_db is None:
        vector_db = VectorDBService()

    # Load pending items
    items = _load_pending_items()
    if not items:
        logger.info("scheduler: no pending items — pipeline complete (0 items)")
        stats["status"] = "success"
        stats["elapsed_seconds"] = round(time.time() - t_start, 2)
        _clear_checkpoint()
        return stats

    # Skip already-completed items (Requirement 24.3)
    completed_ids = _load_checkpoint()
    items = [i for i in items if str(i.id) not in completed_ids]
    logger.info("scheduler: %d item(s) to process (%d already completed)",
                len(items), len(completed_ids))

    # Semaphore caps concurrent Groq API calls
    semaphore = asyncio.Semaphore(GROQ_CONCURRENCY)

    # Process all items as concurrent tasks (I/O bound — safe with asyncio)
    tasks = [
        _process_item(item, graph_db, vector_db, semaphore, stats)
        for item in items
    ]
    await asyncio.gather(*tasks)

    # Update SM-2 scores for all nodes (Step 7)
    try:
        all_nodes = graph_db.get_all_nodes(skip=0, limit=10_000)
        score_updates = []
        for node in all_nodes:
            new_score = compute_forget_score(node)
            if abs(new_score - node.forget_score) > 0.0001:
                score_updates.append({
                    "concept_id": node.concept_id,
                    "forget_score": new_score,
                })
        if score_updates:
            graph_db.batch_update_forget_scores(score_updates)
        logger.info("scheduler: SM-2 scores updated for %d node(s) (%d changed)",
                     len(all_nodes), len(score_updates))
    except Exception as exc:
        logger.error("scheduler: SM-2 update failed: %s", exc, exc_info=True)

    # Run graph algorithms (Step 7b — Phase 3: Requirement 11.2, 17.2)
    try:
        pagerank_count = graph_db.compute_pagerank()
        community_count = graph_db.detect_communities()
        logger.info(
            "scheduler: graph algorithms done — pagerank=%d communities=%d",
            pagerank_count, community_count,
        )
    except Exception as exc:
        logger.error("scheduler: graph algorithms failed: %s", exc, exc_info=True)

    # Generate daily digest (Step 8)
    try:
        await asyncio.to_thread(generate_digest, stats)
        logger.info("scheduler: daily digest generated")
    except Exception as exc:
        logger.error("scheduler: digest generation failed (pipeline continues): %s", exc)

    elapsed = round(time.time() - t_start, 2)
    stats["elapsed_seconds"] = elapsed
    stats["status"] = "success" if stats["items_failed"] == 0 else "partial"

    # Performance warning (Requirement 22.1)
    if elapsed > PIPELINE_WARN_SEC:
        logger.warning(
            "PIPELINE_SLOW_WARNING: batch of %d item(s) took %.1fs (limit %ds)",
            len(items), elapsed, PIPELINE_WARN_SEC,
            extra={"component": "scheduler", "batch_size": len(items), "elapsed_seconds": elapsed},
        )

    # Clear checkpoint on full success
    if stats["items_failed"] == 0:
        _clear_checkpoint()
    else:
        # Save completed IDs so a resumed run skips them (Requirement 24.3)
        new_completed = completed_ids | {
            str(i.id) for i in items
            if (QUEUE_DIR / f"{i.id}.json").exists()
            and json.loads((QUEUE_DIR / f"{i.id}.json").read_text()).get("status") == "completed"
        }
        _save_checkpoint(new_completed)

    logger.info(
        "scheduler: pipeline done — processed=%d failed=%d nodes=%d edges=%d elapsed=%.1fs",
        stats["items_processed"], stats["items_failed"],
        stats["nodes_added"], stats["edges_added"], elapsed,
    )
    return stats


# ---------------------------------------------------------------------------
# APScheduler setup
# ---------------------------------------------------------------------------

def create_scheduler(
    graph_db: Optional[Neo4jService] = None,
    vector_db: Optional[VectorDBService] = None,
) -> AsyncIOScheduler:
    """
    Create and return a configured AsyncIOScheduler.

    The scheduler fires run_pipeline() every night at PIPELINE_HOUR (default 23:00).
    Pass graph_db / vector_db to inject services (useful for testing).
    """
    scheduler = AsyncIOScheduler()

    async def _job():
        await run_pipeline(graph_db=graph_db, vector_db=vector_db)

    scheduler.add_job(
        _job,
        trigger=CronTrigger(hour=PIPELINE_HOUR, minute=0),
        id="nightly_pipeline",
        name=f"Nightly pipeline (hour={PIPELINE_HOUR})",
        replace_existing=True,
        max_instances=1,   # Requirement 7: skip if already running
    )
    logger.info("scheduler: nightly pipeline scheduled at %02d:00", PIPELINE_HOUR)
    return scheduler
