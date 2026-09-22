"""Unit tests for the pure analysis and metrics helpers."""
import pytest

import analysis
import metrics


def test_display_tokens_round_trip():
    text = "Hello, world!  Multiple   spaces."
    assert "".join(analysis.split_display_tokens(text)) == text


def test_prompt_tokens_drop_whitespace():
    assert analysis.prompt_tokens("a b, c") == ["a", "b", ",", "c"]


def test_attention_scores_sum_to_one():
    scores = analysis.compute_attention("capital", ["What", "capital", "France"])
    assert sum(scores) == pytest.approx(1.0)
    # The exact match should dominate.
    assert scores[1] == max(scores)


def test_attention_with_no_overlap_does_not_divide_by_zero():
    scores = analysis.compute_attention("zzz", ["qqq"])
    assert scores == [0.0]


def test_parse_confidence_response_pairs_scores_to_sentences():
    sentences, scores = analysis.parse_confidence_response(
        "First claim. Second claim.\nSCORES: [0.9, 0.4]"
    )
    assert sentences == ["First claim.", "Second claim."]
    assert scores == [0.9, 0.4]


def test_parse_confidence_response_pads_missing_scores():
    sentences, scores = analysis.parse_confidence_response(
        "One. Two. Three.\nSCORES: [0.9]"
    )
    assert len(scores) == len(sentences) == 3
    assert scores[1:] == [0.5, 0.5]


def test_parse_confidence_response_without_scores_block():
    sentences, scores = analysis.parse_confidence_response("Just an answer.")
    assert sentences == ["Just an answer."]
    assert scores == [0.7]


@pytest.mark.parametrize(
    "raw",
    [
        '[{"claim": "x", "verdict": "verified", "reason": "r"}]',
        '```json\n[{"claim": "x", "verdict": "verified", "reason": "r"}]\n```',
        'Here you go:\n[{"claim": "x", "verdict": "verified", "reason": "r"}]',
    ],
)
def test_parse_claims_tolerates_fences_and_preamble(raw):
    assert analysis.parse_claims(raw) == [
        {"claim": "x", "verdict": "verified", "reason": "r"}
    ]


@pytest.mark.parametrize("raw", ["not json at all", "[", '{"claim": "x"}', "[1, 2, 3]"])
def test_parse_claims_returns_empty_on_garbage(raw):
    assert analysis.parse_claims(raw) == []


def test_estimate_cost_uses_separate_input_output_rates():
    import config

    cost = metrics.estimate_cost(1_000_000, 1_000_000)
    assert cost == pytest.approx(config.INPUT_COST_PER_1M + config.OUTPUT_COST_PER_1M)


def test_meter_prefers_reported_usage_over_estimate():
    class Usage:
        prompt_token_count = 100
        candidates_token_count = 250

    meter = metrics.RequestMeter()
    meter.observe_chunk("some words here")
    assert meter.output_tokens > 0

    meter.observe_usage(Usage())
    assert meter.output_tokens == 250
    assert meter.input_tokens == 100

    # Later chunks must not corrupt an exact count.
    meter.observe_chunk("more words")
    assert meter.output_tokens == 250


def test_meter_tokens_per_second_is_finite_immediately():
    meter = metrics.RequestMeter()
    meter.observe_chunk("word")
    assert meter.tokens_per_second > 0
    assert meter.snapshot()["elapsed_seconds"] >= 0


def test_projection_matches_an_exact_reference_pca():
    """The hand-rolled SVD projection must agree with a textbook PCA."""
    import numpy as np

    rng = np.random.default_rng(7)
    # Rank-3 data, so three components should capture essentially all variance.
    basis = rng.normal(size=(3, 64))
    matrix = rng.normal(size=(16, 3)) @ basis

    result = analysis.project_to_3d(matrix[0].tolist(), [v.tolist() for v in matrix[1:]])

    centered = matrix - matrix.mean(axis=0)
    _, singular_values, _ = np.linalg.svd(centered, full_matrices=False)
    expected_ratio = ((singular_values**2)[:3] / (singular_values**2).sum()).tolist()

    assert result["variance_explained"] == pytest.approx(expected_ratio, abs=1e-12)
    assert result["variance_explained"] == sorted(result["variance_explained"], reverse=True)
    assert sum(result["variance_explained"]) == pytest.approx(1.0, abs=1e-9)
    assert len(result["anchors"]) == 15


def test_projection_is_deterministic():
    """Repeated runs must not mirror the plot."""
    vectors = [[float((i * 7 + j * 3) % 11) for j in range(32)] for i in range(16)]
    first = analysis.project_to_3d(vectors[0], vectors[1:])
    second = analysis.project_to_3d(vectors[0], vectors[1:])
    assert first == second


def test_projection_survives_identical_vectors():
    """Zero variance must not produce NaNs in the coordinates."""
    import math

    vectors = [[1.0] * 16 for _ in range(16)]
    result = analysis.project_to_3d(vectors[0], vectors[1:])
    assert result["variance_explained"] == [0.0, 0.0, 0.0]
    for axis in ("x", "y", "z"):
        assert math.isfinite(result["prompt_point"][axis])
