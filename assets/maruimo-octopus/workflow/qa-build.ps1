param([Parameter(Mandatory=$true)][ValidatePattern('^\d{2}$')][string]$Revision)
$ErrorActionPreference='Stop'
$modelRoot=Join-Path (Get-Location) 'output/model-generation/models/maruimo-octopus'
$source=Join-Path $modelRoot "work/rig/revision-$Revision/candidate.glb"
$out=Join-Path $modelRoot "qa/final-$Revision"
$blender='C:\Program Files\Blender Foundation\Blender 3.6\blender.exe'
function Invoke-Review([string]$Script,[string[]]$ScriptArguments,[string]$Log) {
  & $blender --background --python-exit-code 1 --python $Script -- @ScriptArguments *> $Log
  if ($LASTEXITCODE -ne 0) { throw "Blender failed: $Log" }
}
Invoke-Review 'assets/maruimo-octopus/workflow/render-review.py' @('--input',$source,'--output',"$out/static",'--clip','Idle_Loop','--time','0') "$modelRoot/qa/render-static-r$Revision.log"
Invoke-Review 'assets/maruimo-octopus/workflow/render-review.py' @('--input',$source,'--output',"$out/static",'--clip','Idle_Loop','--time','0','--clay') "$modelRoot/qa/render-clay-r$Revision.log"
Invoke-Review 'assets/maruimo-octopus/workflow/render-review.py' @('--input',$source,'--output',"$out/portrait",'--clip','Idle_Loop','--time','0','--portrait','--views','front') "$modelRoot/qa/render-portrait-r$Revision.log"
$lodRaw="$modelRoot/work/rig/revision-$Revision/lod-rest.glb"
$lodAligned="$modelRoot/work/rig/revision-$Revision/lod-aligned.glb"
Invoke-Review 'assets/maruimo-octopus/workflow/build-lod.py' @($source,$lodRaw,'.12') "$modelRoot/qa/lod-r$Revision.log"
& node 'assets/maruimo-octopus/workflow/align-lod.mjs' $source $lodRaw $lodAligned
if ($LASTEXITCODE -ne 0) { throw 'LOD bind alignment failed' }
Invoke-Review 'assets/maruimo-octopus/workflow/render-motion.py' @($source,"$out/motion") "$modelRoot/qa/render-motion-r$Revision.log"
Write-Output "Rendered static, clay, portrait, all clips and geometry LOD: revision $Revision"
