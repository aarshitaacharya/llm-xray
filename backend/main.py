from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
import json
from dotenv import load_dotenv
import google.generativeai as genai
import os
import re
import numpy as np
from sklearn.decomposition import PCA

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = genai.GenerativeModel("gemini-2.5-flash")

@app.get("/")
def health():
    return {"status": "running"}

@app.post("/api/generate")
async def generate(data: dict):
    prompt = data.get("prompt", "")
    response = model.generate_content(prompt)
    return {"text": response.text}

@app.get("/models")
def list_models():
    return {"models": [m.name for m in genai.list_models()]}

@app.post("/api/tokenize")
async def tokenize(data: dict):
    prompt = data.get("prompt", "")

    result = model.count_tokens(contents=prompt)
    token_count = result.total_tokens

    tokens = re.findall(r"\w+|[^\w\s]|\s+", prompt)
    
    return {
        "token_count": token_count,
        "tokens": tokens
    }

ANCHORS = [
    "dog", "cat", "king", "queen", "science", "art",
    "war", "peace", "love", "hate", "computer", "nature",
    "music", "mathematics", "cooking"
]

embedding_model = "models/gemini-embedding-001"

def get_embedding(text: str) -> list[float]:
    result = genai.embed_content(model=embedding_model, content=text)
    return result["embedding"]

@app.post("/api/embeddings")
async def embeddings(data: dict):
    prompt = data.get("prompt", "")

    # Get embedding for the user's prompt
    prompt_embedding = get_embedding(prompt)

    # Get embeddings for all anchors
    anchor_embeddings = [get_embedding(anchor) for anchor in ANCHORS]

    # Stack everything: [prompt] + anchors
    all_vectors = np.array([prompt_embedding] + anchor_embeddings)

    # Reduce to 3D with PCA
    pca = PCA(n_components=3)
    reduced = pca.fit_transform(all_vectors).tolist()

    prompt_point = reduced[0]
    anchor_points = [
        {"label": ANCHORS[i], "x": reduced[i+1][0], "y": reduced[i+1][1], "z": reduced[i+1][2]}
        for i in range(len(ANCHORS))
    ]

    return {
        "prompt_point": {"x": prompt_point[0], "y": prompt_point[1], "z": prompt_point[2]},
        "anchors": anchor_points,
        "variance_explained": pca.explained_variance_ratio_.tolist()
    }

def compute_attention(response_word: str, prompt_tokens: list[str]) -> list[float]:
    """
    Proxy for attention: cosine similarity between response word
    and each prompt token using character n-gram overlap.
    """
    def ngrams(text, n=3):
        text = text.lower()
        return set(text[i:i+n] for i in range(len(text) - n + 1))

    response_ng = ngrams(response_word)
    scores = []
    for token in prompt_tokens:
        token_ng = ngrams(token)
        if not response_ng or not token_ng:
            scores.append(0.0)
            continue
        intersection = len(response_ng & token_ng)
        union = len(response_ng | token_ng)
        scores.append(intersection / union if union else 0.0)

    # Boost: exact substring match
    for i, token in enumerate(prompt_tokens):
        if response_word.lower() in token.lower() or token.lower() in response_word.lower():
            scores[i] = min(1.0, scores[i] + 0.5)

    # Normalize so scores sum to 1
    total = sum(scores)
    if total > 0:
        scores = [s / total for s in scores]

    return scores

@app.post("/api/attention-stream")
async def attention_stream(data: dict):
    prompt = data.get("prompt", "")
    import re
    prompt_tokens = [t for t in re.findall(r"\w+|[^\w\s]", prompt) if not t.isspace()]

    def generate():
        response = model.generate_content(prompt, stream=True)
        buffer = ""

        for chunk in response:
            if not chunk.text:
                continue
            buffer += chunk.text
            # Emit word by word
            words = buffer.split(" ")
            for word in words[:-1]:  # hold last partial word
                clean = word.strip()
                if not clean:
                    continue
                scores = compute_attention(clean, prompt_tokens)
                payload = json.dumps({
                    "word": word + " ",
                    "scores": scores,
                    "tokens": prompt_tokens,
                })
                yield f"data: {payload}\n\n"
            buffer = words[-1]  # keep remainder

        # Flush last word
        if buffer.strip():
            scores = compute_attention(buffer.strip(), prompt_tokens)
            payload = json.dumps({
                "word": buffer,
                "scores": scores,
                "tokens": prompt_tokens,
            })
            yield f"data: {payload}\n\n"

        yield "data: [DONE]\n\n"

    return StreamingResponse(generate(), media_type="text/event-stream")

