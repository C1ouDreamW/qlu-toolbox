FROM python:3.12-slim

WORKDIR /app
COPY server.py .
RUN mkdir /data && chown 10001:10001 /data
USER 10001:10001
EXPOSE 8080
CMD ["python", "server.py"]
