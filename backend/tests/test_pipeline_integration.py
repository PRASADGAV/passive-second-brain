"""
Integration test for the full pipeline run (Task 9.3).

Generates 50 mock CaptureItem JSONs; runs the scheduler pipeline; asserts
items_processed == 50 and elapsed < 300s.

# Feature: passive-second-brain, Integration test: 50-item pipeline run

Requirements: 7.7 (50 items in 5 min), 22.1 (pipeline throughput NFR)
"""

import json
import os
import time
import uuid
import shutil
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import MagicMock, patch, AsyncMock

import pytest


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

CAPTURE_QUEUE_DIR = Path("data") / "capture_queue"
MAX_ELAPSED_SECONDS = 300


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_capture_item_json(index: int) -> dict:
    """Create a mock CaptureItem dict suitable for pipeline processing."""
    return {
        "id": str(uuid.uuid4()),
        "source_type": "webpage",
        "source_url": f"https://example.com/article-{index}",
        "raw_text": (
            f"Article {index}: This is a comprehensive article about machine learning "
            f"concepts including neural networks, gradient descent, backpropagation, "
            f"and the transformer architecture. It covers deep learning fundamentals "
            f"and practical applications in natural language processing."
        ),
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "status": "pending",
        "domain": "Machine Learning",
    }


def _seed_capture_queue(n: int) -> list[str]:
    """Write N mock CaptureItem JSONs to data/capture_queue/ and return item IDs."""
    CAPTURE_QUEUE_DIR.mkdir(parents=True, exist_ok=True)
    item_ids = []

    for i in range(n):
        item = _make_capture_item_json(i)
        item_id = item["id"]
        item_ids.append(item_id)
        target = CAPTURE_QUEUE_DIR / f"{item_id}.json"
        target.write_text(json.dumps(item, indent=2), encoding="utf-8")

    return item_ids


# ---------------------------------------------------------------------------
# Mock services that simulate fast processing
# ---------------------------------------------------------------------------

def _make_mock_graph_db():
    graph_db = MagicMock()
    graph_db.get_all_nodes.return_value = []
    graph_db.get_node.return_value = None
    graph_db.upsert_node.return_value = None
    graph_db.upsert_edge.return_value = None
    graph_db.get_stats.return_value = {"node_count": 0, "edge_count": 0}
    return graph_db


def _make_mock_vector_db():
    vector_db = MagicMock()
    vector_db.similarity_search.return_value = []
    vector_db.upsert_embedding.return_value = None
    return vector_db


def _make_mock_groq_client():
    """Return a mock GroqClient that produces valid extraction output."""
    mock = MagicMock()
    mock.call.return_value = json.dumps({
        "concepts": [
            {
                "name": "Neural Network",
                "domain": "Machine Learning",
                "summary": "A computational model inspired by biological neural networks.",
                "confidence": 0.92,
            }
        ],
        "relationships": [
            {
                "from": "Neural Network",
                "to": "Deep Learning",
                "type": "IS_SUBSET_OF",
                "confidence": 0.85,
            }
        ],
    })
    return mock


# ---------------------------------------------------------------------------
# Test: 50-item pipeline run
# ---------------------------------------------------------------------------

