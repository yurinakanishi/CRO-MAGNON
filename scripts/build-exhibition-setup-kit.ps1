[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PublicKeyDirectory,
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) ('output\exhibition-setup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$zipPath = $OutputDirectory + '.zip'
if ((Test-Path -LiteralPath $OutputDirectory) -or (Test-Path -LiteralPath $zipPath)) {
  throw 'Choose a new output directory. Existing setup kits will not be overwritten.'
}
$scriptNames = @('setup-exhibition-ssh-display.ps1','setup-exhibition-public-folders.ps1','run-exhibition-display-setup.ps1')
foreach ($name in $scriptNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "Missing setup script: $name" }
}
foreach ($pc in @('pc1','pc2')) {
  $keyPath = Join-Path $PublicKeyDirectory "cro-magnon-$pc.pub"
  $key = (Get-Content -LiteralPath $keyPath -Raw).Trim()
  if ($key -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]+)?$') { throw "Invalid public key: $keyPath" }
  & ssh-keygen.exe -lf $keyPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Invalid public key: $keyPath" }
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
foreach ($name in $scriptNames) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory }
foreach ($pc in @('pc1','pc2')) {
  Copy-Item -LiteralPath (Join-Path $PublicKeyDirectory "cro-magnon-$pc.pub") -Destination $OutputDirectory
  $role = $pc.ToUpperInvariant()
  @('@echo off', ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-exhibition-display-setup.ps1" -Role ' + $role)) |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "Setup-$role.cmd") -Encoding ascii
}
@'
CRO-MAGNON display setup: SSH + Public folders

Use this initial setup locally BEFORE the exhibition opens. Never run it during a visit.
The setup launcher refuses SSH sessions instead of showing an administrator prompt remotely.
Prerequisite: a standard local user named CRO-MAGNON exists and has signed in once.
Extract the whole ZIP into a folder accessible to the currently signed-in operator.
On PC1 run Setup-PC1.cmd. On PC2 run Setup-PC2.cmd. Approve the administrator prompt.
One run sets up BOTH Public folder permissions and SSH. Public-Setup.cmd is not needed.
On PC1 it also permits game synchronization on TCP 8081 from the exhibition LAN only.
PC2 does not receive this inbound game rule. Both PCs keep their local assets on localhost.

Game ZIP destination: C:\Users\Public\CRO-MAGNON\incoming
Game release destination: C:\Users\Public\CRO-MAGNON\releases
Public itself gets display-user read/traverse access without inheritance into unrelated folders.
Original folder permissions are saved as public-permissions-before-*.json before changes.

Completion is shown only after both steps succeed. setup-PC1-result.json or
setup-PC2-result.json records the outcome. If an error appears, keep the window open.
After completion, have PC0 verify the host fingerprint, SSH login and Public read/write access.

Only public keys are included. Never copy PC0 private keys to a display PC.
This installer does not copy, start, stop or update the game.
Execution policy is set only for the setup processes; persistent policies are unchanged.
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'README.txt') -Encoding UTF8
$hashes = @(Get-ChildItem -LiteralPath $OutputDirectory -File | Sort-Object Name | ForEach-Object {
  [pscustomobject]@{file=$_.Name; sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
[pscustomobject]@{createdAt=(Get-Date).ToString('o'); files=$hashes} | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $OutputDirectory 'setup-manifest.json') -Encoding UTF8
$files = @(Get-ChildItem -LiteralPath $OutputDirectory -File | ForEach-Object FullName)
Compress-Archive -LiteralPath $files -DestinationPath $zipPath
[pscustomobject]@{directory=$OutputDirectory; zip=$zipPath; sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash; files=$files.Count} | ConvertTo-Json
