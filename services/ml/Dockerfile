FROM python:3.12-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH="/app/.venv/bin:$PATH"

# Dependencies first, source second: code edits don't invalidate the dependency layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project

COPY app ./app
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]

# `docker build --target test` : same image plus dev deps and tests.
FROM runtime AS test
RUN uv sync --locked --no-install-project
COPY tests ./tests
CMD ["pytest", "-q"]
