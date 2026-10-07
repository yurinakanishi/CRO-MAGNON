#!/bin/sh
# adopt_static.sh <key> <lowpolyDir> <refTag> <denseFile> <lodDistance|none> "<note>"
key=$1; dir=$2; ref=$3; dense=$4; lodd=$5; note=$6
M=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key
cd "$(dirname "$0")/../.."
lods='[]'
[ "$lodd" != "none" ] && [ -f "$M/$dir/lod1.glb" ] && lods="[{\"glb\":\"$M/$dir/lod1.glb\",\"distanceMetres\":$lodd,\"purpose\":\"medium-distance-lod\"}]"
node -e "
const fs=require('fs');const rep=JSON.parse(fs.readFileSync('$M/$dir/process-report.json','utf8'));
const spec={key:'$key',candidate:2,glb:'$M/$dir/candidate.glb',lods:$lods,reference:'$M/source/original/$ref',dense:'$M/$dense',
processReport:'output/model-generation/models/$key/$dir/process-report.json',
notes:['2026-10-07 remake Candidate 2: '+process.argv[1]+' TRELLIS-2 1024/tex1024; '+rep.reduction.triangles+' triangles (meshopt reduction, fresh UVs, albedo and tangent-space normal baked from the '+rep.dense.triangles+'-triangle dense surface; p95 surface error '+(rep.reduction.error.dense_to_low.p95_m*1000).toFixed(1)+' mm). Candidate 1 files retained.']};
fs.writeFileSync('output/asset-remake/adopt-$key.json',JSON.stringify(spec,null,1));" "$note"
node scripts/remake/adopt_world_asset.mjs output/asset-remake/adopt-$key.json | grep -E '"url"|"triangles"' | head -4