@app.post("/api/temperature-lab")
async def temperature_lab(data: dict):
    prompt = data.get("prompt", "")
    temperatures = [0.1, 0.7, 1.5]

    async def generate_at_temp(temp: float) -> dict:
        import asyncio
        meta_prompt = f"""Answer this prompt: "{prompt}"

After your answer, on a new line write SCORES: followed by a JSON array of confidence scores (0.0-1.0) for each sentence in your answer, in order. Like:
SCORES: [0.95, 0.72, 0.45]

Be honest — lower scores for speculative or creative claims, higher for facts."""

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None,
            lambda: genai.GenerativeModel(
                "models/gemini-2.5-flash",
                generation_config={"temperature": temp}
            ).generate_content(meta_prompt)
        )

        raw = response.text
        sentences = []
        scores = []

        if "SCORES:" in raw:
            parts = raw.split("SCORES:")
            answer_text = parts[0].strip()
            score_part = parts[1].strip()
            try:
                import re
                score_json = re.search(r'\[.*?\]', score_part, re.DOTALL)
                if score_json:
                    scores = json.loads(score_json.group())
            except:
                scores = []

            # Split into sentences
            import re
            sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', answer_text) if s.strip()]
        else:
            import re
            sentences = [s.strip() for s in re.split(r'(?<=[.!?])\s+', raw) if s.strip()]
            scores = [0.7] * len(sentences)

        # Pad/trim scores to match sentences
        while len(scores) < len(sentences):
            scores.append(0.5)
        scores = scores[:len(sentences)]

        return {
            "temperature": temp,
            "sentences": sentences,
            "scores": scores,
        }

    import asyncio
    results = await asyncio.gather(*[generate_at_temp(t) for t in temperatures])
    return {"results": list(results)}

@app.post("/api/factcheck")
async def factcheck(data: dict):
    response_text = data.get("response_text", "")

    audit_prompt = f"""You are a rigorous fact-checker. Analyze this AI-generated text and identify every distinct factual claim.

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

    response = model.generate_content(
        audit_prompt,
        generation_config={"temperature": 0.1}
    )

    raw = response.text.strip()

    # Strip markdown code fences if model ignores instructions
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)

    try:
        claims = json.loads(raw)
    except json.JSONDecodeError:
        # Fallback: try to extract array from anywhere in the text
        match = re.search(r'\[.*\]', raw, re.DOTALL)
        if match:
            claims = json.loads(match.group())
        else:
            claims = []

    return {"claims": claims}


CONTEXT_LIMIT = 1048576  # gemini-2.5-flash max context

@app.post("/api/chat")
async def chat(data: dict):
    messages = data.get("messages", [])
    
    # Build conversation for Gemini
    history = []
    for msg in messages[:-1]:  # all but last
        history.append({
            "role": msg["role"],
            "parts": [msg["content"]]
        })
    
    current_prompt = messages[-1]["content"] if messages else ""
    
    # Count tokens for the full conversation
    full_text = " ".join(m["content"] for m in messages)
    token_result = model.count_tokens(contents=full_text)
    total_tokens = token_result.total_tokens
    
    # Generate response with history
    chat_session = model.start_chat(history=history)
    response = chat_session.send_message(current_prompt)
    
    return {
        "response": response.text,
        "total_tokens": total_tokens,
        "context_limit": CONTEXT_LIMIT,
        "percent_used": round((total_tokens / CONTEXT_LIMIT) * 100, 2),
    }