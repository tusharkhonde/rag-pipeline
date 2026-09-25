FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH" HF_HOME=/models

# "" (default): embeddings come from Ollama, no torch, no Hugging Face.
# "local": add sentence-transformers + torch and bake the bge weights into the image.
ARG ML_EXTRAS=""
ARG EMBEDDING_MODEL=BAAI/bge-base-en-v1.5

# Layer order = change frequency: deps, then model weights, then source.
# Editing app code rebuilds only the last layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project ${ML_EXTRAS:+--extra $ML_EXTRAS}

# Baked weights: no download at startup, works offline, every container runs identical weights.
RUN if [ "$ML_EXTRAS" = "local" ]; then \
      python -c "from sentence_transformers import SentenceTransformer as S; S('${EMBEDDING_MODEL}')"; \
    fi
ENV HF_HUB_OFFLINE=1

COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# `docker build --target test` : same image plus dev deps and tests.
FROM runtime AS test
ARG ML_EXTRAS=""
RUN uv sync --locked --no-install-project ${ML_EXTRAS:+--extra $ML_EXTRAS}
COPY tests ./tests
CMD ["pytest", "-q"]
