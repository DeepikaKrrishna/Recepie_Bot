"""Entry point kept at the repository root so `uvicorn main:app` still works.

All application code lives in the `app/` package.
"""

from app.main import create_app

app = create_app()

if __name__ == "__main__":
    import os

    import uvicorn

    uvicorn.run("main:app", host="127.0.0.1", port=int(os.getenv("PORT", "8000")), reload=False)
