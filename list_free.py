import httpx

url = "https://openrouter.ai/api/v1/models"
res = httpx.get(url)
models = res.json().get('data', [])
free_models = [m['id'] for m in models if m.get('pricing', {}).get('prompt') == '0']

print("Actual Free Models:")
for m in free_models[:10]:
    print(m)
