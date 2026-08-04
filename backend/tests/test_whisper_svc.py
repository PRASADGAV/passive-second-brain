"""
Unit tests for backend/services/whisper_svc.py

Tests cover:
- transcribe: missing file, successful run, non-zero returncode, timeout,
  missing binary (FileNotFoundError), unreadable output file.
- transcribe_and_queue: happy path, failed transcription still queues,
  written JSON content validation.
"""

import json
import subprocess
import unittest
from pathlib import Path
from unittest.mock import MagicMock, mock_open, patch

from backend.services.whisper_svc import transcribe, transcribe_and_queue


class TestTranscribe(unittest.TestCase):
    # ------------------------------------------------------------------
    # File-not-found guard
    # ------------------------------------------------------------------

    def test_missing_audio_file_returns_empty(self):
        result = transcribe("data/voice/does_not_exist.wav")
        assert result == ""

    def test_missing_audio_file_does_not_raise(self):
        # Must be silent — no exception propagated.
        try:
            transcribe("/nonexistent/path/audio.mp3")
        except Exception as exc:
            self.fail(f"transcribe raised unexpectedly: {exc}")

    # ------------------------------------------------------------------
    # Happy path
    # ------------------------------------------------------------------

    def test_successful_transcription_returns_stripped_text(self, tmp_path=None):
        """whisper-cpp succeeds → read .txt file → return stripped transcript."""
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        txt_path = audio_path + ".txt"
        try:
            mock_result = MagicMock()
            mock_result.returncode = 0

            with patch("backend.services.whisper_svc.subprocess.run", return_value=mock_result):
                with patch(
                    "backend.services.whisper_svc.Path.read_text",
                    return_value="  Hello from Whisper.  \n",
                ):
                    result = transcribe(audio_path)

            assert result == "Hello from Whisper."
        finally:
            os.unlink(audio_path)

    def test_successful_transcription_calls_correct_command(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        try:
            mock_result = MagicMock()
            mock_result.returncode = 0

            with patch(
                "backend.services.whisper_svc.subprocess.run", return_value=mock_result
            ) as mock_run:
                with patch("backend.services.whisper_svc.Path.read_text", return_value="text"):
                    transcribe(audio_path)

            call_args = mock_run.call_args
            cmd = call_args[0][0]
            assert cmd[0] == "whisper-cpp"
            assert cmd[1] == audio_path
            assert "--output-txt" in cmd
            # Timeout and capture flags must be set
            assert call_args[1]["timeout"] == 1800
            assert call_args[1]["capture_output"] is True
        finally:
            os.unlink(audio_path)

    # ------------------------------------------------------------------
    # Non-zero returncode (Requirement 4.5 — preserve audio on failure)
    # ------------------------------------------------------------------

    def test_nonzero_returncode_returns_empty(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        try:
            mock_result = MagicMock()
            mock_result.returncode = 1
            mock_result.stderr = b"error: model file not found"

            with patch("backend.services.whisper_svc.subprocess.run", return_value=mock_result):
                result = transcribe(audio_path)

            assert result == ""
            # Audio file must still exist (not deleted)
            assert Path(audio_path).exists()
        finally:
            os.unlink(audio_path)

    # ------------------------------------------------------------------
    # Timeout (Requirement 4.5)
    # ------------------------------------------------------------------

    def test_timeout_returns_empty(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        try:
            with patch(
                "backend.services.whisper_svc.subprocess.run",
                side_effect=subprocess.TimeoutExpired(cmd="whisper-cpp", timeout=1800),
            ):
                result = transcribe(audio_path)

            assert result == ""
            assert Path(audio_path).exists()
        finally:
            os.unlink(audio_path)

    # ------------------------------------------------------------------
    # Missing binary (Requirement 4.5)
    # ------------------------------------------------------------------

    def test_missing_binary_returns_empty(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        try:
            with patch(
                "backend.services.whisper_svc.subprocess.run",
                side_effect=FileNotFoundError("No such file: whisper-cpp"),
            ):
                result = transcribe(audio_path)

            assert result == ""
            assert Path(audio_path).exists()
        finally:
            os.unlink(audio_path)

    # ------------------------------------------------------------------
    # Unreadable output .txt file
    # ------------------------------------------------------------------

    def test_unreadable_output_file_returns_empty(self):
        import tempfile, os

        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            audio_path = f.name

        try:
            mock_result = MagicMock()
            mock_result.returncode = 0

            with patch("backend.services.whisper_svc.subprocess.run", return_value=mock_result):
                with patch(
                    "backend.services.whisper_svc.Path.read_text",
                    side_effect=OSError("Permission denied"),
                ):
                    result = transcribe(audio_path)

            assert result == ""
        finally:
            os.unlink(audio_path)


class TestTranscribeAndQueue(unittest.TestCase):
    def setUp(self):
        self._tmp_dir = Path("data") / "capture_queue_whisper_test_tmp"
        self._patcher = patch(
            "backend.services.whisper_svc._CAPTURE_QUEUE_DIR", self._tmp_dir
        )
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        if self._tmp_dir.exists():
            for f in self._tmp_dir.iterdir():
                f.unlink()
            self._tmp_dir.rmdir()

    def _mock_transcribe(self, text: str):
        """Return a context manager that patches transcribe to return ``text``."""
        return patch("backend.services.whisper_svc.transcribe", return_value=text)

    # ------------------------------------------------------------------
    # Return value shape
    # ------------------------------------------------------------------

    def test_returns_item_id_status_queued_at(self):
        with self._mock_transcribe("Hello world"):
            result = transcribe_and_queue("data/voice/test.wav")

        assert "item_id" in result
        assert result["status"] == "pending"
        assert "queued_at" in result

    # ------------------------------------------------------------------
    # JSON file content
    # ------------------------------------------------------------------

    def test_writes_json_with_correct_fields(self):
        with self._mock_transcribe("Transcribed text"):
            result = transcribe_and_queue("data/voice/test.wav", domain="Science")

        dest = self._tmp_dir / f"{result['item_id']}.json"
        assert dest.exists(), "CaptureItem JSON file was not written"

        payload = json.loads(dest.read_text(encoding="utf-8"))
        assert payload["source_type"] == "voice"
        assert payload["source_url"] == "data/voice/test.wav"
        assert payload["raw_text"] == "Transcribed text"
        assert payload["status"] == "pending"
        assert payload["domain"] == "Science"

    def test_failed_transcription_still_queues(self):
        """Even when transcription returns "", we still enqueue the item."""
        with self._mock_transcribe(""):
            result = transcribe_and_queue("data/voice/broken.wav")

        assert "item_id" in result
        assert result["status"] == "pending"

        dest = self._tmp_dir / f"{result['item_id']}.json"
        payload = json.loads(dest.read_text(encoding="utf-8"))
        assert payload["raw_text"] == ""

    def test_domain_none_by_default(self):
        with self._mock_transcribe("Some transcript"):
            result = transcribe_and_queue("data/voice/test.wav")

        dest = self._tmp_dir / f"{result['item_id']}.json"
        payload = json.loads(dest.read_text(encoding="utf-8"))
        assert payload["domain"] is None

    def test_each_call_produces_unique_item_id(self):
        with self._mock_transcribe("text"):
            r1 = transcribe_and_queue("data/voice/a.wav")
            r2 = transcribe_and_queue("data/voice/b.wav")

        assert r1["item_id"] != r2["item_id"]


if __name__ == "__main__":
    unittest.main()
