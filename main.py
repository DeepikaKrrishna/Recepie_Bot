import os
import json
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
import httpx
from pydantic import BaseModel

from ml_model import RecipeRecommender

load_dotenv()

app = FastAPI(title="AI Recipe Generator API")

# Setup CORS for local execution
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Initialize ML recommender
recommender = RecipeRecommender("recipes.csv")

OPENROUTER_API_KEY = "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"

class GenerateRequest(BaseModel):
    title: str

class QuestionRequest(BaseModel):
    question: str

@app.get("/suggest")
def suggest_recipes(ingredients: str = ""):
    """Uses ML to instantly suggest recipes based on ingredients"""
    if not ingredients:
        return {"suggestions": []}
    
    # Fast suggestion lookup
    titles = recommender.suggest_recipes(ingredients, top_n=5)
    return {"suggestions": titles}

@app.post("/generate")
async def generate_recipe(request: GenerateRequest):
    """Calls OpenRouter and streams the full recipe response"""
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="API Key not configured")

    async def stream_generator():
        url = "https://openrouter.ai/api/v1/chat/completions"
        headers = {
            "Authorization": f"Bearer {OPENROUTER_API_KEY}",
            "HTTP-Referer": "https://www.recipegen.com",
            "X-Title": "Recipe AI",
            "Content-Type": "application/json",
        }
        data = {
            "model": "google/gemma-3-4b-it:free",
            "messages": [
                {"role": "user", "content": f"You are a chef. Provide full recipe including ingredients and instructions. Use markdown formatting. Recipe for {request.title}"}
            ],
            "stream": True # Enable streaming
        }
        
        async with httpx.AsyncClient() as client:
            async with client.stream("POST", url, headers=headers, json=data, timeout=60.0) as response:
                if response.status_code != 200:
                    err_txt = await response.aread()
                    yield f"data: {json.dumps({'error': f'API error {response.status_code}: {err_txt.decode()}'})}\n\n"
                    return

                async for chunk in response.aiter_lines():
                    if chunk.startswith("data: "):
                        data_str = chunk[6:]
                        if data_str.strip() == "[DONE]":
                            break
                        try:
                            # We just forward the data chunk to the client
                            json_data = json.loads(data_str)
                            content = json_data.get("choices", [{}])[0].get("delta", {}).get("content", "")
                            if content:
                                yield f"data: {json.dumps({'text': content})}\n\n"
                        except json.JSONDecodeError:
                            continue

    return StreamingResponse(stream_generator(), media_type="text/event-stream")

@app.post("/ask")
async def ask_question(req: QuestionRequest):
    """Non-streaming question answering for simplicity"""
    if not OPENROUTER_API_KEY:
        raise HTTPException(status_code=500, detail="API Key not configured")
        
    url = "https://openrouter.ai/api/v1/chat/completions"
    headers = {
        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
        "HTTP-Referer": "https://www.recipegen.com",
        "X-Title": "Recipe AI",
        "Content-Type": "application/json",
    }
    data = {
        "model": "google/gemma-3-4b-it:free",
        "messages": [
            {"role": "user", "content": f"You are an AI chef that answers questions related to recipes. Keep answers concise. Question: {req.question}"}
        ]
    }
    
    async with httpx.AsyncClient() as client:
        res = await client.post(url, headers=headers, json=data, timeout=30.0)
        res_data = res.json()
        answer = res_data.get("choices", [{}])[0].get("message", {}).get("content", "Sorry, I couldn't answer that.")
        return {"answer": answer}
