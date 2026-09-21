# Run locally in an elevated Windows PowerShell on the display PC.
# The standard display user must already exist and have signed in once.
# Copy only this script and that PC's .pub file from PC0.
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidateSet('PC1', 'PC2')]
  [string]$Role,
  [string]$DisplayUser = 'CRO-MAGNON',
  [Parameter(Mandatory = $true)]
  [string]$PublicKeyFile
)

$ErrorActionPreference = 'Stop'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script in a local administrator PowerShell on the display PC.'
}

$address = if ($Role -eq 'PC1') { '10.10.10.1' } else { '10.10.10.2' }
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
if ($profile.Count -ne 1 -or -not (Test-Path -LiteralPath $profile[0].LocalPath)) {
  throw 'Sign in as the display user once, then run this script again.'
}
$publicKey = (Get-Content -LiteralPath $PublicKeyFile -Raw).Trim()
if ($publicKey -notmatch '^ssh-ed25519 [A-Za-z0-9+/]+={0,2}( [^\r\n]+)?$') {
  throw 'Expected one Ed25519 public key (.pub), never a private key.'
}
$keyCheck = & ssh-keygen.exe -lf $PublicKeyFile 2>&1
if ($LASTEXITCODE -ne 0) { throw 'The public key is invalid.' }

$capability = Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
if ($capability.State -ne 'Installed') {
  $installation = Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'
  if ($installation.RestartNeeded) { throw 'OpenSSH installation requires a Windows restart before continuing.' }
}

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

Set-NetConnectionProfile -InterfaceIndex $ip[0].InterfaceIndex -NetworkCategory Private
$ruleName = 'CRO-MAGNON-SSH-from-PC0'
if (Get-NetFirewallRule -Name $ruleName -ErrorAction SilentlyContinue) {
  Set-NetFirewallRule -Name $ruleName -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $address -RemoteAddress 10.10.10.3 -Profile Private
} else {
  New-NetFirewallRule -Name $ruleName -DisplayName 'CRO-MAGNON SSH from PC0' -Enabled True -Direction Inbound -Action Allow -Protocol TCP -LocalPort 22 -LocalAddress $address -RemoteAddress 10.10.10.3 -Profile Private | Out-Null
}
Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue | Disable-NetFirewallRule
Set-Service sshd -StartupType Automatic
Start-Service sshd
& "$env:WINDIR\System32\OpenSSH\sshd.exe" -t
if ($LASTEXITCODE -ne 0) { throw 'The existing sshd configuration failed validation; check it locally.' }

Write-Host "Role: $Role | LAN: $address | User: $DisplayUser"
Write-Host 'Registered public key:'
$keyCheck
Write-Host 'Compare this host fingerprint with the one seen on PC0 before trusting the host:'
& ssh-keygen.exe -lf "$env:ProgramData\ssh\ssh_host_ed25519_key.pub"
Write-Host 'Then verify a key-authenticated hostname command from PC0. This script alone does not prove login success.'
