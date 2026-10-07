# Codex built-in image_gen runs for the friend mascot references (one image per request).
# Usage: powershell -File run-codex-refs.ps1 -Keys key1,key2 [-Version 1]
param([string[]]$Keys, [string]$Version = "1")
$ErrorActionPreference = 'Continue'
$Keys = @($Keys | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
# Newest Codex CLI on this host (bundled with the Codex app, 0.162.0-alpha.2 on 2026-10-07).
# Its elevated Windows sandbox could not spawn commands here, and gpt-5.6-sol was at capacity:
# use the configured default model with the unelevated sandbox.
$codex = 'C:\Users\yurin\AppData\Local\OpenAI\Codex\bin\979a96ce184041d1\codex.exe'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..\..')).Path
$models = Join-Path $root 'output\model-generation\models'
foreach ($key in $Keys) {
  $orig = Join-Path $models "$key\source\original"
  $request = Join-Path $orig "codex-request-v$Version.txt"
  $attach = @()
  foreach ($line in Get-Content (Join-Path $orig "codex-attach-v$Version.txt")) { if ($line.Trim()) { $attach += @('-i', $line.Trim()) } }
  $log = Join-Path $orig "codex-v$Version.log"
  Get-Content -Raw $request | & $codex exec -c model_reasoning_effort=medium -c 'windows.sandbox="unelevated"' --skip-git-repo-check -s workspace-write -C $orig @attach - *> $log
  "exit $LASTEXITCODE" | Add-Content $log
}
