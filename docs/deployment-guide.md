# Deployment Guide — Railway + Vercel

## Prerequisites
- GitHub account with this repo pushed
- Railway account at [railway.app](https://railway.app)
- Vercel account at [vercel.com](https://vercel.com)

---

## Step 1 — Push to GitHub

```bash
cd C:\Users\prasa\Desktop\Mega
git init
git add .
git commit -m "Initial commit — Passive Second Brain"
git remote add origin https://github.com/YOUR_USERNAME/passive-second-brain.git
git push -u origin main
```

Make sure `.gitignore` includes: `backend/.env`, `.env`, `data/`, `node_modules/`

---

## Step 2 — Deploy Backend to Railway

1. Go to [railway.app](https://railway.app) → **New Project**
2. Click **Deploy from GitHub repo** → select your repo
3. Railway auto-detects the Dockerfile in `/backend`
4. Set these **Environment Variables** in Railway dashboard:
   ```
   GROQ_API_KEY=gsk_your_key_here
   NEO4J_URI=bolt://your-neo4j-host:7687
   NEO4J_USER=neo4j
   NEO4J_PASSWORD=your_password
   PSB_API_KEY=your-secret-key
   DEVELOPER_MODE=false
   CHROMA_HOST=your-chromadb-host
   CHROMA_PORT=8000
   PORT=8080
   PYTHONPATH=/app
   ```
5. Railway gives you a URL like: `https://psb-backend.railway.app`

**Note:** For Railway, you'll need Neo4j and ChromaDB also hosted.
- Neo4j: Use [Neo4j AuraDB free tier](https://neo4j.com/cloud/platform/aura-graph-database/) — free, cloud-hosted
- ChromaDB: Deploy as second Railway service using `chromadb/chroma:latest`

---

## Step 3 — Update CORS in backend

After getting your Railway URL, update `backend/main.py`:

```python
ALLOWED_ORIGINS: list[str] = [
    "http://localhost:5173",
    "https://your-frontend.vercel.app",  # add this
]
```

Commit and push — Railway auto-redeploys.

---

## Step 4 — Deploy Frontend to Vercel

1. Go to [vercel.com](https://vercel.com) → **New Project**
2. Import your GitHub repo
3. Set **Root Directory** to `frontend`
4. Set **Framework Preset** to `Vite`
5. Add **Environment Variables**:
   ```
   VITE_API_BASE_URL=https://psb-backend.railway.app
   VITE_API_KEY=your-secret-key
   VITE_DEVELOPER_MODE=false
   ```
6. Click **Deploy** — Vercel gives you `https://your-app.vercel.app`

---

## Step 5 — Update Extension for production

In `extension/background.js`, the `PSB_API_URL` defaults to `http://localhost:8090`.

For production, users need to set it via chrome.storage or you can hardcode the Railway URL:
```javascript
const { PSB_API_URL = 'https://psb-backend.railway.app', ... }
```

---

## Quick Summary

| Service | URL pattern | Cost |
|---------|-------------|------|
| Railway (backend) | `https://psb-XXX.railway.app` | Free $5 credits/month |
| Vercel (frontend) | `https://psb-XXX.vercel.app` | Free forever |
| Neo4j AuraDB | `neo4j+s://XXX.databases.neo4j.io` | Free 512MB |
| ChromaDB on Railway | second service | uses free credits |
