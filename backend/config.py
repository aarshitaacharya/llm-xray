"""Runtime configuration for the LLM X-Ray backend.

Everything here is environment-driven so the same image runs locally and on ECS.
"""
import os

from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

CHAT_MODEL = os.getenv("CHAT_MODEL", "gemini-2.5-flash")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "models/gemini-embedding-001")

# gemini-2.5-flash context window.
CONTEXT_LIMIT = int(os.getenv("CONTEXT_LIMIT", 1_048_576))

# Fraction of the context window that trips the purge + SNS alert.
PURGE_THRESHOLD = float(os.getenv("PURGE_THRESHOLD", 0.80))

# Number of oldest messages dropped each time the threshold is crossed.
PURGE_BATCH_SIZE = int(os.getenv("PURGE_BATCH_SIZE", 2))

# Published gemini-2.5-flash rates, in USD per 1M tokens. Overridable because
# list prices move and a stale constant quietly makes every cost readout wrong.
INPUT_COST_PER_1M = float(os.getenv("INPUT_COST_PER_1M", 0.30))
OUTPUT_COST_PER_1M = float(os.getenv("OUTPUT_COST_PER_1M", 2.50))

# Set to an SNS topic ARN to enable threshold alerts. Unset = alerts disabled,
# which is the normal local-dev case.
SNS_TOPIC_ARN = os.getenv("SNS_TOPIC_ARN", "")
AWS_REGION = os.getenv("AWS_REGION", "us-east-1")

# Comma-separated list. The deployed build is served same-origin, so this only
# matters for the Vite dev server.
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", "http://localhost:5173").split(",")
    if origin.strip()
]

# Path to the built frontend. Present in the Docker image, absent in local dev.
STATIC_DIR = os.getenv("STATIC_DIR", "static")
