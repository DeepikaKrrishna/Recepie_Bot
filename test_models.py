import httpx

key = "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"
url = "https://openrouter.ai/api/v1/chat/completions"
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

models = [
    "mistralai/mistral-7b-instruct:free",
    "hugginfaceh4/zephyr-7b-beta:free",
    "gryphe/mythomist-7b:free",
    "openchat/openchat-7b:free"
]

for model in models:
    data = {
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
    }
    res = httpx.post(url, headers=headers, json=data)
    print(f"Model: {model} | Status: {res.status_code}")
    if res.status_code == 200:
        print("SUCCESS!")
        break
