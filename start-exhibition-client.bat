@echo off
setlocal
cd /d "%~dp0"
title CRO-MAGNON Exhibition - PC2 Client
if not exist "exhibition-build.json" (
  echo This is the source folder. Copy the prepared output\exhibition build to both PCs.
  echo Preparation on the developer PC: npm run build:exhibition
  pause
  exit /b 1
)
if not exist "runtime\node.exe" (
  echo Offline Node runtime is missing. Recopy the complete exhibition folder.
  pause
  exit /b 1
)
"runtime\node.exe" "scripts\start-exhibition.mjs" client
pause
