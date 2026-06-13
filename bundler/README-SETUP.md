# Agentic Jira Ticket Analyzer v2.0 — Setup Guide

**On-Premise Edition | ~5 minute setup**

---

## What This Does

Every time a Jira ticket is created, this tool:
1. Detects the new ticket via Background Jira Polling
2. Searches your codebase for relevant files (AI vector search)
3. Sends ticket + relevant code to an LLM for analysis
4. Posts the analysis as a comment back to your Jira ticket
5. Shows the analysis on the live dashboard

---

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| **Windows 10/11 (64-bit)** | Linux/Mac supported via `node indexer.js` / `node server.js` |
| **[Ollama](https://ollama.com)** | For local AI models (free, offline). Or use cloud API keys instead. |
| **Internet access** | Only needed if using cloud API keys (Groq/Claude/OpenAI). |
| **Node.js 18+** | Only needed if NOT using `analyzer-win.exe` |

### Install Ollama models (if using local mode):
```bash
ollama pull nomic-embed-text     # required for code indexing (~275MB)
ollama pull qwen2.5-coder:3b    # for Bug/Task analysis (~2GB)
ollama pull deepseek-coder:6.7b  # for Story/Epic analysis (~4GB)
```

---

## Setup (5 minutes)

### Step 1 — Configure repos and Jira boards

Edit `config.yaml` and add your repositories:

```yaml
repos:
  - id: my-backend          # unique ID (no spaces)
    name: "My Backend API"
    localPath: "C:\\Code\\my-backend"   # path to local git clone
    extensions: [".js", ".ts", ".py", ".java", ".go"]
    excludeDirs: ["node_modules", ".git", "dist", "build"]
    jiraProjects: ["BACK", "API"]    # Jira project keys that map to this repo
```

### Step 2 — Add credentials

```bash
copy .env.template .env
```

Open `.env` in Notepad and fill in:
- `JIRA_DOMAIN` — your Atlassian domain (e.g. `mycompany.atlassian.net`)
- `JIRA_EMAIL` — your login email
- `JIRA_API_TOKEN` — generate at https://id.atlassian.com/manage-profile/security/api-tokens

Optionally add a cloud API key for faster analysis:
- `GROQ_API_KEY` — recommended for demos (~7s/ticket, free tier)

### Step 3 — Build the vector index

Double-click **`index.bat`**

This scans your code, chunks it, and stores vector embeddings in LanceDB.
- Runs **once** per repo setup
- Takes 30-90 minutes for large repos (one-time cost)
- Subsequent runs are incremental (only changed files, takes seconds)

### Step 4 — Start the server

Double-click **`start.bat`**

Server starts on `http://localhost:5001`

### Step 5 — Auto-Polling Detection

The backend automatically polls your Jira board every 30 seconds (configurable in `config.yaml`).
- No Webhooks required!
- No port forwarding or ngrok/localtunnel required!
- Works completely behind corporate firewalls.

### Step 6 — Open the dashboard

Open browser: `http://localhost:5173`

---

## Adding a New Repo

1. Clone the repo locally: `git clone ... C:\Code\new-repo`
2. Add entry to `config.yaml` (see Step 1 format)
3. Run `index.bat` again — only new repo gets indexed
4. Restart `start.bat`

---

## LLM Modes

| Mode | Setup | Speed | Cost |
|------|-------|-------|------|
| **Local (default)** | Just Ollama | ~2-4 min/ticket | Free, offline |
| **Demo** | Add `GROQ_API_KEY` to `.env` | ~7-10s/ticket | Free tier (60 req/min) |
| **Production** | Add `ANTHROPIC_API_KEY` | ~3-5s/ticket | ~$0.003/ticket |

Switch modes by editing `.env` — no restart needed, use `POST /api/config/reload`.

---

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `Ollama not running` | Start Ollama desktop app or run `ollama serve` |
| `nomic-embed-text not found` | Run `ollama pull nomic-embed-text` |
| `Analysis takes 2+ minutes` | Normal for local models on CPU. Add GROQ_API_KEY for ~7s. |
| `Not detecting new tickets` | Ensure `jiraProjects` in config match your Jira board project keys |
| `0 chunks found` | Run `index.bat` first |
| `Port 5001 in use` | Change port in `config.yaml` → `server.port` |

---

## Support

Built by **Ketan.K** | Agentic Jira Analyzer v2.0
