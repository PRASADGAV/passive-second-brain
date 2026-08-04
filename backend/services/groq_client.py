"""
groq_client.py — Groq API client wrapper for Passive Second Brain.

Wraps the official Groq Python SDK with:
- Retry on HTTP 429 (RateLimitError) with 5 s backoff, up to 3 attempts
- Structured logging of token usage and latency for every call
- Full traceback logging on non-429 errors before re-raising

Requirements: 8.6 (Groq + Llama 3.3 70B), 28.5 (token usage + latency visible)
"""

import logging
import os
import time
import traceback
from typing import List

import groq
from groq import RateLimitError

logger = logging.getLogger(__name__)


class GroqClient:
    """Thin wrapper around the official Groq SDK client."""

    MODEL = "llama-3.3-70b-versatile"

    def __init__(self) -> None:
        api_key = os.environ.get("GROQ_API_KEY")
        if not api_key:
            raise ValueError("GROQ_API_KEY environment variable is not set.")
        self.client = groq.Groq(api_key=api_key)
        self.model = self.MODEL
        logger.info(
            "GroqClient initialised",
            extra={"component": "groq_client", "model": self.model},
        )

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _create_completion(self, messages: List[dict], temperature: float) -> str:
        """
        Execute a single chat completion request and log token usage / latency.

        Returns the content string of the first choice.
        Retries up to 3 times on RateLimitError (HTTP 429) with 5 s delay.
        All other exceptions are logged with a full traceback then re-raised.
        """
        max_attempts = 3
        delay_seconds = 5

        for attempt in range(1, max_attempts + 1):
            t_start = time.time()
            try:
                response = self.client.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    temperature=temperature,
                )
                latency_ms = (time.time() - t_start) * 1000

                usage = response.usage
                logger.info(
                    "Groq API call succeeded",
                    extra={
                        "component": "groq_client",
                        "model": self.model,
                        "latency_ms": round(latency_ms, 2),
                        "token_usage": {
                            "prompt_tokens": usage.prompt_tokens,
                            "completion_tokens": usage.completion_tokens,
                            "total_tokens": usage.total_tokens,
                        },
                    },
                )

                return response.choices[0].message.content

            except RateLimitError as exc:
                latency_ms = (time.time() - t_start) * 1000
                if attempt < max_attempts:
                    logger.warning(
                        "Groq rate limit hit on attempt %d/%d — retrying in %ds",
                        attempt,
                        max_attempts,
                        delay_seconds,
                        extra={
                            "component": "groq_client",
                            "attempt": attempt,
                            "latency_ms": round(latency_ms, 2),
                        },
                    )
                    time.sleep(delay_seconds)
                else:
                    logger.error(
                        "Groq rate limit persisted after %d attempts",
                        max_attempts,
                        extra={
                            "component": "groq_client",
                            "attempt": attempt,
                            "latency_ms": round(latency_ms, 2),
                            "trace": traceback.format_exc(),
                        },
                    )
                    raise

            except Exception as exc:  # noqa: BLE001
                latency_ms = (time.time() - t_start) * 1000
                logger.error(
                    "Groq API call failed: %s",
                    exc,
                    extra={
                        "component": "groq_client",
                        "attempt": attempt,
                        "latency_ms": round(latency_ms, 2),
                        "trace": traceback.format_exc(),
                    },
                )
                raise

        # Should be unreachable, but satisfies type checkers.
        raise RuntimeError("Groq API call failed after all retry attempts.")

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def call(
        self,
        system_prompt: str,
        user_content: str,
        temperature: float = 0.1,
    ) -> str:
        """
        Single-turn chat completion.

        Args:
            system_prompt: The system instruction message.
            user_content:  The user turn content.
            temperature:   Sampling temperature (default 0.1 for deterministic output).

        Returns:
            The assistant's reply as a plain string.
        """
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ]
        return self._create_completion(messages, temperature)

    def call_with_history(
        self,
        messages: List[dict],
        temperature: float = 0.1,
    ) -> str:
        """
        Multi-turn chat completion using a pre-built messages list.

        Used by the RAG chat endpoint where the caller manages the full
        conversation history (system + alternating user/assistant turns).

        Args:
            messages:    A list of ``{"role": ..., "content": ...}`` dicts.
            temperature: Sampling temperature (default 0.1).

        Returns:
            The assistant's reply as a plain string.
        """
        return self._create_completion(messages, temperature)
