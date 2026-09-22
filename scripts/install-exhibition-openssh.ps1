# Local initial setup only. Existing sshd services are reused, never automatically upgraded.
[CmdletBinding()]
param()
$ErrorActionPreference='Stop'
if($env:SSH_CONNECTION -or $env:SSH_CLIENT){throw 'OpenSSH installation must run locally before the exhibition.'}
$principal=[Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()
if(-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)){throw 'OpenSSH initial setup requires local administrator approval.'}
$source='existing'
$service=Get-Service -Name sshd -ErrorAction SilentlyContinue
if(-not $service) {
  $manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'exhibition-openssh.json') -Raw | ConvertFrom-Json
  $architecture=if($env:PROCESSOR_ARCHITEW6432){$env:PROCESSOR_ARCHITEW6432}else{$env:PROCESSOR_ARCHITECTURE}
  $package=@($manifest.packages | Where-Object architecture -eq $architecture)
  if($package.Count -ne 1){throw "Unsupported exhibition Windows architecture: $architecture"}
  $package=$package[0]
  $file=Join-Path $PSScriptRoot ('openssh\'+$package.file)
  if(-not(Test-Path -LiteralPath $file -PathType Leaf)){throw 'OpenSSH Server is missing. Download and extract the complete offline setup kit, including its openssh folder.'}
  if((Get-Item -LiteralPath $file).Length -ne $package.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $package.sha256){throw 'OpenSSH installer SHA256 mismatch; installation was not started.'}
  $signature=Get-AuthenticodeSignature -LiteralPath $file
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)'){throw "Microsoft installer signature verification failed ($($signature.Status)); installation was not started."}
  # The official MSI starts sshd and adds a firewall rule. Keep new SSH traffic
  # blocked until our keys, scoped rule and standard task have all been verified.
  $block='CRO-MAGNON-SSH-Initial-Setup-Block'
  if(Get-NetFirewallRule -Name $block -ErrorAction SilentlyContinue) {
    Set-NetFirewallRule -Name $block -Enabled True -Direction Inbound -Action Block -Protocol TCP -LocalPort 22 -Profile Any -ErrorAction Stop
  } else {
    New-NetFirewallRule -Name $block -DisplayName 'CRO-MAGNON SSH blocked until initial setup completes' -Enabled True -Direction Inbound -Action Block -Protocol TCP -LocalPort 22 -Profile Any -ErrorAction Stop | Out-Null
  }
  $log=Join-Path $PSScriptRoot ('openssh-install-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.log')
  Write-Host "Installing official OpenSSH $($manifest.version) from the local kit..."
  $arguments=@('/i',('"'+$file+'"'),'ADDLOCAL=Server','/qn','/norestart','/L*v',('"'+$log+'"'))
  $installer=Start-Process -FilePath "$env:WINDIR\System32\msiexec.exe" -ArgumentList $arguments -WindowStyle Hidden -Wait -PassThru
  if($installer.ExitCode -in @(1641,3010)){throw "OpenSSH installation requires a Windows restart. Restart this PC outside the exhibition, then rerun Setup. Log: $log"}
  if($installer.ExitCode -ne 0){throw "OpenSSH MSI installation failed ($($installer.ExitCode)). Log: $log"}
  $service=Get-Service -Name sshd -ErrorAction Stop
  $source='offline-msi'
}
$imagePath=[Environment]::ExpandEnvironmentVariables((Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Services\sshd' -Name ImagePath).ImagePath)
$executable=if($imagePath -match '^"([^"]+\.exe)"(?:\s.*)?$'){$Matches[1]}elseif($imagePath -match '^(.+?\.exe)(?:\s.*)?$'){$Matches[1]}else{throw 'Cannot identify the installed sshd executable.'}
$executable=[IO.Path]::GetFullPath($executable)
$directory=Split-Path -Parent $executable
$keygen=Join-Path $directory 'ssh-keygen.exe'
if(-not(Test-Path -LiteralPath $executable -PathType Leaf) -or -not(Test-Path -LiteralPath $keygen -PathType Leaf)){throw 'The registered OpenSSH installation is incomplete; its executable or key generator is missing.'}
if(Get-NetFirewallRule -Name 'CRO-MAGNON-SSH-Initial-Setup-Block' -ErrorAction SilentlyContinue) {
  Stop-Service -Name sshd -ErrorAction Stop
}
# The official Server-only MSI requires this path for SCP/SFTP discovery.
# Preserve every existing entry and the registry value's expandable-string type.
$environmentKey=[Microsoft.Win32.Registry]::LocalMachine.OpenSubKey('SYSTEM\CurrentControlSet\Control\Session Manager\Environment',$true)
try {
  $machinePath=[string]$environmentKey.GetValue('Path','',[Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
  $entries=@($machinePath.Split(';') | ForEach-Object {[Environment]::ExpandEnvironmentVariables($_).TrimEnd('\')})
  if($entries -notcontains $directory.TrimEnd('\')) {
    $environmentKey.SetValue('Path',$directory+';'+$machinePath,$environmentKey.GetValueKind('Path'))
  }
} finally { $environmentKey.Dispose() }
# Disable only inbound exceptions for this sshd executable. The setup script
# creates its own Private, fixed-address, PC0-only TCP22 rule afterwards.
Get-NetFirewallApplicationFilter -Program $executable -ErrorAction SilentlyContinue | Get-NetFirewallRule | Where-Object { $_.Direction -eq 'Inbound' -and $_.Action -eq 'Allow' } | Disable-NetFirewallRule -ErrorAction Stop
[pscustomobject]@{source=$source;sshd=$executable;keygen=$keygen}
