#!/bin/sh
# normal_pipeline.sh <key> <dense.glb> [size=2048] [extrusionFrac=.004] [tag=n01]
# Geometry-preserving upgrade of a delivered static GLB: similarity ICP of the TRELLIS dense onto the delivered
# mesh (fit_to_delivered.py) -> tangent normal bake on the delivered UVs (normal_upgrade.py, one map per material
# slot) -> appended WebP + normalTexture (inject_normal_map.py) -> before/after renders. Adopt separately with
# adopt_normal_injection.mjs after reviewing output/asset-remake/compare/<key>/pair-*.png.
key=$1; dense=$2; size=${3:-2048}; frac=${4:-.004}; tag=${5:-n01}
cd "$(dirname "$0")/../.."
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
R=$(pwd -W)
W=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02
mkdir -p $W
url=$(python -c "import json;print([a for a in json.load(open('public/models/world-assets.json',encoding='utf8'))['assets'] if a['modelKey']=='$key'][0]['url'])")
cur=$R/public$url
[ -f $W/fit-matrix.json ] || "$B" -b --python scripts/remake/fit_to_delivered.py -- --dense "$dense" --target "$cur" --out $W/fit-matrix.json 2>&1 | grep -E "FIT_DONE|Error|Traceback" | cut -c1-260
"$B" -b --python scripts/remake/normal_upgrade.py -- --delivered "$cur" --dense "$dense" --matrix $W/fit-matrix.json --out $W/normal-$tag.png --size $size --extrusion-frac $frac 2>&1 | grep -E "Error|Traceback"
pngs=$(python -c "import json;print(','.join(json.load(open(r'$W/normal-$tag.json'))['pngs']))")
python scripts/remake/inject_normal_map.py "$cur" "$pngs" $W/model-$tag.glb | cut -c1-120
O=$R/output/asset-remake/compare/$key
for v in before:$cur $tag:$W/model-$tag.glb; do
  n=${v%%:*}; g=${v#*:}
  "$B" -b --python scripts/remake/render_clips.py -- "$g" "$O/$n" --views front,threequarter --size 640 2>&1 | grep -E "Error|Traceback"
  "$B" -b --python scripts/remake/render_clips.py -- "$g" "$O/$n-close" --views threequarter --size 640 --zoom 3 2>&1 | grep -E "Error|Traceback"
done
python -c "
from PIL import Image
for s,v in (('','front'),('','threequarter'),('-close','threequarter')):
    a=Image.open(r'$O/before'+s+'/rest-'+v+'.png').convert('RGB'); b=Image.open(r'$O/$tag'+s+'/rest-'+v+'.png').convert('RGB')
    c=Image.new('RGB',(a.width*2,a.height)); c.paste(a,(0,0)); c.paste(b,(a.width,0)); c.save(r'$O/pair'+s+'-'+v+'.png')
"
python -c "import json;r=json.load(open(r'$W/normal-$tag.json'));f=json.load(open(r'$W/fit-matrix.json'));print('$key', 'fit rms/p95', round(f['rms_m'],4), round(f['p95_m'],4), 'scale', round(f['scale'],3), 'texels', r['island_texels'], 'miss', r['first_pass_misses'], 'filled', r['neighbour_filled'], 'flip', r['flipped_backfacing_normals'], r['seconds'],'s')"
