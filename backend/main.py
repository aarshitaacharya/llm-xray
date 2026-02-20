from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
import google.generativeai as genai
import os

load_dotenv()
genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)

model = genai.GenerativeModel("gemini-1.5-flash")

@app.get("/")
def health():
    return {"status": "running"}

@app.post("/api/generate")
async def generate(data: dict):
    prompt = data.get("prompt", "")
    response = model.generate_content(prompt)
    return {"text": response.text}