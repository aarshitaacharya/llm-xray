"""Meta-prompts used by the analysis panels."""


def confidence_prompt(prompt: str) -> str:
    return f"""Answer this prompt: "{prompt}"

After your answer, on a new line write SCORES: followed by a JSON array of confidence scores (0.0-1.0) for each sentence in your answer, in order. Like:
SCORES: [0.95, 0.72, 0.45]

Be honest - lower scores for speculative or creative claims, higher for facts."""


def factcheck_prompt(response_text: str) -> str:
    return f"""You are a rigorous fact-checker. Analyze this AI-generated text and identify every distinct factual claim.

TEXT TO ANALYZE:
{response_text}

Return ONLY a JSON array. No explanation, no markdown, no code fences. Just raw JSON like this:
[
  {{"claim": "exact short phrase from text", "verdict": "verified", "reason": "why"}},
  {{"claim": "another phrase", "verdict": "uncertain", "reason": "why"}},
  {{"claim": "another phrase", "verdict": "hallucination", "reason": "why"}}
]

verdict must be exactly one of: "verified", "uncertain", "hallucination"
Keep claims short (under 10 words). Extract 3-8 claims maximum."""
