@echo off
setlocal

where node >nul 2>nul
if errorlevel 1 (
  echo [AI Semaphore] No se encontro "node" en el PATH. Instala Node.js 20+ desde https://nodejs.org y reinicia OpenDeck. 1>&2
  exit /b 1
)

node "%~dp0plugin.js" %*
