#!/bin/sh
# reduce_delivered.sh <key> <delivered.glb> <budget> <tex> <Name> [extra transfer_reduce build args...]
# delivered (rest, world space) -> meshopt -> xatlas -> transfer_reduce build (bake + weight transfer, same rig)
# -> copy_animations.mjs (the delivered clips verbatim)
key=$1; src=$2; budget=$3; tex=$4; name=$5; shift 5
W=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02/transfer
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
cd "$(dirname "$0")/../.."; mkdir -p "$W"
"$B" -b --python scripts/remake/transfer_reduce.py -- export-rest "$src" "$W/rest.glb" 2>&1 | grep -E "REST_DONE|Error|Traceback"
node scripts/remake/meshopt_reduce.mjs "$W/rest.glb" "$W/meshopt-$budget.glb" $budget .01 | python -c "import json,sys;d=json.load(sys.stdin);print('meshopt',d['before'],'->',d['after'],round(d['error'],5),d['method'][:40])"
output/asset-remake/.venv-xatlas/Scripts/python.exe scripts/remake/xatlas_unwrap.py "$W/meshopt-$budget.glb" "$W/xatlas-$budget-$tex.glb" --resolution $tex --padding 4 | python -c "import json,sys;d=json.loads(sys.stdin.read().split('XATLAS_DONE ',1)[1]);print('xatlas charts',d['charts'],'coverage',round(d['uv_area_coverage'],3))"
n=1; while [ -d "$W/t$(printf %02d $n)" ]; do n=$((n+1)); done; out="$W/t$(printf %02d $n)"
"$B" -b --python scripts/remake/transfer_reduce.py -- build "$src" "$W/xatlas-$budget-$tex.glb" "$out" --albedo $tex --normal $tex --name "$name" "$@" 2>&1 | grep -E "Error|Traceback|line [0-9]"
# Blender re-samples every clip at one frame rate; restore the delivered clips verbatim (exact durations/loops).
mv "$out/candidate.glb" "$out/candidate-resampled.glb"
node scripts/remake/copy_animations.mjs "$src" "$out/candidate-resampled.glb" "$out/candidate.glb" | cut -c1-160
python -c "import json;d=json.load(open(r'$out/report.json'));print('$out', d['output']['triangles'], d['output']['bytes'], {k:(v['first_pass_misses'],v['flipped_backfacing_normals']) for k,v in d['textures']['bake_fill'].items()}, 'unweighted', d['weights']['unweighted_vertices'], 'actions', len(d['actions']))"
"$B" -b --python scripts/remake/posed_deviation.py -- "$src" "$out/candidate.glb" --samples 4 2>&1 | grep -E "POSED_DEV|Error" | cut -c1-400
node output/asset-remake/anim-compare.mjs "$src" "$out/candidate.glb" | tail -1
