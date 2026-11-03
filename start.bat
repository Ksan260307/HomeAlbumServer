@echo off
title HomeAlbum
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed.
  echo  Please install it from https://nodejs.org/ and run this file again.
  echo.
  start "" https://nodejs.org/
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo.
  echo  First-time setup. Please wait a moment...
  echo.
  call npm install --omit=dev --no-audit --no-fund
  if errorlevel 1 (
    echo.
    echo  Setup failed. Please check your internet connection and try again.
    pause
    exit /b 1
  )
)

node server.js --open
pause
