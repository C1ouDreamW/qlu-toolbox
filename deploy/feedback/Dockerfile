FROM python:3.12-alpine

WORKDIR /app
COPY server.py .
RUN addgroup -g 10001 -S lumatile && adduser -u 10001 -S lumatile -G lumatile && mkdir /data && chown lumatile:lumatile /data
USER lumatile
EXPOSE 8080
CMD ["python", "server.py"]
