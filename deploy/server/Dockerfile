ARG PYTHON_IMAGE=python:3.12-slim
FROM ghcr.io/astral-sh/uv:0.13.7 AS uv
FROM ${PYTHON_IMAGE}
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
COPY deploy/server/pyproject.toml deploy/server/uv.lock ./
RUN uv sync --locked --no-dev --no-install-project
COPY deploy/server/manage.py ./
COPY deploy/server/portal ./portal
COPY deploy/feedback/server.py ./feedback/server.py
RUN mkdir -p /data /updates /static && chown 10001:10001 /data /updates /static
ENV PATH="/app/.venv/bin:$PATH" PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
USER 10001:10001
CMD ["sh", "-ec", "python manage.py migrate --noinput && python manage.py init_feedback && python manage.py collectstatic --noinput && exec gunicorn --no-control-socket --bind 0.0.0.0:8080 --worker-class gthread --threads 4 --access-logfile - portal.wsgi:application"]
