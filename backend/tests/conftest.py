"""
conftest.py — shared pytest setup for the Passive Second Brain test suite.

Loads environment variables from the repo-root .env (or backend/.env) so
live-service tests such as test_extraction_quality can find GROQ_API_KEY
regardless of which directory pytest is invoked from.
"""

from pathlib import Path

from dotenv import load_dotenv

_backend_dir = Path(__file__).resolve().parent.parent
_repo_root = _backend_dir.parent

# Load backend/.env first (real keys), then repo-root .env fills any gaps
load_dotenv(_backend_dir / ".env")
load_dotenv(_repo_root / ".env", override=False)
