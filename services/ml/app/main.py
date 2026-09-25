from fastapi import FastAPI

app = FastAPI(title="rag-ml")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
