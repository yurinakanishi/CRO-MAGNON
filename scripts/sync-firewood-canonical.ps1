$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$sourceRoot = (Resolve-Path -LiteralPath (Join-Path $projectRoot 'output/model-generation/models/firewood-log')).Path
$canonicalParent = (Resolve-Path -LiteralPath (Join-Path $projectRoot '../threed-model-creation/models')).Path
$targetRoot = [IO.Path]::GetFullPath((Join-Path $canonicalParent 'firewood-log'))
if ($targetRoot -ne (Join-Path $canonicalParent 'firewood-log')) { throw 'Invalid canonical model directory' }
if (Test-Path -LiteralPath $targetRoot) {
  if ((Get-Item -LiteralPath $targetRoot).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Canonical directory is a link' }
}
[IO.Directory]::CreateDirectory($targetRoot) | Out-Null
$records = @()
foreach ($file in Get-ChildItem -LiteralPath $sourceRoot -Recurse -File) {
  $relative = [IO.Path]::GetRelativePath($sourceRoot, $file.FullName)
  $destination = [IO.Path]::GetFullPath((Join-Path $targetRoot $relative))
  if (-not $destination.StartsWith($targetRoot + [IO.Path]::DirectorySeparatorChar)) { throw 'Copy escapes model folder' }
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($destination)) | Out-Null
  if (-not (Test-Path -LiteralPath $destination)) { [IO.File]::Copy($file.FullName, $destination, $false) }
  $sourceHash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
  $targetHash = (Get-FileHash -LiteralPath $destination -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($sourceHash -ne $targetHash) { throw "Preserved file differs: $relative" }
  $records += [ordered]@{path=$relative.Replace('\','/');bytes=$file.Length;sha256=$sourceHash}
}
$report = [ordered]@{at=[DateTime]::UtcNow.ToString('o');source='output/model-generation/models/firewood-log';target='../threed-model-creation/models/firewood-log';count=$records.Count;status='passed';files=$records}
$json = $report | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText((Join-Path $projectRoot 'assets/firewood-log/canonical-sync.json'), $json + "`n", [Text.UTF8Encoding]::new($false))
Write-Output "Canonical firewood archive: $($records.Count) files, all SHA-256 equal; no existing file overwritten."
