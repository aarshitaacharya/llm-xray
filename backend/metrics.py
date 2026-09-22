"""Throughput and cost accounting for a single inference call."""
import time
from dataclasses import dataclass, field
from typing import Any, Optional

import config


def estimate_cost(input_tokens: int, output_tokens: int) -> float:
    """USD for one request at the configured per-1M-token rates."""
    return (
        input_tokens * config.INPUT_COST_PER_1M
        + output_tokens * config.OUTPUT_COST_PER_1M
    ) / 1_000_000


@dataclass
class RequestMeter:
    """Tracks wall-clock throughput and token cost across a streamed response.

    Output tokens come from Gemini's own usage metadata when the stream reports
    it. Until the final chunk arrives that number is unavailable, so interim
    frames fall back to a word-count estimate and the final frame corrects it.
    """

    input_tokens: int = 0
    output_tokens: int = 0
    started_at: float = field(default_factory=time.perf_counter)
    _exact_usage: bool = False

    def observe_chunk(self, text: str) -> None:
        """Record an interim chunk with a rough token estimate."""
        if not self._exact_usage:
            # ~0.75 words per token is the usual English rule of thumb.
            self.output_tokens += max(1, round(len(text.split()) / 0.75))

    def observe_usage(self, usage: Optional[Any]) -> None:
        """Replace estimates with Gemini's authoritative counts when available."""
        if usage is None:
            return
        prompt_tokens = getattr(usage, "prompt_token_count", None)
        candidate_tokens = getattr(usage, "candidates_token_count", None)
        if prompt_tokens:
            self.input_tokens = prompt_tokens
        if candidate_tokens:
            self.output_tokens = candidate_tokens
            self._exact_usage = True

    @property
    def elapsed_seconds(self) -> float:
        return max(time.perf_counter() - self.started_at, 1e-6)

    @property
    def tokens_per_second(self) -> float:
        return self.output_tokens / self.elapsed_seconds

    @property
    def cost_usd(self) -> float:
        return estimate_cost(self.input_tokens, self.output_tokens)

    def snapshot(self) -> dict:
        return {
            "input_tokens": self.input_tokens,
            "output_tokens": self.output_tokens,
            "elapsed_seconds": round(self.elapsed_seconds, 3),
            "tokens_per_second": round(self.tokens_per_second, 2),
            "cost_usd": round(self.cost_usd, 8),
            "exact_usage": self._exact_usage,
        }
