#!/bin/sh
# human_graft.sh <key> <bodyDense> <headDense> <height> <rev> <neckZ> [darkAboveZ|none] [chinBand|none] [bodyYaw]
# align (body placement + head similarity ICP) -> body: Blender QEM keeping TRELLIS UVs, cut above the neck, optional
# dark-hair face removal -> head: meshopt 16k + xatlas, cut below the neck, albedo/normal bake -> merge with skin-tone
# gain (+ optional chin-band clean-up). Env: ALIGN_FLAGS (e.g. '--skin-only --upright'), HEAD_EXTRA (remake_process args),
# HEAD_CUT (head cut-below z when it should differ from the body neck cut, e.g. to keep a long beard),
# MERGE_EXTRA (merge_head.py args, e.g. '--hair-band 1.28,1.42,.06'). Output graft/body-<rev>, graft/head-<rev>, graft/merged-<rev>.glb (+ head views).
key=$1; body=$2; head=$3; height=$4; rev=$5; neck=$6; dark=${7:-none}; chin=${8:-none}; yaw=${9:-0}
cd "$(dirname "$0")/../.."
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
H=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02
G=$H/graft; mkdir -p $G
[ -f $G/head-matrix.json ] || "$B" -b --python scripts/remake/align_head.py -- --body "$body" --head "$head" --height $height --out $G --body-yaw $yaw $ALIGN_FLAGS 2>&1 | grep -E "ALIGN_DONE|Error|Traceback" | cut -c1-300
darkarg=""; [ "$dark" != "none" ] && darkarg="--drop-dark-above $dark"
"$B" -b --python scripts/remake/remake_process.py -- --dense "$body" --out $G/body-$rev --matrix $G/body-matrix.json --height $height --budget 44000 --cut-above $neck $darkarg --name Body --rough-min .5 --rough-max .9 --albedo 2048 --normal 2048 2>&1 | grep -E "Error|Traceback"
[ -f $G/head-xatlas-16k.glb ] || { node scripts/remake/meshopt_reduce.mjs "$head" $G/head-meshopt-16k.glb 16000 .01 > /dev/null && output/asset-remake/.venv-xatlas/Scripts/python.exe scripts/remake/xatlas_unwrap.py $G/head-meshopt-16k.glb $G/head-xatlas-16k.glb --resolution 2048 --padding 4 > /dev/null; }
"$B" -b --python scripts/remake/remake_process.py -- --dense "$head" --low $G/head-xatlas-16k.glb --out $G/head-$rev --matrix $G/head-matrix.json --height $height --budget 16000 --cut-below ${HEAD_CUT:-$neck} --name Head --rough-const .6 --albedo 2048 --normal 2048 --rebake --keep-low-uv --extrusion-frac .02 $HEAD_EXTRA 2>&1 | grep -E "Error|Traceback"
chinarg=""; [ "$chin" != "none" ] && chinarg="--chin-band $chin"
"$B" -b --python scripts/remake/merge_head.py -- --body $G/body-$rev/candidate.glb --head $G/head-$rev/candidate.glb --out $G/merged-$rev.glb $chinarg $MERGE_EXTRA 2>&1 | grep -E "MERGE_DONE|Error" | cut -c1-200
for v in front threequarter left; do :; done
"$B" -b --python scripts/remake/render_clips.py -- $G/merged-$rev.glb $G/merged-$rev-views --views front,threequarter,left,back --size 520 --focus 0,0,$(python -c "print(round($height*0.86,3))"),$(python -c "print(round($height*0.32,3))") 2>&1 | grep -E "Error|Traceback"
"$B" -b --python scripts/remake/render_clips.py -- $G/merged-$rev.glb $G/merged-$rev-full --views front,left --size 520 2>&1 | grep -E "Error|Traceback"
python scripts/remake/sheet.py $G/merged-$rev-sheet.jpg 3 $G/merged-$rev-views/rest-front.png $G/merged-$rev-views/rest-threequarter.png $G/merged-$rev-views/rest-left.png $G/merged-$rev-views/rest-back.png $G/merged-$rev-full/rest-front.png $G/merged-$rev-full/rest-left.png
