ARG PYTHON_IMAGE=python:3.12-slim
FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM ${PYTHON_IMAGE}
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY manage.py ./
COPY jobs.py ./
COPY config ./config
COPY portal ./portal
COPY feedback/server.py ./feedback/server.py
COPY stats/collect.py ./stats/collect.py
RUN mkdir -p /data /updates && chown 10001:10001 /data /updates
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
CMD ["sh", "-ec", "python manage.py migrate --noinput && python manage.py init_feedback && exec gunicorn --no-control-socket --bind 0.0.0.0:8080 --worker-class gthread --threads 4 --access-logfile - config.wsgi:application"]
