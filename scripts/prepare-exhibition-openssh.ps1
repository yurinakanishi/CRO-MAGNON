# Downloads installers on PC0. Never installs a service or changes Windows settings.
[CmdletBinding()]
param([string]$OutputDirectory=(Join-Path (Split-Path $PSScriptRoot -Parent) 'output\openssh-packages'))
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$manifest=Get-Content -LiteralPath (Join-Path $PSScriptRoot 'exhibition-openssh.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
$verified=@(foreach($package in $manifest.packages) {
  if($package.file -notmatch '^OpenSSH-(Win64|ARM64)-v[0-9.]+\.msi$' -or $package.url -ne ('https://github.com/PowerShell/Win32-OpenSSH/releases/download/'+$manifest.version+'/'+$package.file)){throw 'Unexpected OpenSSH package source.'}
  $file=Join-Path $OutputDirectory $package.file
  if(-not(Test-Path -LiteralPath $file)) {
    $part=$file+'.'+[guid]::NewGuid().ToString('N')+'.part'
    Invoke-WebRequest -Uri $package.url -OutFile $part -UseBasicParsing -ErrorAction Stop
    if((Get-FileHash -LiteralPath $part -Algorithm SHA256).Hash -ne $package.sha256){throw 'Downloaded OpenSSH SHA256 mismatch; incomplete file was not adopted.'}
    Move-Item -LiteralPath $part -Destination $file -ErrorAction Stop
  }
  if((Get-Item -LiteralPath $file).Length -ne $package.bytes -or (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash -ne $package.sha256){throw "Unexpected OpenSSH package: $file"}
  $signature=Get-AuthenticodeSignature -LiteralPath $file
  if($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|, )O=Microsoft Corporation(,|$)'){throw "Microsoft signature verification failed for $file ($($signature.Status))."}
  [pscustomobject]@{file=$package.file;sha256=$package.sha256;signature=$signature.Status.ToString();signer=$signature.SignerCertificate.Subject}
})
[pscustomobject]@{directory=[IO.Path]::GetFullPath($OutputDirectory);version=$manifest.version;packages=$verified}
