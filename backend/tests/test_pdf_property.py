"""
Property tests for services/pdf_svc.py

Property 5: PDF Page-by-Page Completeness
    Use st.integers(1, 100) for N; mock fitz to return N non-empty strings;
    assert len(result) == N.

Property 6: PDF Partial Failure Resilience
    Use st.integers(1, 50) for failure page K; assert all non-K pages extracted
    and exactly one failure log entry.

# Feature: passive-second-brain, Property 5: pdf page completeness
# Feature: passive-second-brain, Property 6: pdf partial failure resilience

Requirements: 3.1, 3.2, 3.5
"""

import logging
from unittest.mock import MagicMock, patch

from hypothesis import HealthCheck, given, settings
from hypothesis import strategies as st

from backend.services.pdf_svc import extract_pdf


# ---------------------------------------------------------------------------
# Helpers — build a mock fitz.Document with N pages
# ---------------------------------------------------------------------------

def _make_mock_page(text: str, should_raise: bool = False):
    """Return a mock fitz.Page whose .get_text() returns *text*."""
    page = MagicMock()
    if should_raise:
        page.get_text.side_effect = RuntimeError("simulated page failure")
    else:
        page.get_text.return_value = text
    return page


def _make_mock_doc(pages):
    """Return a mock fitz.Document containing the given mock-page list."""
    doc = MagicMock()
    doc.page_count = len(pages)
    doc.__getitem__ = lambda self, idx: pages[idx]
    doc.close = MagicMock()
    return doc


# ---------------------------------------------------------------------------
# Property 5: PDF Page-by-Page Completeness
# ---------------------------------------------------------------------------

class TestProperty5PageCompleteness:
    """
    # Feature: passive-second-brain, Property 5: pdf page completeness
    # Validates: Requirements 3.1, 3.2
    """

    @given(n=st.integers(min_value=1, max_value=100))
    @settings(max_examples=100)
    def test_result_length_equals_page_count(self, n: int):
        """For any PDF with N pages, extract_pdf must return exactly N strings."""
        pages = [_make_mock_page(f"Page {i} text") for i in range(n)]
        mock_doc = _make_mock_doc(pages)

        with patch("backend.services.pdf_svc.fitz") as mock_fitz:
            mock_fitz.open.return_value = mock_doc
            result = extract_pdf("dummy.pdf")

        assert len(result) == n, f"Expected {n} page strings, got {len(result)}"

    @given(n=st.integers(min_value=1, max_value=100))
    @settings(max_examples=100)
    def test_all_pages_contain_text(self, n: int):
        """Every page string should be non-empty when all pages succeed."""
        pages = [_make_mock_page(f"Page {i} content") for i in range(n)]
        mock_doc = _make_mock_doc(pages)

        with patch("backend.services.pdf_svc.fitz") as mock_fitz:
            mock_fitz.open.return_value = mock_doc
            result = extract_pdf("dummy.pdf")

        for i, text in enumerate(result):
            assert text != "", f"Page {i} should have non-empty text"


# ---------------------------------------------------------------------------
# Property 6: PDF Partial Failure Resilience
# ---------------------------------------------------------------------------

class TestProperty6PartialFailure:
    """
    # Feature: passive-second-brain, Property 6: pdf partial failure resilience
    # Validates: Requirements 3.5
    """

    @given(
        n=st.integers(min_value=2, max_value=50),
        data=st.data(),
    )
    @settings(max_examples=100)
    def test_single_page_failure_produces_empty_string(self, n: int, data):
        """
        When exactly one page fails, the result list still has N entries.
        The failed page is represented by an empty string.
        All other pages contain their expected text.
        """
        # Pick which page will fail
        fail_index = data.draw(st.integers(min_value=0, max_value=n - 1))

        pages = []
        for i in range(n):
            if i == fail_index:
                pages.append(_make_mock_page("", should_raise=True))
            else:
                pages.append(_make_mock_page(f"Page {i} content"))

        mock_doc = _make_mock_doc(pages)

        with patch("backend.services.pdf_svc.fitz") as mock_fitz:
            mock_fitz.open.return_value = mock_doc
            result = extract_pdf("test.pdf")

        # Must still have exactly N entries
        assert len(result) == n, f"Expected {n} entries, got {len(result)}"

        # Failed page must be empty string
        assert result[fail_index] == "", (
            f"Failed page {fail_index} should be an empty string"
        )

        # All other pages must have their text
        for i in range(n):
            if i != fail_index:
                assert result[i] == f"Page {i} content", (
                    f"Page {i} should contain its expected text"
                )

    @given(n=st.integers(min_value=2, max_value=50), data=st.data())
    @settings(max_examples=100, suppress_health_check=[HealthCheck.function_scoped_fixture])
    def test_failure_logged_exactly_once(self, n: int, data, caplog):
        """Exactly one warning log entry for the single failed page."""
        fail_index = data.draw(st.integers(min_value=0, max_value=n - 1))

        pages = []
        for i in range(n):
            if i == fail_index:
                pages.append(_make_mock_page("", should_raise=True))
            else:
                pages.append(_make_mock_page(f"Page {i}"))

        mock_doc = _make_mock_doc(pages)

        caplog.clear()
        with caplog.at_level(logging.WARNING):
            with patch("backend.services.pdf_svc.fitz") as mock_fitz:
                mock_fitz.open.return_value = mock_doc
                extract_pdf("test.pdf")

        # Count log records that mention page extraction failure
        failure_records = [
            r for r in caplog.records
            if "page extraction failed" in r.message.lower()
        ]
        assert len(failure_records) == 1, (
            f"Expected exactly 1 page-failure log, got {len(failure_records)}"
        )
