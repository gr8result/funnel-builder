# transcribe-local/Dockerfile
FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir fastapi uvicorn faster-whisper python-multipart

COPY server.py /app/server.py

EXPOSE 5055

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "5055"]
