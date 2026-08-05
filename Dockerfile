# Step 1: Build Frontend (React + Vite)
FROM node:20-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm install
COPY frontend/ ./
ENV VITE_API_BASE_URL=""
RUN npm run build

# Step 2: Build Backend (FastAPI Python) & Serve Everything
FROM python:3.11-slim

# Create non-root user for Hugging Face Spaces (UID 1000)
RUN useradd -m -u 1000 user
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend code
COPY backend/ ./backend

# Copy built frontend static files into /app/static
COPY --from=frontend-builder /app/frontend/dist ./static

# Set ownership to non-root user
RUN chown -R user:user /app
USER user

# Hugging Face default port is 7860
ENV PORT=7860
ENV PYTHONPATH=/app
ENV CHROMA_PERSIST_DIR=/app/data/chroma

EXPOSE 7860

CMD ["python", "-m", "uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "7860"]
