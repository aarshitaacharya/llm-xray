# LLM X-Ray

> A visual debugger for large language models. Seven live panels break an LLM
> into the parts that actually make it work — tokenization, embeddings,
> attention, sampling, hallucinations, throughput and the context window — and
> each one streams as the model produces it.

React + FastAPI + Gemini, in one container. Deployed and verified on AWS ECS
Fargate. See [Status](#status).

---

## Demo

![Dashboard Overview](images/1.png)

![Embedding Star Map and Attention View](images/2.png)

![Fact Check and Temperature Lab](images/3.png)

---

## Quick start

Needs Python 3.12+, Node 20+, and a free [Gemini API key](https://aistudio.google.com/apikey).

```bash
# backend — terminal 1
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt
echo 'GEMINI_API_KEY=your-key' > .env
uvicorn main:app --reload --port 8000

# frontend — terminal 2
cd frontend
npm install
npm run dev          # -> http://localhost:5173
```

Type a prompt, hit **RUN ANALYSIS**. No AWS account needed — SNS alerts stay
off and the context gauge says so.

### Or just run the container

```bash
docker build -t llm-xray .
docker run -p 8000:8000 -e GEMINI_API_KEY=your-key llm-xray   # -> http://localhost:8000
```

One image serves the API and the built dashboard on the same port, so there's
no CORS and nothing else to start.

---

## The seven panels

Each panel has its own SSE endpoint. Nothing waits for a full response.

| Panel | Endpoint | Streams |
|---|---|---|
| **Tokenizer** | `/api/stream/tokenize` | exact Gemini token count, then each chip in order |
| **Generation Stream** | `/api/stream/generate` | response chunks with live tokens/sec and cost |
| **Embedding Star Map** | `/api/stream/embeddings` | per-vector progress, then a 3D PCA projection |
| **Attention View** | `/api/stream/attention` | each word with its simulated attention over the prompt |
| **Probability Lab** | `/api/stream/temperature` | 3 concurrent calls; columns land in completion order |
| **Fact-Check** | `/api/stream/factcheck` | each audited claim as it's found |
| **Context Fuel Gauge** | `/api/stream/chat` | reply, context usage, SNS alert, purge at 80% |

Plus `GET /healthz` and `GET /api/config`.

**Three panels show approximations, and say so in the UI**: token chip
boundaries are visual (the *count* is real), attention is simulated from n-gram
similarity because Gemini's weights aren't public, and confidence scores are
the model's claims about itself. An observability tool that oversells its own
precision is worse than none.

---

## Architecture

```
React 19 + Vite                     FastAPI (Python 3.12)
┌────────────────────┐              ┌──────────────────────────────┐
│ 7 panels           │   SSE        │ 7 streaming endpoints        │
│ useSSE / streamSSE │ ───────────► │ /api/stream/*                │
└────────────────────┘              └──────────┬───────────────────┘
                                               │
                     ┌─────────────────────────┼──────────────────┐
                     ▼                         ▼                  ▼
                Gemini API              numpy SVD / PCA       Amazon SNS
             (generate, embed,           (768-d → 3-d)     (threshold alerts)
               count tokens)
```

Every endpoint speaks one wire format: `data:` frames carrying a `type`,
terminated by `data: [DONE]`. `EventSource` is GET-only and every panel POSTs a
body, so the client reads the `fetch` stream directly —
[`frontend/src/lib/sse.js`](frontend/src/lib/sse.js).

---

## Deploying to AWS

```bash
GEMINI_API_KEY=your-key ALERT_EMAIL=you@example.com ./infra/provision.sh
./infra/deploy.sh          # prints the public URL
./infra/teardown.sh        # deletes the service — stops all charges
```

`provision.sh` is idempotent (ECR, SNS, log group, two IAM roles, the key as an
SSM SecureString, cluster, security group). `deploy.sh` builds for
`linux/amd64` — Apple Silicon would otherwise push an arm64 image Fargate can't
start.

The key never touches the image or task definition: the **execution role**
pulls it from SSM at startup, and the **task role** can only `sns:Publish` to
one topic.

A 0.5 vCPU / 1 GB task plus its public IPv4 is about **$21/month** if left up.

---

## Tests

```bash
cd backend
pip install -r requirements-dev.txt
pytest -q          # 35 passed
```

All seven endpoints are tested against a mocked Gemini SDK — no key, no
network, no quota — pinning the things that break quietly: chips reassembling
into the original prompt, attention scores summing to 1, the meter preferring
Gemini's reported usage over its estimate, and a failed SNS publish never
reported as sent.

---

## Layout

```
backend/
  main.py           7 SSE endpoints
  streaming.py      SSE framing + blocking→async bridge
  analysis.py       tokenizing, embeddings, PCA, attention proxy
  metrics.py        tokens/sec and cost per request
  notifications.py  SNS publishing (best-effort)
  config.py         all env-driven settings
frontend/src/
  lib/sse.js        SSE client
  hooks/useSSE.js   useSSE + useManualSSE
  components/       one file per panel
infra/              provision / deploy / teardown
```

---

## Status

Deployed to ECS Fargate and verified end to end: all 7 endpoints healthy on the
live URL, the three temperature branches returning out of order (real
concurrency), cost and throughput from Gemini's own reported usage, and a real
SNS publish at the threshold. Torn down afterward, so nothing is running now —
`./infra/deploy.sh` brings it back in about two minutes.

---

## What's next

- Code-split the bundle; plotly's gl3d build is still ~2 MB of it.
- Real attention weights via an open-weights model, so the panel stops being a
  proxy.
- Persist sessions so the fuel gauge survives a refresh.
