@echo off
cd /d "%~dp0"
title Jira Analyzer v2.0 — Server
color 0A
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   Agentic Jira Ticket Analyzer v2.0      ║
echo  ║   On-Premise Edition                     ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  Starting server on http://localhost:5001
echo  Dashboard: http://localhost:5173
echo  Press Ctrl+C to stop.
echo.

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

:: Start the server (exe mode or node mode)
if exist "analyzer-win.exe" (
  analyzer-win.exe
) else (
  node server.js
)

pause
