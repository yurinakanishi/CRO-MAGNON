#!/bin/sh
# surface.sh <key> <revision> [budget=24000] [height=0.52] [texture=2048]
# Dense TRELLIS GLB -> meshopt position-only reduction -> Blender 3.6 weld/bake/normalise -> landmark sheet.
key=$1; rev=$2; budget=${3:-24000}; height=${4:-0.52}; tex=${5:-2048}
cd "$(dirname "$0")/../../.."
W=output/model-generation/models/$key/work/candidate-01
dense=$(ls $W/trellis/dense-*.glb | head -1)
mkdir -p $W/low-poly
node scripts/remake/meshopt_reduce.mjs "$dense" "$W/low-poly/meshopt-$budget.glb" $budget .01 | cut -c1-260
B="/c/Program Files/Blender Foundation/Blender 3.6/blender.exe"
"$B" -b --python assets/friend-mascots/workflow/prepare_surface.py -- --key $key --dense "$(pwd -W)/$dense" \
  --low "$(pwd -W)/$W/low-poly/meshopt-$budget.glb" --revision $rev --height $height --texture $tex 2>&1 | grep -E "^\{|Error|Traceback"
python assets/friend-mascots/workflow/annotate.py output/model-generation/models/$key/work/surface/revision-$rev
python assets/friend-mascots/workflow/measure_landmarks.py output/model-generation/models/$key/work/surface/revision-$rev
