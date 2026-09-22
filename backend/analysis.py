"""Model-facing analysis helpers: tokenizing, embedding projection, attention proxy."""
import json
import re
import threading
from typing import Optional

import google.generativeai as genai
import numpy as np

import config

genai.configure(api_key=config.GEMINI_API_KEY)

ANCHORS = [
    "dog", "cat", "king", "queen", "science", "art",
    "war", "peace", "love", "hate", "computer", "nature",
    "music", "mathematics", "cooking",
]

TEMPERATURES = [0.1, 0.7, 1.5]

_TOKEN_PATTERN = re.compile(r"\w+|[^\w\s]|\s+")

# The anchor set is fixed, so its embeddings are computed once and reused for
# every request instead of re-billing 15 calls per prompt.
_anchor_cache: Optional[np.ndarray] = None
_anchor_lock = threading.Lock()


def chunk_text(chunk) -> str:
    """Text of a streamed chunk, or "" when it carries none.

    The SDK's `.text` is a property that *raises* ValueError whenever the chunk
    has no parts — which is routine, not exceptional: the final usage-only chunk
    of a stream has none, and so does any response stopped for safety,
    recitation, or token limit. Letting that propagate would kill the SSE stream
    partway through an otherwise fine response.
    """
    try:
        return chunk.text or ""
    except (ValueError, AttributeError, IndexError):
        return ""


def get_model(temperature: Optional[float] = None) -> genai.GenerativeModel:
    generation_config = {"temperature": temperature} if temperature is not None else None
    return genai.GenerativeModel(config.CHAT_MODEL, generation_config=generation_config)


def count_tokens(text: str) -> int:
    return get_model().count_tokens(contents=text).total_tokens


def split_display_tokens(text: str) -> list[str]:
    """Approximate token boundaries for display, whitespace preserved."""
    return _TOKEN_PATTERN.findall(text)


def prompt_tokens(text: str) -> list[str]:
    """Non-whitespace tokens, used as the attention heat-map axis."""
    return [t for t in re.findall(r"\w+|[^\w\s]", text) if not t.isspace()]


def embed(text: str) -> list[float]:
    return genai.embed_content(model=config.EMBEDDING_MODEL, content=text)["embedding"]


def anchor_embedding(index: int) -> list[float]:
    """Embedding for a single anchor, populating the shared cache on first use."""
    global _anchor_cache
    with _anchor_lock:
        cached = _anchor_cache
    if cached is not None:
        return cached[index].tolist()
    return embed(ANCHORS[index])


def store_anchor_cache(vectors: list[list[float]]) -> None:
    global _anchor_cache
    with _anchor_lock:
        if _anchor_cache is None:
            _anchor_cache = np.array(vectors)


def anchors_are_cached() -> bool:
    with _anchor_lock:
        return _anchor_cache is not None


def project_to_3d(prompt_vector: list[float], anchor_vectors: list[list[float]]) -> dict:
    """PCA-reduce the prompt and anchors into a shared 3D space.

    Implemented directly on numpy's SVD rather than via scikit-learn. At this
    shape (16 samples x 768 dims, 3 components) sklearn's default solver is the
    *randomized* approximation, so this is both exact and one fewer heavy
    dependency — scikit-learn and scipy were ~300MB of the container image for
    this one call.
    """
    matrix = np.array([prompt_vector] + anchor_vectors, dtype=np.float64)
    centered = matrix - matrix.mean(axis=0)

    u, singular_values, vt = np.linalg.svd(centered, full_matrices=False)

    # Sign convention matching sklearn's svd_flip, so repeated runs on the same
    # input produce the same orientation instead of a mirrored plot.
    signs = np.sign(vt[np.arange(vt.shape[0]), np.abs(vt).argmax(axis=1)])
    u = u * signs

    reduced = (u * singular_values)[:, :3]

    total_variance = (singular_values ** 2).sum()
    if total_variance > 0:
        variance_ratio = ((singular_values ** 2)[:3] / total_variance).tolist()
    else:
        variance_ratio = [0.0, 0.0, 0.0]

    prompt_point = reduced[0]
    return {
        "prompt_point": {
            "x": float(prompt_point[0]),
            "y": float(prompt_point[1]),
            "z": float(prompt_point[2]),
        },
        "anchors": [
            {
                "label": ANCHORS[i],
                "x": float(reduced[i + 1][0]),
                "y": float(reduced[i + 1][1]),
                "z": float(reduced[i + 1][2]),
            }
            for i in range(len(ANCHORS))
        ],
        "variance_explained": variance_ratio,
    }


def _ngrams(text: str, n: int = 3) -> set[str]:
    text = text.lower()
    return {text[i:i + n] for i in range(len(text) - n + 1)}


def compute_attention(response_word: str, tokens: list[str]) -> list[float]:
    """Proxy for attention: character n-gram overlap between an output word and
    each input token, normalised to sum to 1.

    Gemini does not expose real attention weights. This approximates which input
    tokens an output word relates to; the UI labels it as simulated.
    """
    response_ng = _ngrams(response_word)
    scores = []
    for token in tokens:
        token_ng = _ngrams(token)
        if not response_ng or not token_ng:
            scores.append(0.0)
            continue
        union = len(response_ng | token_ng)
        scores.append(len(response_ng & token_ng) / union if union else 0.0)

    lowered = response_word.lower()
    for i, token in enumerate(tokens):
        token_lower = token.lower()
        if lowered in token_lower or token_lower in lowered:
            scores[i] = min(1.0, scores[i] + 0.5)

    total = sum(scores)
    return [s / total for s in scores] if total > 0 else scores


def split_sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]


def parse_confidence_response(raw: str) -> tuple[list[str], list[float]]:
    """Pull sentences and the model's self-reported confidence scores apart."""
    if "SCORES:" not in raw:
        sentences = split_sentences(raw)
        return sentences, [0.7] * len(sentences)

    answer_text, _, score_part = raw.partition("SCORES:")
    sentences = split_sentences(answer_text.strip())

    scores: list[float] = []
    match = re.search(r"\[.*?\]", score_part, re.DOTALL)
    if match:
        try:
            scores = [float(s) for s in json.loads(match.group())]
        except (json.JSONDecodeError, TypeError, ValueError):
            scores = []

    scores.extend([0.5] * (len(sentences) - len(scores)))
    return sentences, scores[:len(sentences)]


def parse_claims(raw: str) -> list[dict]:
    """Extract the fact-check JSON array, tolerating code fences and preamble."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    try:
        claims = json.loads(raw)
    except json.JSONDecodeError:
        match = re.search(r"\[.*\]", raw, re.DOTALL)
        if not match:
            return []
        try:
            claims = json.loads(match.group())
        except json.JSONDecodeError:
            return []

    if not isinstance(claims, list):
        return []
    return [c for c in claims if isinstance(c, dict) and "claim" in c]
