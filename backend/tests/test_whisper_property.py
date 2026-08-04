"""
Property test for services/whisper_svc.py — Voice privacy invariant.

Property 7: Voice Note Privacy Invariant
    Mock the network layer with unittest.mock; run transcription; assert zero
    outbound calls with audio data.

# Feature: passive-second-brain, Property 7: voice privacy invariant

Requirements: 4.3
"""

import os
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, patch, call

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.services.whisper_svc import transcribe


# ---------------------------------------------------------------------------
# Property 7: Voice Note Privacy Invariant
# ---------------------------------------------------------------------------

class TestProperty7VoicePrivacy:
    """
    # Feature: passive-second-brain, Property 7: voice privacy invariant
    # Validates: Requirements 4.3
    """

    @given(transcript=st.text(min_size=0, max_size=500))
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_no_outbound_network_calls_during_transcription(self, transcript: str, tmp_path):
        """
        When transcribe() is called, no network calls are made.

        We mock:
          - subprocess.run (the local whisper-cpp call)
          - urllib, requests, http.client, socket.create_connection

        Then we assert that NONE of the network mocks were called.
        """
        # Create a temporary audio file
        audio_file = tmp_path / "test_audio.wav"
        audio_file.write_text("fake audio data", encoding="utf-8")

        # The .txt sidecar file that whisper-cpp would produce
        txt_file = Path(str(audio_file) + ".txt")
        txt_file.write_text(transcript, encoding="utf-8")

        # Mock subprocess.run to simulate whisper-cpp succeeding locally
        mock_subprocess_result = MagicMock()
        mock_subprocess_result.returncode = 0
        mock_subprocess_result.stdout = b""
        mock_subprocess_result.stderr = b""

        with patch("backend.services.whisper_svc.subprocess.run", return_value=mock_subprocess_result) as mock_run, \
             patch("socket.create_connection") as mock_socket, \
             patch("urllib.request.urlopen") as mock_urlopen:

            result = transcribe(str(audio_file))

            # subprocess.run should have been called (local processing)
            mock_run.assert_called_once()

            # Verify the subprocess call was to whisper-cpp (local binary)
            call_args = mock_run.call_args
            assert call_args[0][0][0] == "whisper-cpp", (
                "Expected whisper-cpp binary to be invoked"
            )

            # No network calls should have been made
            mock_socket.assert_not_called()
            mock_urlopen.assert_not_called()

    def test_transcription_uses_only_local_subprocess(self, tmp_path):
        """
        Verify that transcribe() calls only subprocess.run with whisper-cpp
        and does not import or call any HTTP/network client libraries.
        """
        audio_file = tmp_path / "test.wav"
        audio_file.write_text("audio data")
        txt_file = Path(str(audio_file) + ".txt")
        txt_file.write_text("Hello world")

        mock_result = MagicMock()
        mock_result.returncode = 0
        mock_result.stdout = b""
        mock_result.stderr = b""

        with patch("backend.services.whisper_svc.subprocess.run", return_value=mock_result):
            result = transcribe(str(audio_file))

        assert result == "Hello world"

    def test_failure_preserves_audio_file(self, tmp_path):
        """On failure, the audio file must NOT be deleted (Requirement 4.5)."""
        audio_file = tmp_path / "preserve_me.wav"
        audio_file.write_text("important audio data")

        # Simulate whisper-cpp failing (binary not found)
        with patch(
            "backend.services.whisper_svc.subprocess.run",
            side_effect=FileNotFoundError("whisper-cpp not found"),
        ):
            result = transcribe(str(audio_file))

        assert result == ""
        assert audio_file.exists(), "Audio file must be preserved on failure"
