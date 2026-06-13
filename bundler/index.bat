@echo off
cd /d "%~dp0"
title Jira Analyzer v2.0 — Offline Indexer
color 0B
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   Jira Analyzer — Vector Index Builder   ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  This will scan and embed all configured repos into LanceDB.

:: Check if .env exists
if not exist ".env" (
  if exist ".env.template" (
    copy ".env.template" ".env" >nul
    echo  [INFO] Created .env file from template.
  ) else (
    echo  [WARNING] .env file not found!
    echo  Please create a .env file with your credentials.
    echo.
    pause
    exit /b 1
  )
)

echo  Run this ONCE after initial setup, then again when code changes.
echo.
echo  Estimated time: 30-90 minutes per repo (depends on size).
echo  This is a ONE-TIME cost. Analysis queries take milliseconds.
echo.
echo  Starting indexer...
echo.

if exist "analyzer-win.exe" (
  analyzer-win.exe index
) else (
  node indexer.js
)

echo.
echo  ✅ Indexing complete! You can now start the server with start.bat
pause
