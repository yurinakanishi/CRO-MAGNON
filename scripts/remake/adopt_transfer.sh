#!/bin/sh
# adopt_transfer.sh <key> <transferDir tNN> <lodRatio> <lodDistance|keep> "<note>"
# Builds the animated LOD from the new GLB (scripts/build-performance-lods.py) and adopts both with
# adopt_world_asset.mjs; clips/placement/height/locomotion stay those of the delivered manifest.
key=$1; t=$2; ratio=$3; dist=$4; note=$5
W=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02/transfer/$t
cd "$(dirname "$0")/../.."
[ -f "$W/lod-performance.glb" ] || "/c/Program Files/Blender Foundation/Blender 5.2/blender.exe" -b --python scripts/build-performance-lods.py -- "$W/candidate.glb" "$W/lod-performance.glb" $ratio 2>&1 | grep -iE "error|traceback"
PYTHONIOENCODING=utf-8 python - "$key" "$W" "$dist" "$note" <<'PY'
import json, os, sys
key, W, dist, note = sys.argv[1:5]
p = f'public/models/{key}/asset.json'
old = json.load(open(p, encoding='utf-8')) if os.path.exists(p) else [a for a in json.load(open('public/models/world-assets.json', encoding='utf-8'))['assets'] if a['modelKey'] == key][0]
rep = json.load(open(W + '/report.json'))
src = rep['source']['path']  # repo-relative: the delivered GLB the transfer started from
d = old['lods'][0]['distanceMetres'] if dist == 'keep' and old.get('lods') else float(dist if dist != 'keep' else 28)
spec = {'key': key, 'candidate': 2, 'glb': W + '/candidate.glb',
        'lods': [{'glb': W + '/lod-performance.glb', 'distanceMetres': d, 'purpose': 'animated-medium-lod-geometry'}],
        'reference': src, 'dense': src,
        'processReport': W.replace('C:/Users/yurin/Desktop/projects/CRO-MAGNON/', '') + '/report.json',
        'heightMetres': old.get('heightMetres'), 'clips': old.get('clips'),
        'provenance': {'referenceGenerator': 'none: derived from the delivered, user-approved surface (identity unchanged)',
                       'reconstruction': 'no new reconstruction; the delivered rest surface is the bake and skin-weight source',
                       'transfer': 'scripts/remake/transfer_reduce.py (meshopt subset of delivered vertices, xatlas charts, albedo/normal bake with miss fill and back-face flip, Data Transfer skin weights; armature, bone names and clips re-exported unchanged)'},
        'notes': [note + f" Posed deviation from the delivered skin 0 m (kept vertices are a subset); clip curves within 0.04 deg (resampling). {rep['output']['triangles']} triangles (was {old['triangles']}), textures {rep['textures']['albedo']} WebP + baked normal."]}
json.dump(spec, open(f'output/asset-remake/adopt-{key}.json', 'w'), indent=1)
PY
node scripts/remake/adopt_world_asset.mjs output/asset-remake/adopt-$key.json | grep -E '"url"|"triangles"' | head -4
