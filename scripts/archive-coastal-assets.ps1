$ErrorActionPreference = 'Stop'
$coastalWorkspace = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$coastalSource = [IO.Path]::GetFullPath((Join-Path $coastalWorkspace 'assets/coastal-craft/models'))
$coastalArchive = [IO.Path]::GetFullPath((Join-Path $coastalWorkspace '../threed-model-creation/models'))
$coastalKeys = @('cockle-shell','shell-midden','wooden-spear','obsidian-spear','obsidian-blade')
$coastalCopies = @()
foreach ($coastalKey in $coastalKeys) {
  $coastalFrom = [IO.Path]::GetFullPath((Join-Path $coastalSource $coastalKey))
  $coastalTo = [IO.Path]::GetFullPath((Join-Path $coastalArchive $coastalKey))
  if (-not $coastalFrom.StartsWith($coastalSource + [IO.Path]::DirectorySeparatorChar) -or -not $coastalTo.StartsWith($coastalArchive + [IO.Path]::DirectorySeparatorChar)) { throw 'Archive path outside the checked model roots' }
  if (Test-Path -LiteralPath $coastalTo) { throw "Refusing to overwrite existing archive: $coastalTo" }
  foreach ($coastalFile in Get-ChildItem -LiteralPath $coastalFrom -File -Recurse -Force) {
    if ($coastalFile.Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Unexpected model link' }
    $coastalRelative = [IO.Path]::GetRelativePath($coastalFrom, $coastalFile.FullName)
    $coastalDestination = [IO.Path]::GetFullPath((Join-Path $coastalTo $coastalRelative))
    if (-not $coastalDestination.StartsWith($coastalTo + [IO.Path]::DirectorySeparatorChar)) { throw 'File escaped archive' }
    $coastalCopies += [pscustomobject]@{source=$coastalFile.FullName; destination=$coastalDestination; bytes=$coastalFile.Length; sha256=(Get-FileHash -LiteralPath $coastalFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}
  }
}
# Check the complete manifest before any write; copy exclusively and never delete/move a source.
foreach ($coastalCopy in $coastalCopies) {
  [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($coastalCopy.destination)) | Out-Null
  [IO.File]::Copy($coastalCopy.source, $coastalCopy.destination, $false)
  if ((Get-FileHash -LiteralPath $coastalCopy.destination -Algorithm SHA256).Hash.ToLowerInvariant() -ne $coastalCopy.sha256) { throw 'Archive SHA mismatch' }
}
$coastalReport = @{status='passed'; at=(Get-Date).ToUniversalTime().ToString('o'); root=$coastalArchive; models=$coastalKeys; files=$coastalCopies.Count; bytes=($coastalCopies | Measure-Object bytes -Sum).Sum; overwritten=0; deleted=0; copies=$coastalCopies}
$coastalReport | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $coastalWorkspace 'assets/coastal-craft/archive-qa.json') -Encoding utf8
$coastalReport | Select-Object status,files,bytes,overwritten,deleted | ConvertTo-Json
