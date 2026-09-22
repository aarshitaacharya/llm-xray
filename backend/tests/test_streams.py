"""Contract tests for all seven SSE endpoints."""
import pytest
from conftest import assert_terminated, parse_sse

PROMPT = {"prompt": "What is the capital of France?"}


def types_in(events):
    return [e["type"] for e in events]


def test_healthz(client):
    body = client.get("/healthz").json()
    assert body["status"] == "ok"


def test_config_exposes_limits(client):
    body = client.get("/api/config").json()
    assert body["context_limit"] > 0
    assert 0 < body["purge_threshold"] <= 1
    assert body["output_cost_per_1m"] > 0


def test_generate_streams_tokens_then_final_metrics(client):
    res = client.post("/api/stream/generate", json=PROMPT)
    assert res.status_code == 200
    assert res.headers["content-type"].startswith("text/event-stream")
    assert_terminated(res.text)

    events = parse_sse(res.text)
    assert types_in(events)[0] == "start"
    assert types_in(events)[-1] == "metrics"

    text = "".join(e["text"] for e in events if e["type"] == "token")
    assert text == "Paris is the capital of France."

    final = events[-1]
    # The final frame must use Gemini's reported usage, not the running estimate.
    assert final["exact_usage"] is True
    assert final["output_tokens"] == 7
    assert final["tokens_per_second"] > 0
    assert final["cost_usd"] > 0


def test_tokenize_streams_every_chip(client):
    res = client.post("/api/stream/tokenize", json=PROMPT)
    assert_terminated(res.text)
    events = parse_sse(res.text)

    count_evt = events[0]
    assert count_evt["type"] == "count"
    chips = [e for e in events if e["type"] == "chip"]
    assert len(chips) == count_evt["total_chips"]
    # Chips must reassemble into the original prompt exactly.
    assert "".join(c["text"] for c in chips) == PROMPT["prompt"]
    assert [c["index"] for c in chips] == list(range(len(chips)))


def test_embeddings_reports_progress_then_projection(client):
    res = client.post("/api/stream/embeddings", json=PROMPT)
    assert_terminated(res.text)
    events = parse_sse(res.text)

    progress = [e for e in events if e["type"] == "progress"]
    assert progress[-1]["completed"] == progress[-1]["total"]

    projection = events[-1]
    assert projection["type"] == "projection"
    assert set(projection["prompt_point"]) == {"x", "y", "z"}
    assert len(projection["anchors"]) == 15
    assert len(projection["variance_explained"]) == 3


def test_attention_scores_are_normalised(client):
    res = client.post("/api/stream/attention", json=PROMPT)
    assert_terminated(res.text)
    events = parse_sse(res.text)

    tokens = events[0]
    assert tokens["type"] == "tokens"

    words = [e for e in events if e["type"] == "word"]
    assert words
    for word in words:
        assert len(word["scores"]) == len(tokens["tokens"])
        assert word["scores"] == [] or sum(word["scores"]) == pytest.approx(1.0, abs=1e-6)

    assert "".join(w["word"] for w in words).strip() == "Paris is the capital of France."


def test_temperature_returns_all_three_branches(client):
    res = client.post("/api/stream/temperature", json=PROMPT)
    assert_terminated(res.text)
    events = parse_sse(res.text)

    assert events[0]["type"] == "start"
    results = [e for e in events if e["type"] == "result"]
    assert len(results) == 3
    assert sorted(r["temperature"] for r in results) == [0.1, 0.7, 1.5]

    for result in results:
        assert len(result["scores"]) == len(result["sentences"])
        assert result["metrics"]["cost_usd"] > 0


def test_factcheck_streams_claims(client):
    res = client.post(
        "/api/stream/factcheck",
        json={"response_text": "Paris is the capital of France."},
    )
    assert_terminated(res.text)
    events = parse_sse(res.text)

    claims = [e for e in events if e["type"] == "claim"]
    assert [c["claim"] for c in claims] == ["Paris", "capital"]
    assert [c["verdict"] for c in claims] == ["verified", "uncertain"]
    assert events[-1] == {"type": "complete", "total": 2}


def test_factcheck_on_empty_text_is_a_noop(client):
    res = client.post("/api/stream/factcheck", json={"response_text": "   "})
    assert_terminated(res.text)
    assert parse_sse(res.text) == [{"type": "complete", "total": 0}]


def test_chat_streams_reply_and_usage(client):
    res = client.post(
        "/api/stream/chat",
        json={"messages": [{"role": "user", "content": "hello there"}]},
    )
    assert_terminated(res.text)
    events = parse_sse(res.text)

    reply = "".join(e["text"] for e in events if e["type"] == "token")
    assert reply == "Paris is the capital of France."

    usage = next(e for e in events if e["type"] == "usage")
    assert usage["total_tokens"] > 0
    assert 0 < usage["percent_used"] < 100
    assert usage["cost_usd"] > 0
    # Well under the threshold, so neither an alert nor a purge should fire.
    assert "alert" not in types_in(events)
    assert "purge" not in types_in(events)


