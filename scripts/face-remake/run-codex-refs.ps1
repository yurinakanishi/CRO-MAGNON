# Run one Codex built-in image_gen request per character (face remake 2026-10-07).
# powershell -File scripts/face-remake/run-codex-refs.ps1 -Key cro-magnon-hunter [-Version 1]
param([string]$Key, [string]$Version = "1")
$ErrorActionPreference = 'Continue'
# The desktop app ships a newer CLI than the one on PATH (0.134 rejects gpt-5.6-sol); use the newest app binary.
$codex = Get-ChildItem 'C:\Users\yurin\AppData\Local\OpenAI\Codex\bin\*\codex.exe' | Sort-Object LastWriteTime -Descending | Select-Object -First 1 -ExpandProperty FullName
if (-not $codex) { $codex = (Get-Command codex).Source }
$dir = Join-Path $PSScriptRoot "..\..\assets\face-remake\$Key\source" | Resolve-Path
$request = Join-Path $dir "codex-request-v$Version.txt"
$log = Join-Path $PSScriptRoot "..\..\output\face-remake\$Key-codex-v$Version.log"
$attach = @('-i', (Join-Path $dir 'before-rest-front.png'))
Get-Content -Raw $request | & $codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium --skip-git-repo-check -s workspace-write -C $dir @attach - *> $log
"exit $LASTEXITCODE" | Add-Content $log
