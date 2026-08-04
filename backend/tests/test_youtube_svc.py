"""
Unit tests for backend/services/youtube_svc.py

Tests cover:
- extract_video_id: happy paths (long-form, short-form), edge cases, and
  invalid / non-YouTube URLs.
- get_transcript: successful join and silent-failure on exception.
- transcript_and_queue: end-to-end happy path and invalid-URL error path.
"""

import json
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from backend.services.youtube_svc import (
    extract_video_id,
    get_transcript,
    transcript_and_queue,
)


class TestExtractVideoId(unittest.TestCase):
    # ------------------------------------------------------------------
    # Long-form youtube.com/watch?v= URLs
    # ------------------------------------------------------------------

    def test_long_form_plain(self):
        assert extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_long_form_no_www(self):
        assert extract_video_id("https://youtube.com/watch?v=abc123") == "abc123"

    def test_long_form_with_extra_params(self):
        url = "https://www.youtube.com/watch?v=XYZ789&list=PL1234&index=3"
        assert extract_video_id(url) == "XYZ789"

    def test_long_form_missing_v_param(self):
        assert extract_video_id("https://www.youtube.com/watch?list=PL1234") is None

    # ------------------------------------------------------------------
    # Short-form youtu.be/ URLs
    # ------------------------------------------------------------------

    def test_short_form(self):
        assert extract_video_id("https://youtu.be/dQw4w9WgXcQ") == "dQw4w9WgXcQ"

    def test_short_form_with_query(self):
        assert extract_video_id("https://youtu.be/abc123?t=42") == "abc123"

    def test_short_form_empty_path(self):
        assert extract_video_id("https://youtu.be/") is None

    # ------------------------------------------------------------------
    # Non-YouTube URLs
    # ------------------------------------------------------------------

    def test_non_youtube_domain(self):
        assert extract_video_id("https://vimeo.com/123456789") is None

    def test_random_url(self):
        assert extract_video_id("https://example.com") is None

    def test_empty_string(self):
        assert extract_video_id("") is None

    def test_plain_string(self):
        assert extract_video_id("not a url at all") is None


class TestGetTranscript(unittest.TestCase):
    _SEGMENTS = [
        {"text": "Hello", "start": 0.0, "duration": 1.0},
        {"text": "world", "start": 1.0, "duration": 1.0},
    ]

    def test_joins_segments(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            return_value=self._SEGMENTS,
        ):
            result = get_transcript("dQw4w9WgXcQ")
        assert result == "Hello world"

    def test_single_segment(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            return_value=[{"text": "Only one", "start": 0.0, "duration": 2.0}],
        ):
            result = get_transcript("abc")
        assert result == "Only one"

    def test_empty_segment_list(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            return_value=[],
        ):
            result = get_transcript("abc")
        assert result == ""

    def test_returns_empty_string_on_exception(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            side_effect=Exception("No transcript available"),
        ):
            result = get_transcript("private_video")
        assert result == ""

    def test_never_raises_on_network_error(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            side_effect=ConnectionError("network failure"),
        ):
            # Must not propagate
            result = get_transcript("any_id")
        assert result == ""


class TestTranscriptAndQueue(unittest.TestCase):
    def setUp(self):
        # Patch _QUEUE_DIR to a temp path so tests don't pollute real data/
        self._tmp_dir = Path("data") / "capture_queue_test_tmp"
        self._queue_dir_patcher = patch(
            "backend.services.youtube_svc._QUEUE_DIR", self._tmp_dir
        )
        self._queue_dir_patcher.start()

    def tearDown(self):
        self._queue_dir_patcher.stop()
        # Clean up any files created during tests.
        if self._tmp_dir.exists():
            for f in self._tmp_dir.iterdir():
                f.unlink()
            self._tmp_dir.rmdir()

    def test_invalid_url_returns_error_dict(self):
        result = transcript_and_queue("https://vimeo.com/123")
        assert result["error"] == "not_a_youtube_url"
        assert result["url"] == "https://vimeo.com/123"

    def test_happy_path_returns_status_dict(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            return_value=[{"text": "Hello", "start": 0.0, "duration": 1.0}],
        ):
            result = transcript_and_queue("https://www.youtube.com/watch?v=dQw4w9WgXcQ")

        assert "item_id" in result
        assert result["status"] == "pending"
        assert "queued_at" in result

    def test_happy_path_writes_json_file(self):
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            return_value=[{"text": "Test transcript", "start": 0.0, "duration": 2.0}],
        ):
            result = transcript_and_queue(
                "https://www.youtube.com/watch?v=abc123", domain="ML"
            )

        item_id = result["item_id"]
        dest = self._tmp_dir / f"{item_id}.json"
        assert dest.exists(), "CaptureItem JSON file was not written"

        payload = json.loads(dest.read_text(encoding="utf-8"))
        assert payload["source_type"] == "youtube"
        assert payload["source_url"] == "https://www.youtube.com/watch?v=abc123"
        assert payload["raw_text"] == "Test transcript"
        assert payload["status"] == "pending"
        assert payload["domain"] == "ML"

    def test_empty_transcript_still_queues(self):
        """A video with no transcript should queue with raw_text="" — not an error."""
        with patch(
            "backend.services.youtube_svc.YouTubeTranscriptApi.get_transcript",
            side_effect=Exception("No transcript"),
        ):
            result = transcript_and_queue("https://youtu.be/noTranscriptId")

        # Should still succeed at the queue level.
        assert "item_id" in result
        assert result["status"] == "pending"

        # The persisted file should have raw_text == ""
        dest = self._tmp_dir / f"{result['item_id']}.json"
        payload = json.loads(dest.read_text(encoding="utf-8"))
        assert payload["raw_text"] == ""


if __name__ == "__main__":
    unittest.main()
