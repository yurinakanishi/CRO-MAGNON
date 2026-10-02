param([Parameter(Mandatory = $true)][int]$ExpectedServerPid)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../..')).Path
Set-Location -LiteralPath $taskRoot
$adoption = Get-Content -LiteralPath 'assets/shape-bots/adoption.json' -Raw | ConvertFrom-Json
if ($adoption.decision -ne 'adopt' -or $adoption.models.Count -ne 4) { throw 'Complete four-model game QA first.' }
$health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
if ($health.players -ne 0 -or !$health.save.enabled -or $health.save.state -ne 'saved' -or $health.save.recovered) {
  throw 'Normal server is occupied or its save needs investigation; leave it running.'
}
$listener = @(netstat -ano -p tcp | Select-String (':3000\s+.*LISTENING\s+' + $ExpectedServerPid + '\s*$'))
if ($listener.Count -ne 1) { throw 'The expected process does not own the normal server port.' }
$oldServer = Get-Process -Id $ExpectedServerPid
if ($oldServer.Path -ne (Get-Command node.exe).Source) { throw 'Unexpected executable; leave it running.' }
$taskPython = 'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe'
$console = & $taskPython assets/shape-bots/workflow/console-control.py $ExpectedServerPid | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$console.isolated -or $console.signalled) { throw 'No isolated server console; leave it running.' }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$folder = Join-Path $taskRoot ('output/shape-bots-server/' + $stamp)
$allowed = [IO.Path]::GetFullPath((Join-Path $taskRoot 'output/shape-bots-server')) + [IO.Path]::DirectorySeparatorChar
if (![IO.Path]::GetFullPath($folder).StartsWith($allowed)) { throw 'Invalid backup path.' }
& node assets/shape-bots/workflow/local-save-check.mjs backup $folder
if ($LASTEXITCODE -ne 0) { throw 'Save backup failed; leave the normal server running.' }
$health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
if ($health.players -ne 0 -or $health.save.state -ne 'saved') { throw 'A player joined or save changed; leave the server running.' }
# The helper checks the exact console membership again immediately before CTRL_C.
$signal = & $taskPython assets/shape-bots/workflow/console-control.py $ExpectedServerPid --signal | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or !$signal.signalled) { throw 'No signal was sent.' }
if (!$oldServer.WaitForExit(15000)) { throw 'Wait for graceful shutdown; never force-kill or restore a stale save.' }
if ($oldServer.ExitCode -ne 0) { throw 'Final save or graceful shutdown failed; investigate before restart.' }
$env:PORT = '3000'
$env:CRO_SAVE_DIR = Join-Path $taskRoot '.cro-magnon-save'
$started = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()
$newServer = Start-Process -FilePath (Get-Command node.exe).Source -ArgumentList 'server.mjs' -WorkingDirectory $taskRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $folder 'server.stdout.log') -RedirectStandardError (Join-Path $folder 'server.stderr.log') -PassThru
Set-Content -LiteralPath (Join-Path $folder 'server.pid') -Value $newServer.Id
$ready = $false
for ($attempt = 0; $attempt -lt 50; $attempt++) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod 'http://127.0.0.1:3000/api/health'
    if ($health.ok -and $health.save.state -eq 'saved' -and $health.save.savedAt -ge $started) { $ready = $true; break }
  } catch { }
}
if (!$ready) { throw 'New server needs inspection; original backup remains untouched.' }
& node assets/shape-bots/workflow/local-save-check.mjs verify $folder
if ($LASTEXITCODE -ne 0) { throw 'Investigate save differences; no rollback was attempted.' }
& node assets/shape-bots/workflow/verify-local.mjs
if ($LASTEXITCODE -ne 0) { throw 'Inspect local delivery mismatch.' }
$record = @{ oldPid = $ExpectedServerPid; newPid = $newServer.Id; oldExitCode = $oldServer.ExitCode; backup = $folder; signal = $signal; saveRestored = $false; health = $health }
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $folder 'restart.json')
$record | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath 'assets/shape-bots/local-restart.json'
@{ oldExitCode = $oldServer.ExitCode; newPid = $newServer.Id; backup = $folder; saveRestored = $false } | ConvertTo-Json -Compress
