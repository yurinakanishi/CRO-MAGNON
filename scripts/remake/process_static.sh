#!/bin/sh
# process_static.sh <key> <denseName> <budget> <height> <measure> <albedo> <lodFrac|none> [extra remake_process args...]
# meshopt reduction -> xatlas charts (packed for <albedo>) -> remake_process --rebake --keep-low-uv
# Env MESHOPT_ERROR (default .01 of the extent): raise for many small separate parts (berry clusters).
# (albedo by emission bake, tangent normal bake with miss fill and back-face flip, LODs from the low mesh).
key=$1; dense=$2; budget=$3; height=$4; measure=$5; tex=$6; lod=$7; shift 7
W=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02
cd "$(dirname "$0")/../.."; mkdir -p "$W/low-poly"
node scripts/remake/meshopt_reduce.mjs "$W/trellis/$dense" "$W/low-poly/meshopt-$budget.glb" $budget ${MESHOPT_ERROR:-.01} | cut -c1-200
got=$(node -e "const b=require('fs').readFileSync('$W/low-poly/meshopt-$budget.glb'),j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));console.log(j.meshes.reduce((n,m)=>n+m.primitives.reduce((k,p)=>k+j.accessors[p.indices].count/3,0),0))")
# meshopt stops at its error bound (many small separate parts); xatlas on such a mesh runs for hours.
if [ "$got" -gt $((budget * 2)) ]; then echo "ABORT: meshopt kept $got triangles for budget $budget; raise MESHOPT_ERROR"; exit 1; fi
output/asset-remake/.venv-xatlas/Scripts/python.exe scripts/remake/xatlas_unwrap.py "$W/low-poly/meshopt-$budget.glb" "$W/low-poly/xatlas-$budget-$tex.glb" --resolution $tex --padding 4 | cut -c1-260
n=1; while [ -d "$W/low-poly/m$(printf %02d $n)" ]; do n=$((n+1)); done; out="$W/low-poly/m$(printf %02d $n)"
lods=""; [ "$lod" != "none" ] && lods="--lods $lod"
"/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/remake/remake_process.py -- --dense "$W/trellis/$dense" --low "$W/low-poly/xatlas-$budget-$tex.glb" --rebake --keep-low-uv --out "$out" --height $height --measure $measure --budget $budget --name "$key" --albedo $tex --normal $tex $lods "$@" 2>&1 | grep -E "Error|Traceback"
python -c "import json;d=json.load(open(r'$out/process-report.json'));r=d['reduction'];print('$out', [(o['path'],o['triangles'],o['bytes']) for o in d['outputs']], 'p95mm', round(r['error']['dense_to_low']['p95_m']*1000,1), 'bounds', [round(x,3) for x in d['alignment']['bounds_blender_z_up']['max']], 'fill', {k:(v['first_pass_misses'],v['flipped_backfacing_normals']) for k,v in d['textures'].get('bake_fill',{}).items()})"
