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