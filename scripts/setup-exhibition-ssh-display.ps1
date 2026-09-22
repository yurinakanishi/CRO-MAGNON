# Run locally in an elevated Windows PowerShell on the display PC.
# The standard display user and profile must already exist; the kit prepares them.
# Copy both setup scripts and that PC's .pub file from PC0, or use the setup kit.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('PC0', 'PC1', 'PC2', 'PC3')]
  [string]$Role,
  [string]$DisplayUser = 'CRO-MAGNON',
  [string]$PublicKeyFile,
  [string]$OperatorUser
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:SSH_CONNECTION -or $env:SSH_CLIENT) {
  throw 'Initial setup must run locally before the exhibition. Remote elevation is disabled.'
}
$publicSetupScript = Join-Path $PSScriptRoot 'setup-exhibition-public-folders.ps1'
if (-not (Test-Path -LiteralPath $publicSetupScript -PathType Leaf)) {
  throw 'The Public setup helper is missing. Extract the complete setup kit before running it.'
}
if (-not (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'register-exhibition-setup-launcher.ps1') -PathType Leaf)) {
  throw 'The launcher maintenance helper is missing. Extract the complete updated setup kit before running it.'
}
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script in a local administrator PowerShell on the display PC.'
}

$address = @{PC0='10.10.10.3'; PC1='10.10.10.1'; PC2='10.10.10.2'; PC3='10.10.10.4'}[$Role]
$ip = @(Get-NetIPAddress -AddressFamily IPv4 | Where-Object IPAddress -eq $address)
if ($ip.Count -ne 1 -or $ip[0].PrefixLength -ne 24) {
  throw "This PC must already have $address/24. No settings have been changed."
}
$user = Get-LocalUser -Name $DisplayUser
if (-not $user.Enabled) { throw 'The display user is disabled. No settings have been changed.' }
$admins = @(Get-LocalGroupMember -SID 'S-1-5-32-544')
if ($admins | Where-Object { $_.SID.Value -eq $user.SID.Value }) {
  throw 'The display user must be a standard user, not an Administrator.'
}
$profile = @(Get-CimInstance Win32_UserProfile | Where-Object SID -eq $user.SID.Value)
if ($Role -ne 'PC0' -and ($profile.Count -ne 1 -or -not (Test-Path -LiteralPath $profile[0].LocalPath))) {
  throw 'Sign in as the display user once, then run this script again.'
}
if ($Role -ne 'PC0') {
$publicKey = (Get-Content -LiteralPath $PublicKeyFile -Raw).Trim()
if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]+)?$') {
  throw 'Expected one Ed25519 public key (.pub), never a private key.'
}
}

Write-Host 'Preparing Public game folders and display-user permissions...'
$publicResult = & $publicSetupScript -DisplayUser $DisplayUser -OperatorUser $OperatorUser | ConvertFrom-Json
if ($publicResult.success -ne $true) {
  throw 'Public folder setup did not complete. SSH setup has not been started.'
}

