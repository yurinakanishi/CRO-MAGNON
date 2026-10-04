@echo off
setlocal
cd /d "%~dp0"
"%~dp0runtime\node.exe" "%~dp0scripts\start-local.mjs"
if errorlevel 1 pause
