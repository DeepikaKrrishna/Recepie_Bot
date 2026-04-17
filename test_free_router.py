import httpx

key = "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"
url = "https://openrouter.ai/api/v1/chat/completions"
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

data = {
    "model": "openrouter/free",
    "messages": [{"role": "user", "content": "Hi"}],
}

res = httpx.post(url, headers=headers, json=data)
print(f"Status: {res.status_code}")
print(f"Body: {res.text}")