if ($Role -ne 'PC0') {
Write-Host 'Preparing OpenSSH Server from the installed service or local offline package...'
$openSsh = & (Join-Path $PSScriptRoot 'install-exhibition-openssh.ps1')
$keyCheck = & $openSsh.keygen -lf $PublicKeyFile 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The public key is invalid.' }

$keyDir = Join-Path $profile[0].LocalPath '.ssh'
$authorized = Join-Path $keyDir 'authorized_keys'
New-Item -ItemType Directory -Force -Path $keyDir | Out-Null
$directoryAcl = New-Object System.Security.AccessControl.DirectorySecurity
$directoryAcl.SetAccessRuleProtection($true, $false)
$directoryAcl.SetOwner($user.SID)
foreach ($sid in @($user.SID, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $directoryAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
}
Set-Acl -LiteralPath $keyDir -AclObject $directoryAcl
$existing = @(if (Test-Path -LiteralPath $authorized) { Get-Content -LiteralPath $authorized })
$keyBlob = ($publicKey -split ' ')[1]
if (-not ($existing | Where-Object { $_ -notmatch '^\s*#' -and $_.Contains($keyBlob) })) {
  $entry = 'from="10.10.10.3",no-agent-forwarding,no-port-forwarding,no-X11-forwarding ' + $publicKey
  # Keep any earlier keys, and make sure an unterminated last line stays separate.
  ($existing + @($entry)) | Set-Content -LiteralPath $authorized -Encoding ascii
}
$fileAcl = New-Object System.Security.AccessControl.FileSecurity
$fileAcl.SetAccessRuleProtection($true, $false)
$fileAcl.SetOwner($user.SID)
foreach ($sid in @($user.SID, [Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
  $fileAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, 'FullControl', 'Allow'))
}
Set-Acl -LiteralPath $authorized -AclObject $fileAcl
}

Set-NetConnectionProfile -InterfaceIndex $ip[0].InterfaceIndex -NetworkCategory Private -ErrorAction Stop
$networkProfile = @(Get-NetConnectionProfile -InterfaceIndex $ip[0].InterfaceIndex -ErrorAction Stop)
if ($networkProfile.Count -ne 1 -or $networkProfile[0].NetworkCategory -ne 'Private') {
  throw 'The exhibition Ethernet profile did not become Private; setup is incomplete.'
}
if ($Role -ne 'PC0') {
$ruleName = 'CRO-MAGNON-SSH-from-PC0'
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $address -RemoteAddress 10.10.10.3 -Profile Private
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName 'CRO-MAGNON SSH from PC0' -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $address -RemoteAddress 10.10.10.3 -Profile Private | Out-Null
}
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
}
if ($Role -in @('PC0','PC1','PC3')) {
  # Primary and spare hosts are prepared before the exhibition. No UAC at failover.
  $gameRuleName = 'CRO-MAGNON-Exhibition-LAN'
  if (Get-NetFirewallRule -Name $gameRuleName -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name $gameRuleName -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081 -LocalAddress $address -RemoteAddress 10.10.10.0/24 -Profile Private
  } else {
    New-NetFirewallRule -Name $gameRuleName -DisplayName 'CRO-MAGNON Exhibition LAN' -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 8081 -LocalAddress $address -RemoteAddress 10.10.10.0/24 -Profile Private | Out-Null
  }
}
if ($Role -ne 'PC0') {
Set-Service sshd -StartupType Automatic
Start-Service sshd
& $openSsh.sshd -t
if ($LASTEXITCODE -ne 0) { throw 'The existing sshd configuration failed validation; check it locally.' }
}

$taskResult = & (Join-Path $PSScriptRoot 'register-exhibition-setup-launcher.ps1') -Machine $Role -DisplayUser $DisplayUser -OperatorUser $OperatorUser | ConvertFrom-Json
if (-not $taskResult.registered) { throw 'The standard exhibition task was not registered.' }

Write-Host "Role: $Role | LAN: $address | User: $DisplayUser"
Write-Host 'Public game folders: C:\Users\Public\CRO-MAGNON\incoming and releases'
if ($Role -ne 'PC0') {
Write-Host 'Registered public key:'
$keyCheck | ForEach-Object { Write-Host $_ }
Write-Host 'Compare this host fingerprint with the one seen on PC0 before trusting the host:'
$hostFingerprint = & $openSsh.keygen -lf "$env:ProgramData\ssh\ssh_host_ed25519_key.pub"
if ($LASTEXITCODE -ne 0) { throw 'Unable to read the SSH host fingerprint.' }
$hostFingerprint | ForEach-Object { Write-Host $_ }
Get-NetFirewallRule -Name 'CRO-MAGNON-SSH-Initial-Setup-Block' -ErrorAction SilentlyContinue | Remove-NetFirewallRule -ErrorAction Stop
}
Write-Host 'Then verify SSH login and Public-folder read/write access from PC0.'
[pscustomobject]@{
  success = $true
  role = $Role
  displayUser = $DisplayUser
  publicFolders = $publicResult
  gameHostPort = $(if ($Role -in @('PC0','PC1','PC3')) { 8081 } else { $null })
  task = $taskResult
  openSsh = $openSsh
  hostFingerprint = ($hostFingerprint -join "`n")
}
