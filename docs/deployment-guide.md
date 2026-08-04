# 100% Free Deployment Guide — Render + Vercel + Neo4j AuraDB

This guide provides complete instructions to deploy the **Passive Second Brain** application **completely free of charge** (no credit card required).

---

## 🏗️ Architecture & Services Overview

| Service | Platform | Tier | Purpose |
| :--- | :--- | :--- | :--- |
| **Frontend** | **Vercel** | Free Tier | React + Vite UI |
| **Backend API** | **Render** | Free Web Service | FastAPI Python Server |
| **Graph Database** | **Neo4j AuraDB** | Free Tier (512MB / 200k nodes) | Knowledge Graph Storage |
| **Vector Store** | **Qdrant Cloud / Chroma** | Free Tier | RAG / Embeddings |

---

## Step 1 — Set Up Free Neo4j AuraDB Graph Database

1. Go to [neo4j.com/cloud/aura/](https://neo4j.com/cloud/aura/) and sign up for a **Free Account**.
2. Click **Create Database** → Select **Neo4j AuraDB Free**.
3. Download or copy your credentials immediately:
   - `NEO4J_URI`: e.g. `neo4j+s://xxxxxxxx.databases.neo4j.io`
   - `NEO4J_USER`: `neo4j`
   - `NEO4J_PASSWORD`: `your-generated-password`

---

## Step 2 — Deploy Backend API to Render (Free Web Service)

1. Sign up at [render.com](https://render.com).
2. Click **New +** → **Blueprints** (or **Web Service**).
3. Connect your GitHub repository `PRASADGAV/passive-second-brain`.
4. Configure Web Service settings:
   - **Root Directory**: `backend`
   - **Environment**: `Python 3`
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `uvicorn main:app --host 0.0.0.0 --port $PORT`
   - **Instance Type**: **Free**
5. Add **Environment Variables** in Render:
   - `GROQ_API_KEY`: `your-groq-api-key`
   - `NEO4J_URI`: `neo4j+s://xxxxxxxx.databases.neo4j.io`
   - `NEO4J_USER`: `neo4j`
   - `NEO4J_PASSWORD`: `your-generated-password`
   - `PSB_API_KEY`: `your-secret-api-key`
   - `PORT`: `10000`
6. Click **Create Web Service**. Once deployed, copy your backend URL (e.g., `https://psb-backend.onrender.com`).

---

## Step 3 — Update CORS in Backend

Update `backend/main.py` with your Vercel URL once generated:

```python
ALLOWED_ORIGINS: list[str] = [
    "http://localhost:5173",
    "https://your-frontend.vercel.app",
]
```

Commit & push updates:
```bash
git add .
git commit -m "Update CORS origins for Vercel deployment"
git push origin main
```

---

## Step 4 — Deploy Frontend to Vercel (Free Frontend Hosting)

1. Go to [vercel.com](https://vercel.com) and log in with GitHub.
2. Click **Add New...** → **Project** → Import `passive-second-brain`.
3. Configure the Deployment:
   - **Root Directory**: Select `frontend`
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
4. Add **Environment Variables**:
   - `VITE_API_BASE_URL`: `https://psb-backend.onrender.com`
   - `VITE_API_KEY`: `your-secret-api-key`
5. Click **Deploy**. Vercel will build and provide your URL (e.g., `https://passive-second-brain.vercel.app`).

---

## Step 5 — Configure Chrome Extension for Production

1. Open `extension/background.js`.
2. Update the default backend URL to point to your Render production backend:
```javascript
const PSB_API_URL = 'https://psb-backend.onrender.com';
```
3. Load `extension/` directory into Chrome as an Unpacked Extension (`chrome://extensions` → **Load unpacked**).

---

## ⚡ Quick Summary

| Component | URL Pattern | Cost |
| :--- | :--- | :--- |
| **Backend** | `https://psb-backend.onrender.com` | **$0.00 / month** |
| **Frontend** | `https://passive-second-brain.vercel.app` | **$0.00 / month** |
| **Neo4j DB** | `neo4j+s://xxx.databases.neo4j.io` | **$0.00 / month** |
