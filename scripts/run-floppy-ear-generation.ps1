$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$lockFile = Join-Path $projectRoot 'output\model-generation\models\world-trellis.lock'
$runner = Join-Path $projectRoot 'output\model-generation\models\floppy-ear-mage\workflow\current\generate-playable-model.py'
$pythonExe = 'C:\Users\yurin\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
Write-Output 'Waiting for the existing TRELLIS/Blender work to release the GPU.'
$idleSamples = 0
while ($idleSamples -lt 3) {
    $busy = @(Get-Process -Name trellis-cli,blender -ErrorAction SilentlyContinue)
    if ((Test-Path -LiteralPath $lockFile) -or $busy.Count -gt 0) { $idleSamples = 0 }
    else { $idleSamples++ }
    if ($idleSamples -lt 3) { Start-Sleep -Seconds 10 }
}
Write-Output 'GPU is free; starting the single floppy-ear-mage candidate.'
& $pythonExe $runner floppy-ear-mage
exit $LASTEXITCODE
