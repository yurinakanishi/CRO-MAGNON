param([Parameter(Mandatory = $true)][int]$ExpectedServerPid)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $taskRoot
$health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
if ($health.players -ne 0 -or !$health.save.enabled -or $health.save.state -ne 'saved' -or $health.save.recovered) { throw 'Leave an occupied or unhealthy server running.' }
$listener = @(netstat -ano -p tcp | Select-String (':3000\s+.*LISTENING\s+' + $ExpectedServerPid + '\s*$'))
if ($listener.Count -ne 1) { throw 'Unexpected listener.' }
if (@(netstat -ano -p tcp | Select-String ':9229\s+.*LISTENING').Count) { throw 'Do not attach to another inspector.' }
$oldServer = Get-Process -Id $ExpectedServerPid
if ($oldServer.Path -ne (Get-Command node.exe).Source) { throw 'Unexpected executable.' }
$null = $oldServer.Handle # Retain an exit-code handle before the process shuts down.
$adoption = Get-Content -LiteralPath 'assets/shape-bots/adoption.json' -Raw | ConvertFrom-Json
if ($adoption.decision -ne 'adopt' -or $adoption.models.Count -ne 4) { throw 'Finish adoption first.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$folder = Join-Path $taskRoot ('output/shape-bots-server/' + $stamp)
& node assets/shape-bots/workflow/local-save-check.mjs backup $folder
if ($LASTEXITCODE -ne 0) { throw 'Backup failed.' }
Write-Output ('INSPECTOR_BACKUP=' + $folder)
# The documented Node CLI attaches only to this PID on loopback. The operator
# verifies process.pid/cwd/argv/listeners, then emits its existing SIGINT event.
# No source reload, process.kill, forced exit, firewall change or save restore.
& node inspect -p $ExpectedServerPid
if (!$oldServer.WaitForExit(15000)) { throw 'Target is still running; do not force-kill it.' }
if ($oldServer.ExitCode -ne 0) { throw 'The application did not confirm successful final save.' }
$shutdown = @{ oldPid=$ExpectedServerPid; oldExitCode=$oldServer.ExitCode; method='Node loopback inspector: verified process identity, then existing SIGINT handler'; backup=$folder }
$shutdown | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $folder 'shutdown.json')
$env:PORT = '3000'
$env:CRO_SAVE_DIR = Join-Path $taskRoot '.cro-magnon-save'
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$newServer = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folder 'server.stdout.log') -RedirectStandardError (Join-Path $folder 'server.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $folder 'server.pid') -Value $newServer.Id
$ready = $false
for ($attempt=0; $attempt -lt 50; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
    if ($health.ok -and $health.save.state -eq 'saved' -and $health.save.savedAt -ge $started) { $ready=$true; break }
  } catch { }
}
if (!$ready) { throw 'Inspect the new server; original backup is unchanged.' }
& node assets/shape-bots/workflow/local-save-check.mjs verify $folder
if ($LASTEXITCODE -ne 0) { throw 'Inspect save differences without restoring a stale backup.' }
& node assets/shape-bots/workflow/verify-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'Inspect local delivery mismatch.' }
$record = @{ oldPid=$ExpectedServerPid; newPid=$newServer.Id; oldExitCode=$oldServer.ExitCode; backup=$folder; method=$shutdown.method; saveRestored=$false; health=$health }
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $folder 'restart.json')
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'assets/shape-bots/local-restart.json'
@{ oldExitCode=$oldServer.ExitCode; newPid=$newServer.Id; backup=$folder; saveRestored=$false } | ConvertTo-Json -Compress