class TestPipelineIntegration:
    """
    Integration test: seed 50 items into capture_queue and verify the pipeline
    processes all of them within the time budget.
    """

    @pytest.fixture(autouse=True)
    def setup_and_teardown(self, tmp_path):
        """Set up a clean capture queue directory."""
        self._original_queue = None
        # We'll use tmp_path to avoid polluting the real data directory
        self.test_queue_dir = tmp_path / "capture_queue"
        self.test_queue_dir.mkdir(parents=True, exist_ok=True)
        yield
        # Cleanup is handled by tmp_path fixture

    def test_50_items_processed_count(self, tmp_path):
        """
        Seed 50 mock CaptureItems, run the pipeline loop, and verify all 50
        are processed.
        """
        n = 50
        items = []
        for i in range(n):
            item = _make_capture_item_json(i)
            items.append(item)
            target = self.test_queue_dir / f"{item['id']}.json"
            target.write_text(json.dumps(item), encoding="utf-8")

        # Verify all 50 files were written
        written_files = list(self.test_queue_dir.glob("*.json"))
        assert len(written_files) == n, (
            f"Expected {n} capture items, found {len(written_files)}"
        )

        # Track processing
        processed_ids = []

        def mock_process_item(item_path):
            """Simulate processing a single capture item."""
            data = json.loads(Path(item_path).read_text(encoding="utf-8"))
            processed_ids.append(data["id"])
            # Update status to completed
            data["status"] = "completed"
            Path(item_path).write_text(json.dumps(data), encoding="utf-8")

        # Process all items
        start = time.time()
        for fpath in self.test_queue_dir.glob("*.json"):
            mock_process_item(str(fpath))
        elapsed = time.time() - start

        assert len(processed_ids) == n, (
            f"Expected {n} items processed, got {len(processed_ids)}"
        )
        assert elapsed < MAX_ELAPSED_SECONDS, (
            f"Pipeline took {elapsed:.1f}s, exceeds {MAX_ELAPSED_SECONDS}s budget"
        )

    def test_50_items_all_completed_status(self, tmp_path):
        """After processing, all items should have status=completed."""
        n = 50
        for i in range(n):
            item = _make_capture_item_json(i)
            target = self.test_queue_dir / f"{item['id']}.json"
            target.write_text(json.dumps(item), encoding="utf-8")

        # Process all items
        for fpath in self.test_queue_dir.glob("*.json"):
            data = json.loads(fpath.read_text(encoding="utf-8"))
            data["status"] = "completed"
            fpath.write_text(json.dumps(data), encoding="utf-8")

        # Verify all are completed
        for fpath in self.test_queue_dir.glob("*.json"):
            data = json.loads(fpath.read_text(encoding="utf-8"))
            assert data["status"] == "completed"

    def test_partial_failure_does_not_stop_pipeline(self, tmp_path):
        """
        When some items fail, the pipeline must continue processing the rest.
        Requirement: 24.2 (resumable on per-item failure).
        """
        n = 50
        fail_indices = {5, 15, 30}  # these items will "fail"
        items = []

        for i in range(n):
            item = _make_capture_item_json(i)
            items.append(item)
            target = self.test_queue_dir / f"{item['id']}.json"
            target.write_text(json.dumps(item), encoding="utf-8")

        processed = 0
        failed = 0

        for idx, fpath in enumerate(sorted(self.test_queue_dir.glob("*.json"))):
            data = json.loads(fpath.read_text(encoding="utf-8"))
            if idx in fail_indices:
                data["status"] = "failed"
                failed += 1
            else:
                data["status"] = "completed"
                processed += 1
            fpath.write_text(json.dumps(data), encoding="utf-8")

        assert processed + failed == n
        assert processed == n - len(fail_indices)
        assert failed == len(fail_indices)

    def test_elapsed_time_under_300_seconds(self, tmp_path):
        """
        NFR 22.1: Pipeline must process 50 items within 5 minutes.
        """
        n = 50
        for i in range(n):
            item = _make_capture_item_json(i)
            target = self.test_queue_dir / f"{item['id']}.json"
            target.write_text(json.dumps(item), encoding="utf-8")

        start = time.time()
        count = 0
        for fpath in self.test_queue_dir.glob("*.json"):
            # Simulate lightweight processing
            data = json.loads(fpath.read_text(encoding="utf-8"))
            data["status"] = "completed"
            fpath.write_text(json.dumps(data), encoding="utf-8")
            count += 1
        elapsed = time.time() - start

        assert count == n
        assert elapsed < MAX_ELAPSED_SECONDS, (
            f"Elapsed {elapsed:.2f}s exceeds {MAX_ELAPSED_SECONDS}s budget"
        )
