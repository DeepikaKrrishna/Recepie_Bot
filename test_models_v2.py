import httpx

key = "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"
url = "https://openrouter.ai/api/v1/chat/completions"
headers = {"Authorization": f"Bearer {key}", "Content-Type": "application/json"}

models = [
    "meta-llama/llama-3.1-8b-instruct:free",
    "google/gemma-2-9b-it:free",
    "qwen/qwen-2-7b-instruct:free",
    "mistralai/pixtral-12b:free",
    "microsoft/phi-3-mini-128k-instruct:free"
]

for model in models:
    data = {
        "model": model,
        "messages": [{"role": "user", "content": "Hi"}],
    }
    try:
        res = httpx.post(url, headers=headers, json=data, timeout=10.0)
        print(f"Model: {model} | Status: {res.status_code}")
        if res.status_code == 200:
            print("SUCCESS with " + model)
            break
        else:
            print(f"Body: {res.text[:100]}")
    except Exception as e:
        print(f"Error for {model}: {e}")
