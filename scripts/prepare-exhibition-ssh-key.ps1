# Interactive PC0-only key creation. Passphrases never enter arguments, logs or chat.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidateSet('PC1','PC2','PC3')][string]$Machine,
  [Parameter(Mandatory=$true)][string]$PublicKeyDirectory
)
$ErrorActionPreference = 'Stop'
$keyDirectory = Join-Path $env:USERPROFILE '.ssh'
$key = Join-Path $keyDirectory ('cro-magnon-' + $Machine.ToLowerInvariant())
$result = Join-Path $PublicKeyDirectory ($Machine.ToLowerInvariant() + '-key-result.json')
try {
  $Host.UI.RawUI.WindowTitle = 'CRO-MAGNON - ' + $Machine + ' SSH key passphrase'
  if ((Get-Service ssh-agent).Status -ne 'Running') { throw 'Start Windows ssh-agent during local maintenance first.' }
  New-Item -ItemType Directory -Path $keyDirectory,$PublicKeyDirectory -Force | Out-Null
  if (-not (Test-Path -LiteralPath $key)) {
    Write-Host 'Enter a NON-EMPTY passphrase twice. Do not send it in chat.' -ForegroundColor Cyan
    & ssh-keygen.exe -t ed25519 -a 64 -f $key -C ('CRO-MAGNON PC0 to ' + $Machine)
    if ($LASTEXITCODE -ne 0) { throw 'Key generation failed.' }
  }
  if (-not (Test-Path -LiteralPath ($key+'.pub'))) { throw 'The public key is missing; existing private key was preserved.' }
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & ssh-keygen.exe -y -P '""' -f $key 2>$null | Out-Null
    $unprotected = ($LASTEXITCODE -eq 0)
  } finally { $ErrorActionPreference = $previousPreference }
  if ($unprotected) { throw ('Set a non-empty passphrase with ssh-keygen -p -f "' + $key + '", then rerun this helper.') }
  Write-Host 'Enter the SAME passphrase once more to load this key into Windows ssh-agent.' -ForegroundColor Cyan
  & ssh-add.exe $key
  if ($LASTEXITCODE -ne 0) { throw 'Could not load the key into ssh-agent.' }
  Copy-Item -LiteralPath ($key+'.pub') -Destination $PublicKeyDirectory
  @{success=$true;machine=$Machine;time=(Get-Date).ToString('o')} | ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8
  Write-Host 'Key ready. Only its .pub file will be copied to the display PC.' -ForegroundColor Green
} catch {
  if (Test-Path -LiteralPath $PublicKeyDirectory) { @{success=$false;error=$_.Exception.Message} | ConvertTo-Json | Set-Content -LiteralPath $result -Encoding UTF8 }
  Write-Host $_.Exception.Message -ForegroundColor Red
}
Read-Host 'Press Enter to close'
