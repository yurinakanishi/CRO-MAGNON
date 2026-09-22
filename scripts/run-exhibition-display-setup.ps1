[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('PC1','PC2')][string]$Role,
  [string]$DisplayUser = 'CRO-MAGNON'
)
$ErrorActionPreference = 'Stop'
# Initial Windows setup is a local, pre-exhibition operation. Never turn an SSH
# maintenance command into an administrator prompt on the visitor's screen.
if ($env:SSH_CONNECTION -or $env:SSH_CLIENT) {
  throw 'Remote setup is disabled. Report the missing permission on PC0 and perform local administrator setup before the exhibition.'
}
$principal = [Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  try {
    $arguments = @('-NoProfile','-ExecutionPolicy','Bypass','-File',('"{0}"' -f $PSCommandPath),'-Role',$Role,'-DisplayUser',('"{0}"' -f $DisplayUser))
    $process = Start-Process -FilePath "$env:WINDIR\System32\WindowsPowerShell\v1.0\powershell.exe" -Verb RunAs -WindowStyle Normal -ArgumentList $arguments -Wait -PassThru
    if ($process.ExitCode -ne 0) { throw 'Administrator setup did not complete successfully.' }
  } catch {
    Write-Host $_.Exception.Message -ForegroundColor Red
    Read-Host 'Setup is incomplete. Press Enter to close'
    exit 1
  }
  exit 0
}
$exitCode = 0
try {
  $pub = Join-Path $PSScriptRoot ('cro-magnon-' + $Role.ToLowerInvariant() + '.pub')
  $details = & (Join-Path $PSScriptRoot 'setup-exhibition-ssh-display.ps1') -Role $Role -DisplayUser $DisplayUser -PublicKeyFile $pub
  if ($details.success -ne $true) { throw 'The setup did not report success.' }
  $report = [pscustomobject]@{success=$true; timestamp=(Get-Date).ToString('o'); details=$details}
  Write-Host 'SSH and Public folder setup completed. Ask PC0 to verify login and read/write access.' -ForegroundColor Green
} catch {
  $exitCode = 1
  $report = [pscustomobject]@{success=$false; timestamp=(Get-Date).ToString('o'); error=$_.Exception.Message}
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host 'Setup is incomplete. Report this error to the PC0 operator.' -ForegroundColor Yellow
}
try {
  $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $PSScriptRoot ("setup-$Role-result.json")) -Encoding UTF8
} catch { Write-Warning 'The setup result could not be saved in this folder.' }
Read-Host 'Press Enter to close'
exit $exitCode