def test_chat_fires_sns_alert_and_purge_past_threshold(client, monkeypatch):
    import config
    import notifications

    published = {}

    def fake_publish(subject, message):
        published["subject"] = subject
        published["message"] = message
        return {"sent": True, "message_id": "abc123def456"}

    monkeypatch.setattr(config, "CONTEXT_LIMIT", 4)
    monkeypatch.setattr(config, "SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:1:llm-xray")
    monkeypatch.setattr(notifications, "_publish_sync", fake_publish)

    res = client.post(
        "/api/stream/chat",
        json={
            "messages": [
                {"role": "user", "content": "one two three"},
                {"role": "model", "content": "four five six"},
                {"role": "user", "content": "seven eight nine"},
            ],
            "purged_count": 0,
            "session_id": "sess_test",
        },
    )
    assert_terminated(res.text)
    events = parse_sse(res.text)

    alert = next(e for e in events if e["type"] == "alert")
    assert alert["sent"] is True
    assert alert["message_id"] == "abc123def456"
    assert alert["percent_used"] >= 80

    purge = next(e for e in events if e["type"] == "purge")
    assert purge["purge_count"] == config.PURGE_BATCH_SIZE
    assert "sess_test" in published["message"]


def test_alert_reports_failure_rather_than_claiming_success(client, monkeypatch):
    """A broken SNS publish must not be reported to the UI as a sent alert."""
    import config
    import notifications

    monkeypatch.setattr(config, "CONTEXT_LIMIT", 4)
    monkeypatch.setattr(config, "SNS_TOPIC_ARN", "arn:aws:sns:us-east-1:1:llm-xray")
    monkeypatch.setattr(
        notifications,
        "_publish_sync",
        lambda subject, message: {"sent": False, "reason": "AccessDenied"},
    )

    res = client.post(
        "/api/stream/chat",
        json={"messages": [{"role": "user", "content": "one two three four five"}]},
    )
    alert = next(e for e in parse_sse(res.text) if e["type"] == "alert")
    assert alert["sent"] is False
    assert alert["reason"] == "AccessDenied"


def test_alert_disabled_when_no_topic_configured(client, monkeypatch):
    import config

    monkeypatch.setattr(config, "CONTEXT_LIMIT", 4)
    monkeypatch.setattr(config, "SNS_TOPIC_ARN", "")

    res = client.post(
        "/api/stream/chat",
        json={"messages": [{"role": "user", "content": "one two three four five"}]},
    )
    alert = next(e for e in parse_sse(res.text) if e["type"] == "alert")
    assert alert["sent"] is False
    assert "not configured" in alert["reason"]


def test_chunk_with_no_parts_does_not_kill_the_stream(client, monkeypatch):
    """A usage-only or safety-blocked chunk must be skipped, not propagated.

    The SDK's `.text` raises rather than returning empty for such chunks, so a
    naive accessor would truncate the response and emit an error frame.
    """
    import analysis
    from conftest import FakeChunk, FakeModel, FakeUsage, single_response_for

    class RaisingChunk:
        usage_metadata = FakeUsage()

        @property
        def text(self):
            raise ValueError("no valid Part; finish_reason is STOP")

    chunks = [FakeChunk("Paris is "), RaisingChunk(), FakeChunk("in France.")]
    monkeypatch.setattr(
        analysis,
        "get_model",
        lambda temperature=None: FakeModel(chunks, single_response=single_response_for),
    )

    res = client.post("/api/stream/generate", json=PROMPT)
    assert_terminated(res.text)
    events = parse_sse(res.text)

    assert "error" not in types_in(events)
    assert "".join(e["text"] for e in events if e["type"] == "token") == "Paris is in France."
    assert events[-1]["type"] == "metrics"


def test_purge_keeps_the_current_exchange(client, monkeypatch):
    """Purge must never drop the turn the user just sent or the reply to it."""
    import config

    monkeypatch.setattr(config, "CONTEXT_LIMIT", 4)
    monkeypatch.setattr(config, "SNS_TOPIC_ARN", "")

    # One active user turn -> two messages after the reply -> nothing purgeable.
    res = client.post(
        "/api/stream/chat",
        json={"messages": [{"role": "user", "content": "a b c d e"}], "purged_count": 6},
    )
    events = parse_sse(res.text)
    assert "purge" not in types_in(events)

    # Four active turns -> five after the reply -> the batch size is purgeable
    # regardless of how many were already purged in earlier rounds.
    res = client.post(
        "/api/stream/chat",
        json={
            "messages": [
                {"role": "user", "content": "one"},
                {"role": "model", "content": "two"},
                {"role": "user", "content": "three"},
                {"role": "model", "content": "four"},
            ],
            "purged_count": 6,
        },
    )
    purge = next(e for e in parse_sse(res.text) if e["type"] == "purge")
    assert purge["purge_count"] == config.PURGE_BATCH_SIZE
