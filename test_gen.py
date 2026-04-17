import httpx
import asyncio

async def test():
    async with httpx.AsyncClient() as client:
        res = await client.post("http://127.0.0.1:8001/generate", json={"title": "Pancakes"})
        print("Status code:", res.status_code)
        
        async with client.stream("POST", "http://127.0.0.1:8001/generate", json={"title": "Pancakes"}) as response:
            async for line in response.aiter_lines():
                print(repr(line))

asyncio.run(test())
