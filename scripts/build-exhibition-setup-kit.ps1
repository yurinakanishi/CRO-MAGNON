[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string]$PublicKeyDirectory,
  [string]$OpenSshPackageDirectory=(Join-Path (Split-Path $PSScriptRoot -Parent) 'output\openssh-packages'),
  [ValidateSet('PC0','PC1','PC2','PC3')][string[]]$Roles = @('PC0','PC1','PC2','PC3'),
  [string]$OutputDirectory = (Join-Path (Split-Path $PSScriptRoot -Parent) ('output\exhibition-setup-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
)
$ErrorActionPreference = 'Stop'
$OutputDirectory = [IO.Path]::GetFullPath($OutputDirectory)
$zipPath = $OutputDirectory + '.zip'
if ((Test-Path -LiteralPath $OutputDirectory) -or (Test-Path -LiteralPath $zipPath)) {
  throw 'Choose a new output directory. Existing setup kits will not be overwritten.'
}
$scriptNames = @('setup-exhibition-ssh-display.ps1','setup-exhibition-public-folders.ps1','run-exhibition-display-setup.ps1','initialize-exhibition-display.ps1','install-exhibition-openssh.ps1','exhibition-openssh.json','exhibition-station.ps1')
foreach ($name in $scriptNames) {
  if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot $name) -PathType Leaf)) { throw "Missing setup script: $name" }
}
foreach ($role in $Roles) {
  if ($role -eq 'PC0') { continue }
  $pc = $role.ToLowerInvariant()
  $keyPath = Join-Path $PublicKeyDirectory "cro-magnon-$pc.pub"
  $key = (Get-Content -LiteralPath $keyPath -Raw).Trim()
  if ($key -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]+)?$') { throw "Invalid public key: $keyPath" }
  & ssh-keygen.exe -lf $keyPath | Out-Null
  if ($LASTEXITCODE -ne 0) { throw "Invalid public key: $keyPath" }
}
New-Item -ItemType Directory -Path $OutputDirectory | Out-Null
foreach ($name in $scriptNames) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination $OutputDirectory }
if(@($Roles | Where-Object { $_ -ne 'PC0' }).Count -gt 0) {
  $packages=& (Join-Path $PSScriptRoot 'prepare-exhibition-openssh.ps1') -OutputDirectory $OpenSshPackageDirectory
  $packageDestination=Join-Path $OutputDirectory 'openssh'
  New-Item -ItemType Directory -Path $packageDestination | Out-Null
  foreach($package in $packages.packages){Copy-Item -LiteralPath (Join-Path $packages.directory $package.file) -Destination $packageDestination}
}
foreach ($role in $Roles) {
  $pc = $role.ToLowerInvariant()
  if ($role -ne 'PC0') { Copy-Item -LiteralPath (Join-Path $PublicKeyDirectory "cro-magnon-$pc.pub") -Destination $OutputDirectory }
  @('@echo off', ('powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0run-exhibition-display-setup.ps1" -Role ' + $role)) |
    Set-Content -LiteralPath (Join-Path $OutputDirectory "Setup-$role.cmd") -Encoding ascii
}
@'
CRO-MAGNON display setup: SSH + Public folders

Use this initial setup locally BEFORE the exhibition opens. Never run it during a visit.
The setup launcher refuses SSH sessions instead of showing an administrator prompt remotely.
An existing standard CRO-MAGNON account is preserved. If absent, setup asks locally for
a new Windows password and creates a standard account. It never asks for passwords in chat.
Windows provisions a missing profile automatically; sign in as CRO-MAGNON before starting the game.
Extract the whole ZIP into a folder accessible to the currently signed-in operator.
Run Setup-PC0.cmd / Setup-PC1.cmd / Setup-PC2.cmd / Setup-PC3.cmd on the matching PC.
Approve the administrator prompt only during this initial, local maintenance.
Required Ethernet IPv4/24: PC0=10.10.10.3, PC1=10.10.10.1, PC2=10.10.10.2, PC3=10.10.10.4.
PC3 with one connected physical Ethernet adapter and only a 169.254 address is configured
automatically to 10.10.10.4. Ambiguous adapters or another configured subnet are not changed.
One run sets up BOTH Public folder permissions and SSH. Public-Setup.cmd is not needed.
Missing OpenSSH Server is installed from the included Microsoft-signed MSI; no Windows Update
download is needed on the display PC. SHA256 and signatures are checked before installation.
Existing sshd services are reused. The official Server MSI also includes its shared SSH agent.
New SSH traffic stays blocked until the PC0-only rule and account configuration succeed.
If setup fails, keep the result JSON and openssh-install-*.log, then rerun the complete kit.
PC0 uses local deployment and does not install an SSH server or need an SSH key.
On PC0, PC1 and PC3 it also permits TCP 8081 from the exhibition LAN only.
PC2 does not receive this inbound game rule. Both PCs keep their local assets on localhost.
Each PC gets a demand-only, RunLevel 0 task for the standard CRO-MAGNON display account.
PC0's invoking operator also gets Modify access to the game folder and permission to run that task.

Game ZIP destination: C:\Users\Public\CRO-MAGNON\incoming
Game release destination: C:\Users\Public\CRO-MAGNON\releases
Public itself gets display-user read/traverse access without inheritance into unrelated folders.
Original folder permissions are saved as public-permissions-before-*.json before changes.

Completion is shown only after all steps succeed. setup-PC0-result.json through
setup-PC3-result.json record the outcome. If an error appears, keep the window open.
After completion, have PC0 verify the host fingerprint, SSH login and Public read/write access.

Only public keys are included. Never copy PC0 private keys to a display PC.
This installer does not copy, start, stop or update the game.
Execution policy is set only for the setup processes; persistent policies are unchanged.
'@ | Set-Content -LiteralPath (Join-Path $OutputDirectory 'README.txt') -Encoding UTF8
$hashes = @(Get-ChildItem -LiteralPath $OutputDirectory -File -Recurse | Sort-Object FullName | ForEach-Object {
  [pscustomobject]@{file=$_.FullName.Substring($OutputDirectory.Length+1).Replace('\','/'); sha256=(Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash}
})
[pscustomobject]@{createdAt=(Get-Date).ToString('o'); files=$hashes} | ConvertTo-Json -Depth 4 |
  Set-Content -LiteralPath (Join-Path $OutputDirectory 'setup-manifest.json') -Encoding UTF8
$entries = @(Get-ChildItem -LiteralPath $OutputDirectory | ForEach-Object FullName)
Compress-Archive -LiteralPath $entries -DestinationPath $zipPath
[pscustomobject]@{directory=$OutputDirectory; zip=$zipPath; sha256=(Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash; files=(@(Get-ChildItem -LiteralPath $OutputDirectory -File -Recurse).Count)} | ConvertTo-Json
