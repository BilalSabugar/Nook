# Nook Sovereign Self-Hosting & Deployment Guide 🏰

This guide provides instructions for deploying and running **Nook** completely self-hosted, sovereign, and independent of any third-party conversation cloud or SaaS intelligence platforms.

---

## 1. Architectural Sovereignty

Unlike templates that offload conversation persistence and thread synchronization to proprietary cloud APIs, Nook stores 100% of its data locally:
- **Transactional Database**: Stored in `.nook_storage/nook.db` using Node 24 native SQLite with Write-Ahead Logging (`WAL`).
- **Encrypted Secrets Vault**: Provider API keys are encrypted at rest using AES-256-GCM in `.nook_storage/secrets.enc` (file mode `0600`).
- **Execution Sandboxes**: Isolated per-coworker directories (`.nook_sandboxes/<agentId>`) with path traversal guards and minimal execution environments.
- **SSRF Defense Engine**: Centralized outbound validator blocking private RFC1918 subnets, cloud metadata (`169.254.169.254`), and loopback addresses.

---

## 2. Zero-Cloud Local Model Setup with Ollama

Nook supports completely local, zero-cloud model inference via [Ollama](https://ollama.ai).

### Step 1: Install and Run Ollama
```bash
# Pull recommended models
ollama pull llama3.2
ollama pull qwen2.5-coder
ollama pull deepseek-r1:8b

# Ensure Ollama daemon is running locally on port 11434
curl http://localhost:11434/api/tags
```

### Step 2: Configure Nook for Local Model Inference
1. Open Nook in your browser.
2. Open **Settings** (`⌘,` or Settings modal in navigation).
3. Select **Local Ollama** as Provider.
4. Enter model name (e.g. `llama3.2` or `qwen2.5-coder`).
5. Click **Test Provider Connection**. Nook will verify connectivity to `http://localhost:11434`.

---

## 3. Deployment Options

### Option A: Direct Node 24 Production Runtime
```bash
# 1. Clone repository
git clone https://github.com/BilalSabugar/Nook.git
cd Nook

# 2. Clean install dependencies
npm ci

# 3. Build optimized production bundle
npm run build

# 4. Start production server
npm start
```
Default URL: `http://localhost:3000`

### Option B: Docker Compose
```bash
# Run multi-stage non-root container
docker compose up -d --build

# Check health status
docker compose ps
```
The container runs as non-root `nextjs:nodejs` (UID 1001) and mounts a persistent volume `nook_data` to `/app/.nook_storage`.

---

## 4. Backup, Restore & Data Portability

Nook provides sovereign workspace export and import:
- **Export Data**: `GET /api/workspace/export` generates a single JSON bundle containing all spaces, documents, revisions, missions, tasks, and audit logs. *Private API keys and master secrets are strictly omitted.*
- **Import / Restore**: `POST /api/workspace/import` restores spaces, document revision trees, and workspace state onto a new or existing instance.
- **Full Database Snapshot**: Backing up the `.nook_storage/` folder provides a complete snapshot of all data.
