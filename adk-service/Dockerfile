FROM python:3.12-slim

WORKDIR /app

# Install dependencies first (layer cache)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# Pre-generate proto stubs at build time so the container starts faster
RUN mkdir -p generated && \
    python -m grpc_tools.protoc \
      -I proto \
      --python_out=generated \
      --grpc_python_out=generated \
      proto/voice.proto && \
    touch generated/__init__.py

EXPOSE 50051

CMD ["python", "main.py"]
