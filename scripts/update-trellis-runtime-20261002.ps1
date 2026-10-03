$ErrorActionPreference = 'Stop'
$workspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$recordRoot = Join-Path $workspace 'output/trellis-update-20261002'
$installRoot = [IO.Path]::GetFullPath((Join-Path $workspace '../threed-model-creation/trellis-studio'))
$before = Get-Content -LiteralPath (Join-Path $recordRoot 'before.json') -Raw | ConvertFrom-Json
$release = Get-Content -LiteralPath (Join-Path $recordRoot 'release.json') -Raw | ConvertFrom-Json
if ($before.root -ne $installRoot -or $release.tag_name -ne 'v0.8.1' -or $release.prerelease) {
  throw 'Unexpected installation root or release.'
}
function Hash-File([string]$file) {
  return (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant()
}
foreach ($name in @('trellis-cuda-windows-x64.zip', 'trellis-studio-windows-x64-portable.zip')) {
  $asset = $release.assets | Where-Object name -EQ $name
  if ((Hash-File (Join-Path $recordRoot $name)) -ne $asset.digest.Split(':')[1]) {
    throw "Archive digest mismatch: $name"
  }
}
$running = @(Get-CimInstance Win32_Process | Where-Object {
  $_.Name -match '^trellis-(cli|server|studio)\.exe$' -and
  (!$_.ExecutablePath -or $_.ExecutablePath.StartsWith($installRoot + '\', [StringComparison]::OrdinalIgnoreCase))
})
if ($running.Count) { throw 'The target TRELLIS installation is in use; no files changed.' }
$runtimeStage = Join-Path $recordRoot 'trellis-cuda-windows-x64'
$studioStage = Join-Path $recordRoot 'trellis-studio-windows-x64-portable'
$targets = @()
foreach ($file in Get-ChildItem -LiteralPath $runtimeStage -File) {
  $targets += [pscustomobject]@{relative="runtime/$($file.Name)"; source=$file.FullName}
}
foreach ($name in @('trellis-studio.exe', 'README.txt', 'portable.dat')) {
  $targets += [pscustomobject]@{relative=$name; source=(Join-Path $studioStage $name)}
}
if ($targets.Count -ne 12) { throw 'Unexpected release file layout.' }
foreach ($target in $targets) {
  $old = $before.files | Where-Object path -EQ $target.relative
  if (!$old -or (Hash-File (Join-Path $installRoot $target.relative)) -ne $old.sha256) {
    throw "Installed file changed since inventory: $($target.relative)"
  }
}
$backup = Join-Path $installRoot ('backups/before-v0.8.1-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
if (Test-Path -LiteralPath $backup) { throw 'Backup already exists.' }
foreach ($target in $targets) {
  $destination = Join-Path $backup $target.relative
  New-Item -ItemType Directory -Path (Split-Path $destination) -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $installRoot $target.relative) -Destination $destination
  $old = $before.files | Where-Object path -EQ $target.relative
  if ((Hash-File $destination) -ne $old.sha256) { throw 'Backup verification failed; originals unchanged.' }
}
Copy-Item -LiteralPath (Join-Path $recordRoot 'before.json') -Destination (Join-Path $backup 'inventory.json')
try {
  $installed = @()
  foreach ($target in $targets) {
    $destination = Join-Path $installRoot $target.relative
    Copy-Item -LiteralPath $target.source -Destination $destination -Force
    $sha = Hash-File $destination
    if ($sha -ne (Hash-File $target.source)) { throw "Install hash mismatch: $($target.relative)" }
    $installed += [pscustomobject]@{path=$target.relative;sha256=$sha;bytes=(Get-Item -LiteralPath $destination).Length}
  }
  $version = (Get-Item -LiteralPath (Join-Path $installRoot 'trellis-studio.exe')).VersionInfo.ProductVersion
  if ($version -ne '0.8.1') { throw 'Installed Studio version mismatch.' }
  $modelFiles = @($before.files | Where-Object { $_.path.StartsWith('models/') })
  foreach ($file in $modelFiles) {
    if ((Hash-File (Join-Path $installRoot $file.path)) -ne $file.sha256) {
      throw "Existing weight changed: $($file.path)"
    }
  }
  $record = [pscustomobject]@{
    installedAt=(Get-Date).ToUniversalTime().ToString('o');release=$release.tag_name;
    releaseUrl=$release.html_url;root=$installRoot;beforeStudioVersion=$before.studioVersion;
    studioVersion=$version;backup=$backup;files=$installed;preservedModels=$modelFiles;
    modelHashesUnchanged=$true;sourceCheckoutChanged=$false;dataOrConfigChanged=$false;
    verification='Pending CLI, CUDA background removal and server health checks'
  }
  $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $recordRoot 'installation.json') -Encoding utf8
  $record | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath (Join-Path $installRoot 'installed-release.json') -Encoding utf8
  [pscustomobject]@{installed=$version;backup=$backup;verifiedFiles=$installed.Count;preservedGGUF=$modelFiles.Count} | ConvertTo-Json
} catch {
  foreach ($target in $targets) {
    Copy-Item -LiteralPath (Join-Path $backup $target.relative) -Destination (Join-Path $installRoot $target.relative) -Force
  }
  throw
}
