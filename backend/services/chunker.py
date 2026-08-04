"""
chunker.py — 512-token overlapping text chunker for Passive Second Brain.

Uses the cl100k_base tiktoken encoding (same tokeniser as GPT-4 and most
modern OpenAI models) to split text into overlapping windows of tokens,
then decodes each window back to a string.

Requirement: 8.2 — 512-token overlapping chunks.
"""

import logging
from typing import List

import tiktoken

logger = logging.getLogger(__name__)

# Reuse the encoder across calls — encoding loading is expensive.
_enc = tiktoken.get_encoding("cl100k_base")


def chunk(text: str, max_tokens: int = 512, overlap: int = 50) -> List[str]:
    """
    Split *text* into overlapping token-window chunks.

    Parameters
    ----------
    text:
        The raw input text to be chunked.
    max_tokens:
        Maximum number of tokens per chunk.  Defaults to 512.
    overlap:
        Number of tokens shared between adjacent chunks.  Defaults to 50.

    Returns
    -------
    List[str]
        A list of decoded chunk strings.  Returns ``[]`` for empty input and
        ``[text]`` when the full text is shorter than *max_tokens* tokens.

    Guarantees
    ----------
    * Every chunk is ≤ *max_tokens* tokens.
    * Adjacent chunks share exactly *overlap* tokens from the tail of the
      preceding chunk (except for the final chunk which may be shorter).
    """
    if not text:
        return []

    tokens: List[int] = _enc.encode(text)

    # Text fits in a single window — no splitting needed.
    if len(tokens) <= max_tokens:
        return [text]

    step = max_tokens - overlap
    chunks: List[str] = []
    start = 0

    while start < len(tokens):
        window = tokens[start : start + max_tokens]
        chunks.append(_enc.decode(window))
        start += step

    logger.debug(
        "chunker: produced %d chunk(s) from %d token(s) "
        "(max_tokens=%d, overlap=%d, step=%d)",
        len(chunks),
        len(tokens),
        max_tokens,
        overlap,
        step,
    )

    return chunks
