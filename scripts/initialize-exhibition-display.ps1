# Local initial setup only. Never invoked by ordinary SSH deployment commands.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('PC0','PC1','PC2','PC3')][string]$Role,
  [string]$DisplayUser='CRO-MAGNON'
)
$ErrorActionPreference='Stop'
if($env:SSH_CONNECTION -or $env:SSH_CLIENT){throw 'Initial Windows setup must run locally.'}
$principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'Local administrator approval is required for initial setup.'}
$user=Get-LocalUser -Name $DisplayUser -ErrorAction SilentlyContinue
$created=$false
if(-not $user) {
  Write-Host "Create the standard Windows display account: $DisplayUser" -ForegroundColor Cyan
  Write-Host 'Enter a non-empty Windows account password here, never in chat.'
  $password=Read-Host 'New Windows display password' -AsSecureString
  $confirmation=Read-Host 'Repeat the Windows display password' -AsSecureString
  if($password.Length -eq 0 -or $password.Length -ne $confirmation.Length){throw 'Passwords are empty or do not match; no account was created.'}
  $first=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($password)
  $second=[Runtime.InteropServices.Marshal]::SecureStringToBSTR($confirmation)
  $match=$true
  try {
    for($i=0;$i -lt $password.Length*2;$i++) {
      if([Runtime.InteropServices.Marshal]::ReadByte($first,$i) -ne [Runtime.InteropServices.Marshal]::ReadByte($second,$i)){$match=$false}
    }
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($first)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($second)
  }
  if(-not $match){throw 'Passwords do not match; no account was created.'}
  $user=New-LocalUser -Name $DisplayUser -Password $password -Description 'CRO-MAGNON standard exhibition account'
  Add-LocalGroupMember -SID 'S-1-5-32-545' -Member $user
  $password.Dispose();$confirmation.Dispose()
  $created=$true
}
if(-not $user.Enabled){throw 'The existing display account is disabled; it was not changed.'}
if(Get-LocalGroupMember -SID 'S-1-5-32-544' | Where-Object {$_.SID.Value -eq $user.SID.Value}){throw 'The display account must be a standard user, not an administrator.'}
$profile=@(Get-CimInstance Win32_UserProfile | Where-Object SID -eq $user.SID.Value)
if($profile.Count -eq 0) {
  # Supported Windows profile provisioning; no hand-written ProfileList registry entries.
  # https://learn.microsoft.com/en-us/windows/win32/api/userenv/nf-userenv-createprofile
  $definition=@'
using System;
using System.Text;
using System.Runtime.InteropServices;
public static class ExhibitionUserProfile {
 [DllImport("userenv.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
 public static extern int CreateProfile(string sid,string user,StringBuilder path,uint capacity);
}
'@
  Add-Type -TypeDefinition $definition
  $buffer=[Text.StringBuilder]::new(1024)
  $result=[ExhibitionUserProfile]::CreateProfile($user.SID.Value,$user.Name,$buffer,1024)
  if($result -ne 0){[Runtime.InteropServices.Marshal]::ThrowExceptionForHR($result)}
  $profile=@(Get-CimInstance Win32_UserProfile | Where-Object SID -eq $user.SID.Value)
}
if($profile.Count -ne 1 -or -not (Test-Path -LiteralPath $profile[0].LocalPath -PathType Container)){throw 'Windows could not prepare the display profile.'}
if($Role -eq 'PC3') {
  $adapters=@(Get-NetAdapter -Physical | Where-Object {$_.Status -eq 'Up' -and $_.InterfaceType -eq 6})
  if($adapters.Count -ne 1){throw 'PC3 needs exactly one connected physical Ethernet adapter for automatic setup; no network settings were changed.'}
  $adapter=$adapters[0]
  $addresses=@(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue)
  if($addresses | Where-Object {$_.IPAddress -notlike '169.254.*' -and $_.IPAddress -ne '10.10.10.4'}){throw 'PC3 Ethernet already has another configured address. Confirm its intended exhibition adapter before changing it.'}
  $existing=@($addresses | Where-Object IPAddress -eq '10.10.10.4')
  if($existing.Count -gt 0 -and ($existing.Count -ne 1 -or $existing[0].PrefixLength -ne 24)){throw 'PC3 requires 10.10.10.4/24; the existing prefix was not changed.'}
  if($existing.Count -eq 0) {
    Write-Host "Preparing PC3 Ethernet: $($adapter.Name) -> 10.10.10.4/24" -ForegroundColor Cyan
    New-NetIPAddress -InterfaceIndex $adapter.ifIndex -IPAddress '10.10.10.4' -PrefixLength 24 -ErrorAction Stop | Out-Null
  }
  Set-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -NetworkCategory Private -ErrorAction Stop
  # Verify the resulting state, including duplicate-address detection, before reporting success.
  $ready=$false
  for($attempt=0;$attempt -lt 20;$attempt++) {
    $assigned=@(Get-NetIPAddress -InterfaceIndex $adapter.ifIndex -AddressFamily IPv4 -ErrorAction Stop | Where-Object IPAddress -eq '10.10.10.4')
    if($assigned.Count -eq 1 -and $assigned[0].AddressState -eq 'Duplicate'){throw '10.10.10.4 is already in use; PC3 network setup is incomplete.'}
    if($assigned.Count -eq 1 -and $assigned[0].PrefixLength -eq 24 -and $assigned[0].AddressState -eq 'Preferred'){$ready=$true;break}
    Start-Sleep -Milliseconds 500
  }
  $profiles=@(Get-NetConnectionProfile -InterfaceIndex $adapter.ifIndex -ErrorAction Stop)
  if(-not $ready -or $profiles.Count -ne 1 -or $profiles[0].NetworkCategory -ne 'Private'){throw 'PC3 Ethernet did not become ready at 10.10.10.4/24 on a Private network.'}
}
[pscustomobject]@{prepared=$true;role=$Role;createdUser=$created;displayUser=$user.Name;profile=$profile[0].LocalPath}
