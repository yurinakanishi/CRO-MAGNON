# Serial Codex built-in image_gen runs for remake reference images.
# Usage: powershell -File run-codex-refs.ps1 -Keys key1,key2 [-Version 2]
param([string[]]$Keys, [string]$Version = "2")
$ErrorActionPreference = 'Continue'
$Keys = @($Keys | ForEach-Object { $_ -split ',' } | Where-Object { $_ })
$codex = 'C:\Users\yurin\AppData\Local\OpenAI\Codex\bin\5ea220ae823df3d7\codex.exe'
$models = 'C:\Users\yurin\Desktop\projects\CRO-MAGNON\output\model-generation\models'
$statusDir = Join-Path $PSScriptRoot '..\..\output\asset-remake\codex-status'
New-Item -ItemType Directory -Force $statusDir | Out-Null
foreach ($key in $Keys) {
  $orig = Join-Path $models "$key\source\original"
  $request = Join-Path $orig "codex-request-v$Version.txt"
  $attach = @()
  foreach ($candidate in @('reference-v3.png', 'reference-v2.png', 'reference-v1.png')) {
    $p = Join-Path $orig $candidate
    if ((Test-Path $p) -and $attach.Count -eq 0 -and $candidate -ne "reference-v$Version.png") { $attach = @('-i', $p) }
  }
  $extra = Join-Path $orig "codex-attach-v$Version.txt"
  if (Test-Path $extra) { $attach = @(); foreach ($line in Get-Content $extra) { if ($line.Trim()) { $attach += @('-i', $line.Trim()) } } }
  $log = Join-Path $statusDir "$key-v$Version.log"
  @{ key = $key; status = 'running'; started = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $statusDir "$key-v$Version.json")
  Get-Content -Raw $request | & $codex exec -m gpt-5.6-sol -c model_reasoning_effort=medium --skip-git-repo-check -s workspace-write -C $orig @attach - *> $log
  $code = $LASTEXITCODE
  @{ key = $key; status = 'finished'; exit = $code; finished = (Get-Date).ToString('o') } | ConvertTo-Json | Set-Content -Encoding utf8 (Join-Path $statusDir "$key-v$Version.json")
}
