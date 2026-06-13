@echo off
title Jira Analyzer — Developer Setup
color 0B
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   Jira Analyzer v2.0 — Developer Setup Script       ║
echo  ║   Installs: Ollama models + Node deps + .env        ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  This script sets up your LOCAL development environment.
echo  No external API keys required — everything runs on your machine.
echo.

:: ── Step 1: Check Node.js ─────────────────────────────────────
echo [1/5] Checking Node.js...
node --version >nul 2>&1
if errorlevel 1 (
  echo  ❌ Node.js not found!
  echo     Download from: https://nodejs.org  (v18 or later^)
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('node --version') do echo  ✅ Node.js %%v found

:: ── Step 2: Check Ollama ──────────────────────────────────────
echo.
echo [2/5] Checking Ollama...
ollama --version >nul 2>&1
if errorlevel 1 (
  echo  ❌ Ollama not found!
  echo     Download from: https://ollama.com  (free, ~500MB^)
  echo     Install it, then re-run this script.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('ollama --version') do echo  ✅ Ollama %%v found

:: ── Step 3: Pull required Ollama models ───────────────────────
echo.
echo [3/5] Pulling Ollama models (this may take a while on first run)...
echo.

echo  Pulling nomic-embed-text (required for code indexing, ~275MB^)...
ollama pull nomic-embed-text
if errorlevel 1 (
  echo  ❌ Failed to pull nomic-embed-text
  echo     Check your internet connection and try again.
  pause
  exit /b 1
)
echo  ✅ nomic-embed-text ready

echo.
echo  Pulling qwen2.5-coder:3b (for Bug/Task analysis, ~2GB^)...
echo  (Skip with Ctrl+C if you have a cloud API key - faster alternative^)
ollama pull qwen2.5-coder:3b
echo  ✅ qwen2.5-coder:3b ready

echo.
echo  Pulling deepseek-coder:6.7b (for Story/Epic analysis, ~4GB^)...
echo  (Optional — skip if disk space is limited^)
set /p SKIP_DEEP="  Skip deepseek-coder:6.7b? (y/N): "
if /i "%SKIP_DEEP%"=="y" goto skip_deepseek
ollama pull deepseek-coder:6.7b-instruct
echo  ✅ deepseek-coder:6.7b ready
:skip_deepseek

:: ── Step 4: Install Node dependencies ────────────────────────
echo.
echo [4/5] Installing Node.js dependencies...
cd /d "%~dp0..\backend"
npm install --silent
if errorlevel 1 (
  echo  ❌ npm install failed
  pause
  exit /b 1
)
echo  ✅ Node dependencies installed

:: ── Step 5: Create .env if not exists ────────────────────────
echo.
echo [5/5] Setting up .env...
cd /d "%~dp0..\backend"
if exist ".env" (
  echo  ✅ .env already exists — skipping
) else (
  copy ".env.template" ".env" >nul 2>&1
  if exist ".env" (
    echo  ✅ .env created from template
    echo.
    echo  ┌─────────────────────────────────────────────────────┐
    echo  │  ACTION REQUIRED: Edit backend\.env and add:        │
    echo  │    JIRA_DOMAIN=your-domain.atlassian.net            │
    echo  │    JIRA_EMAIL=you@company.com                       │
    echo  │    JIRA_API_TOKEN=your-token                        │
    echo  │                                                     │
    echo  │  Optional (for faster analysis):                    │
    echo  │    GROQ_API_KEY=gsk_...   (free, ~7s/ticket^)       │
    echo  └─────────────────────────────────────────────────────┘
  ) else (
    echo  ⚠️  Could not copy .env.template — create .env manually
  )
)

:: ── Done ──────────────────────────────────────────────────────
echo.
echo  ╔══════════════════════════════════════════════════════╗
echo  ║   ✅  Setup complete!                                ║
echo  ╠══════════════════════════════════════════════════════╣
echo  ║  Next steps:                                         ║
echo  ║    1. Edit backend\.env (add Jira credentials^)      ║
echo  ║    2. Edit backend\config.yaml (add your repo^)      ║
echo  ║    3. cd backend ^& npm run index  (one-time^)        ║
echo  ║    4. cd backend ^& npm start                        ║
echo  ║    5. Open http://localhost:5173  (dashboard^)       ║
echo  ╚══════════════════════════════════════════════════════╝
echo.
echo  ℹ️  No cloud API keys needed — Ollama runs everything locally.
echo     Add GROQ_API_KEY to .env to switch to fast cloud mode (~7s).
echo.
pause
