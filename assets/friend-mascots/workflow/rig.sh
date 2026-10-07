#!/bin/sh
# rig.sh <key> <surfaceRevision> <rigRevision>
# Rig + eight clips + LOD from assets/friend-mascots/<key>/rig.json, then front/three-quarter pose sheets.
key=$1; surf=$2; rev=$3
cd "$(dirname "$0")/../../.."
B="/c/Program Files/Blender Foundation/Blender 3.6/blender.exe"
"$B" -b --python assets/friend-mascots/workflow/rig.py -- --key $key --surface $surf --revision $rev 2>&1 | grep -E "^\{|Error|Traceback|rror:"
R=$(pwd -W)/output/model-generation/models/$key/work/rig/revision-$rev
"$B" -b --python assets/friend-mascots/workflow/render_poses.py -- "$R/candidate.glb" "$R/poses" 2>&1 | grep -E "Error|Traceback"
python assets/friend-mascots/workflow/sheet_poses.py "$R/poses" front
python assets/friend-mascots/workflow/sheet_poses.py "$R/poses" three
