"""Test fixtures that stand in for the Gemini SDK.

Every endpoint is exercised against these fakes so the SSE contract can be
verified without network access, an API key, or spending quota.
"""
import json
import os
import sys

import pytest

os.environ.setdefault("GEMINI_API_KEY", "test-key")
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


class FakeUsage:
    def __init__(self, prompt_tokens=11, candidate_tokens=7):
        self.prompt_token_count = prompt_tokens
        self.candidates_token_count = candidate_tokens
        self.total_token_count = prompt_tokens + candidate_tokens


class FakeChunk:
    def __init__(self, text, usage=None):
        self.text = text
        self.usage_metadata = usage


class FakeResponse:
    def __init__(self, text):
        self.text = text
        self.usage_metadata = FakeUsage()


class FakeChat:
    def __init__(self, chunks):
        self._chunks = chunks

    def send_message(self, prompt, stream=False):
        if not stream:
            return FakeResponse("".join(c.text for c in self._chunks))
        return iter(self._chunks)


class FakeModel:
    """Stands in for genai.GenerativeModel."""

    def __init__(self, chunks, single_response=None):
        self._chunks = chunks
        self._single = single_response

    def generate_content(self, prompt, stream=False, **kwargs):
        if stream:
            return iter(self._chunks)
        if self._single is not None:
            return FakeResponse(self._single(prompt))
        return FakeResponse("".join(c.text for c in self._chunks))

    def start_chat(self, history=None):
        return FakeChat(self._chunks)

    def count_tokens(self, contents=""):
        class Result:
            total_tokens = max(1, len(str(contents).split()))

        return Result()


DEFAULT_CHUNKS = [
    FakeChunk("Paris is "),
    FakeChunk("the capital "),
    FakeChunk("of France.", usage=FakeUsage()),
]


def single_response_for(prompt: str) -> str:
    """Routes non-streaming calls to a plausible reply for each meta-prompt."""
    if "fact-checker" in prompt:
        return json.dumps(
            [
                {"claim": "Paris", "verdict": "verified", "reason": "well established"},
                {"claim": "capital", "verdict": "uncertain", "reason": "ambiguous phrasing"},
            ]
        )
    if "SCORES:" in prompt:
        return "Paris is the capital. It is in France.\nSCORES: [0.95, 0.8]"
    return "Paris is the capital of France."


@pytest.fixture
def client(monkeypatch):
    import analysis
    import main
    from fastapi.testclient import TestClient

    monkeypatch.setattr(
        analysis,
        "get_model",
        lambda temperature=None: FakeModel(DEFAULT_CHUNKS, single_response=single_response_for),
    )
    monkeypatch.setattr(analysis, "count_tokens", lambda text: max(1, len(text.split())))
    # 8-dimensional stand-ins: PCA only needs more samples than components.
    monkeypatch.setattr(analysis, "embed", lambda text: [float(len(text) % 7) + i for i in range(8)])
    monkeypatch.setattr(
        analysis, "anchor_embedding", lambda i: [float(i) + j * 0.5 for j in range(8)]
    )

    with TestClient(main.app) as test_client:
        yield test_client


def parse_sse(body: str) -> list[dict]:
    """Collect the JSON frames from an SSE response body."""
    events = []
    for line in body.split("\n"):
        if not line.startswith("data: "):
            continue
        raw = line[6:].strip()
        if not raw or raw == "[DONE]":
            continue
        events.append(json.loads(raw))
    return events


def assert_terminated(body: str):
    assert body.rstrip().endswith("data: [DONE]"), "stream did not terminate with [DONE]"
