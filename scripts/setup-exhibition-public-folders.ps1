[CmdletBinding()]
param([string]$DisplayUser = 'CRO-MAGNON', [string]$OperatorUser)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Run this script locally as administrator on the display PC.'
}
$user = Get-LocalUser -Name $DisplayUser
$writers = @($user)
if ($OperatorUser) { $writers += Get-LocalUser -Name $OperatorUser }
if (-not $user.Enabled) { throw 'The display user is disabled.' }
if (Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object { $_.SID.Value -eq $user.SID.Value }) {
  throw 'The display account must remain a standard user.'
}
$public = 'C:\Users\Public'
$root = Join-Path $public 'CRO-MAGNON'
$gameDirectories = @($root, (Join-Path $root 'incoming'), (Join-Path $root 'releases'), (Join-Path $root 'operations'))
$directories = @($public) + $gameDirectories
$before = @(foreach ($path in $directories) {
  if (Test-Path -LiteralPath $path) {
    $item = Get-Item -LiteralPath $path -Force
    if (-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
      throw "Expected an ordinary directory, not a file or link: $path"
    }
    $acl = Get-Acl -LiteralPath $path
    [pscustomobject]@{path=$path; exists=$true; sddl=$acl.Sddl}
  } else { [pscustomobject]@{path=$path; exists=$false} }
})
$backup = Join-Path $PSScriptRoot ('public-permissions-before-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N') + '.json')
$before | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $backup -Encoding UTF8

# Grant this account access to the Public directory itself, without propagating
# rights to unrelated Public contents. SSH uses a NETWORK rather than INTERACTIVE logon.
$publicAcl = Get-Acl -LiteralPath $public
foreach ($writer in $writers) {
  $publicAcl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
    $writer.SID, 'ReadAndExecute', 'None', 'None', 'Allow'))
}
Set-Acl -LiteralPath $public -AclObject $publicAcl

foreach ($path in $gameDirectories) {
  New-Item -ItemType Directory -Path $path -Force | Out-Null
  $acl = Get-Acl -LiteralPath $path
  # Match the documented deployment permissions while preserving existing explicit entries.
  $acl.SetAccessRuleProtection($true, $false)
  foreach ($writer in $writers) {
    $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $writer.SID, 'Modify', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  }
  foreach ($sid in @([Security.Principal.SecurityIdentifier]'S-1-5-18', [Security.Principal.SecurityIdentifier]'S-1-5-32-544')) {
    $acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new(
      $sid, 'FullControl', 'ContainerInherit, ObjectInherit', 'None', 'Allow'))
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
[pscustomobject]@{
  success=$true
  computerName=$env:COMPUTERNAME
  displayUser=$user.Name
  displayUserSid=$user.SID.Value
  operatorUser=$OperatorUser
  backup=$backup
  paths=$directories
  timestamp=(Get-Date).ToString('o')
} | ConvertTo-Json -Depth 4
