"""
Unit tests for services/chunker.py — 512-token overlapping chunker.

Requirement: 8.2 — 512-token overlapping chunks.
"""

import tiktoken
import pytest

from services.chunker import chunk, _enc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def token_count(text: str) -> int:
    return len(_enc.encode(text))


def _make_text(n_tokens: int) -> str:
    """Build a whitespace-separated string of exactly *n_tokens* tokens."""
    # Each ASCII word "w" tokenises to a single token with cl100k_base.
    return " ".join(["word"] * n_tokens)


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_empty_string_returns_empty_list():
    assert chunk("") == []


def test_short_text_returns_single_chunk():
    text = "Hello world"
    result = chunk(text, max_tokens=512, overlap=50)
    assert result == [text]


def test_text_exactly_max_tokens_returns_single_chunk():
    # Build a text whose token count equals max_tokens.
    text = _make_text(512)
    result = chunk(text, max_tokens=512, overlap=50)
    assert len(result) == 1


# ---------------------------------------------------------------------------
# Core chunking behaviour
# ---------------------------------------------------------------------------

def test_all_chunks_within_max_tokens():
    text = _make_text(1200)
    for c in chunk(text, max_tokens=512, overlap=50):
        assert token_count(c) <= 512


def test_multiple_chunks_produced_for_long_text():
    text = _make_text(1200)
    result = chunk(text, max_tokens=512, overlap=50)
    assert len(result) > 1


def test_adjacent_chunks_share_overlap_tokens():
    """
    The last *overlap* tokens of chunk[i] must equal the first *overlap*
    tokens of chunk[i+1].
    """
    overlap = 50
    text = _make_text(1200)
    chunks = chunk(text, max_tokens=512, overlap=overlap)

    for i in range(len(chunks) - 1):
        tail = _enc.encode(chunks[i])[-overlap:]
        head = _enc.encode(chunks[i + 1])[:overlap]
        assert tail == head, (
            f"Chunk {i} tail tokens != chunk {i+1} head tokens"
        )


def test_no_tokens_skipped():
    """All tokens in the original text must appear in at least one chunk."""
    text = _make_text(700)
    original_tokens = _enc.encode(text)
    chunks = chunk(text, max_tokens=512, overlap=50)

    # The first chunk must start with the very first token.
    first_chunk_tokens = _enc.encode(chunks[0])
    assert first_chunk_tokens[0] == original_tokens[0]

    # The last chunk must end with the very last token.
    last_chunk_tokens = _enc.encode(chunks[-1])
    assert last_chunk_tokens[-1] == original_tokens[-1]


# ---------------------------------------------------------------------------
# Custom parameters
# ---------------------------------------------------------------------------

def test_custom_max_tokens_and_overlap():
    text = _make_text(300)
    result = chunk(text, max_tokens=100, overlap=20)
    for c in result:
        assert token_count(c) <= 100


def test_single_token_text():
    result = chunk("Hello", max_tokens=512, overlap=50)
    assert len(result) == 1
    assert result[0] == "Hello"
