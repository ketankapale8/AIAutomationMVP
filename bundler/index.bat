@echo off
title Jira Analyzer — Building Vector Index
color 0B
echo.
echo  ╔══════════════════════════════════════════╗
echo  ║   Jira Analyzer — Vector Index Builder   ║
echo  ╚══════════════════════════════════════════╝
echo.
echo  This will scan and embed all configured repos into LanceDB.
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
