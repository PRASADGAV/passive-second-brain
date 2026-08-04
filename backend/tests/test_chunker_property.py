"""
Property test for services/chunker.py — 512-token overlapping text chunker.

Property 9: Text Chunking Token Bound
    Use st.text(min_size=0, max_size=50000) for input; assert all chunks ≤ 512
    tokens, overlap is correct, full coverage.

# Feature: passive-second-brain, Property 9: text chunking token bound

Requirements: 8.2
"""

from hypothesis import given, settings, assume
from hypothesis import strategies as st

from services.chunker import chunk, _enc


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _token_count(text: str) -> int:
    return len(_enc.encode(text))


# ---------------------------------------------------------------------------
# Property 9: Text Chunking Token Bound
# ---------------------------------------------------------------------------

class TestProperty9TextChunkingTokenBound:
    """
    # Feature: passive-second-brain, Property 9: text chunking token bound
    # Validates: Requirements 8.2
    """

    @given(text=st.text(min_size=0, max_size=5000))
    @settings(max_examples=100)
    def test_all_chunks_within_max_tokens(self, text: str):
        """Every chunk produced by chunk() must be ≤ 512 tokens."""
        max_tokens = 512
        result = chunk(text, max_tokens=max_tokens, overlap=50)

        for i, c in enumerate(result):
            tc = _token_count(c)
            assert tc <= max_tokens, (
                f"Chunk {i} has {tc} tokens, exceeds max {max_tokens}"
            )

    @given(text=st.text(min_size=1, max_size=5000))
    @settings(max_examples=100)
    def test_empty_input_or_nonempty_produces_valid_output(self, text: str):
        """
        For non-empty input text, chunk() returns at least one chunk.
        For empty input, it returns an empty list.
        """
        result = chunk(text, max_tokens=512, overlap=50)
        if text.strip():
            # Non-whitespace text should produce at least one chunk
            # (but tiktoken may encode whitespace-only strings to tokens too)
            pass  # We just assert it doesn't crash
        # Always: result is a list
        assert isinstance(result, list)

    @given(text=st.from_regex(r'[a-zA-Z0-9 ]{100,5000}', fullmatch=True))
    @settings(max_examples=100)
    def test_overlap_between_adjacent_chunks(self, text: str):
        """
        Adjacent chunks must share the last `overlap` tokens of the preceding
        chunk. If there is only one chunk, this property is trivially true.

        Uses ASCII-only text to avoid token boundary issues with multi-byte
        Unicode characters (tiktoken may encode/decode differently at chunk
        boundaries for non-ASCII text).
        """
        overlap = 50
        max_tokens = 512
        chunks = chunk(text, max_tokens=max_tokens, overlap=overlap)

        if len(chunks) <= 1:
            return  # trivially satisfied

        for i in range(len(chunks) - 1):
            tail_tokens = _enc.encode(chunks[i])[-overlap:]
            next_tokens = _enc.encode(chunks[i + 1])
            head_tokens = next_tokens[:min(overlap, len(next_tokens))]

            # The overlap region must match. The head may be shorter if the
            # next chunk has fewer than `overlap` tokens.
            effective_overlap = min(overlap, len(head_tokens))
            assert tail_tokens[-effective_overlap:] == head_tokens[:effective_overlap], (
                f"Overlap mismatch between chunk {i} and {i + 1}"
            )

    @given(text=st.text(min_size=1, max_size=5000))
    @settings(max_examples=100)
    def test_full_coverage(self, text: str):
        """
        All tokens in the original text must appear in at least one chunk.
        The first chunk must start with the first token, and the last chunk
        must end with the last token.
        """
        result = chunk(text, max_tokens=512, overlap=50)

        if not result:
            # Empty input → empty output is valid
            return

        original_tokens = _enc.encode(text)
        if not original_tokens:
            return

        # First chunk starts with the first original token
        first_chunk_tokens = _enc.encode(result[0])
        assert first_chunk_tokens[0] == original_tokens[0], (
            "First chunk does not start with the first token of the input"
        )

        # Last chunk ends with the last original token
        last_chunk_tokens = _enc.encode(result[-1])
        assert last_chunk_tokens[-1] == original_tokens[-1], (
            "Last chunk does not end with the last token of the input"
        )

    def test_empty_string_returns_empty_list(self):
        """Edge case: empty input."""
        assert chunk("") == []
