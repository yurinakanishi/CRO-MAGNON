#!/bin/sh
# compare_static.sh <key> <newGlb> <oldUrl> [views] -> output/asset-remake/<key>/compare-<tag>.jpg
key=$1; new=$2; old=$3; tag=${4:-c2}
cd "$(dirname "$0")/../.."
cp "$new" "public/models/_review/$key-$tag.glb"
cat > "output/asset-remake/jobs-$key.json" <<JSON
[{"out":"output/asset-remake/$key/old","model":"$old","views":[{"camera":"front"},{"camera":"left"},{"camera":"top"}]},
 {"out":"output/asset-remake/$key/$tag","model":"/models/_review/$key-$tag.glb","views":[{"camera":"front"},{"camera":"left"},{"camera":"top"}]}]
JSON
QA_SOFTWARE_GL=1 timeout 900 node scripts/qa-remake-neutral-views.mjs "output/asset-remake/jobs-$key.json" > /dev/null 2>&1
d=output/asset-remake/$key
python scripts/remake/sheet.py "$d/compare-$tag.jpg" 3 $d/old/front.png $d/old/left.png $d/old/top.png $d/$tag/front.png $d/$tag/left.png $d/$tag/top.png
