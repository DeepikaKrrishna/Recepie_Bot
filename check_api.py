import httpx, os
from dotenv import load_dotenv

load_dotenv()
res = httpx.post(
    'https://openrouter.ai/api/v1/chat/completions',
    headers={'Authorization': f"Bearer {os.getenv('OPENROUTER_API_KEY')}"},
    json={'model': 'meta-llama/llama-3.2-3b-instruct:free', 'messages': [{"role": "user", "content": "Recipe for Pancakes"}], 'stream': True}
)
print("LLaMA:", res.status_code, res.text)
