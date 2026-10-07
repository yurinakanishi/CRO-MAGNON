#!/bin/sh
# human_chain.sh <key> <merged.glb> <rigRev> <heightMetres> <Name> [spear|nospear]
# rig_human_c2 (height-normalised) -> spear thrust (if the character carries a spear) -> Downed -> CMU locomotion
# -> animated LOD (scripts/build-performance-lods.py, ratio 0.2). Output: output/asset-remake/motion/<key>-<rigRev>/
# Env: RIG_EXTRA (rig_human_c2.py args, e.g. '--accent none' for characters without a TribeAccent slot),
# RETARGET_ATTACK_FROM (delivered GLB whose Attack clip is retargeted instead of the spear thrust).
key=$1; merged=$2; rev=$3; height=$4; name=$5; spear=${6:-spear}
cd "$(dirname "$0")/../.."
B="/c/Program Files/Blender Foundation/Blender 5.2/blender.exe"
H=C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models/$key/work/candidate-02
"$B" -b --python scripts/remake/rig_human_c2.py -- --source "$merged" --out "$H/rig/$rev" --name $name --height $height $RIG_EXTRA 2>&1 | grep -E "RIG_DONE|Error|Traceback" | cut -c1-120
S=output/asset-remake/motion/$key-$rev; rm -rf $S; mkdir -p $S/stage0
cp $H/rig/$rev/candidate.glb $S/stage0/model.glb
node -e "
const fs=require('fs'),c=require('crypto');const b=fs.readFileSync('$S/stage0/model.glb');
const a=JSON.parse(require('child_process').execFileSync('git',['show','HEAD:public/models/$key/asset.json'],{encoding:'utf8'}));
const rep=JSON.parse(fs.readFileSync('$H/rig/$rev/rig-report.json','utf8'));
for (const k of ['humanLocomotion','spearThrust','downedMotion','hunting','motionReview','locomotion']) delete a[k];
Object.assign(a,{url:'/models/$key/stage0.glb',sha256:c.createHash('sha256').update(b).digest('hex'),bytes:b.length,heightMetres:rep.heightMetres,triangles:rep.triangles,clips:rep.clips});
fs.writeFileSync('$S/stage0/asset.json',JSON.stringify(a,null,2));console.log('staged',a.sha256.slice(0,12),rep.heightMetres)"
src=$S/stage0
if [ "$spear" = "spear" ]; then
  REMAKE_KEY=$key REMAKE_SOURCE_DIR=$src REMAKE_OUT=$S/spear node scripts/remake/build_spear_thrust_one.mjs r1 2>&1 | tail -1
  src=$S/spear/r1/$key
fi
REMAKE_KEY=$key REMAKE_SOURCE_DIR=$src REMAKE_OUT=$S/downed node scripts/remake/build_downed_one.mjs 2>&1 | tail -1
mkdir -p $S/stage2 && cp $S/downed/$key/model-downed-r01.glb $S/stage2/model.glb && cp $S/downed/$key/asset.json $S/stage2/asset.json
REMAKE_KEY=$key REMAKE_SOURCE_DIR=$S/stage2 REMAKE_OUT=$S/loco node scripts/remake/build_locomotion_one.mjs r1 2>&1 | grep -v "^    at " | tail -1
if [ -n "$RETARGET_ATTACK_FROM" ]; then
  # Characters whose Attack is not the spear thrust (the cat kunoichi's katana slash): retarget the delivered clip.
  L=$S/loco/r1/$key; cp $L/model.glb $L/model-no-attack.glb
  "$B" -b --python scripts/remake/retarget_clip.py -- "$RETARGET_ATTACK_FROM" "$(cd $L && pwd -W)/model-no-attack.glb" "$(cd $L && pwd -W)/model.glb" --clips Attack --report "$(cd $S && pwd -W)/retarget-attack.json" 2>&1 | grep -E "RETARGET_DONE|Error|Traceback" | cut -c1-80
  node -e "
const fs=require('fs'),c=require('crypto');const f='$L/asset.json';const a=JSON.parse(fs.readFileSync(f,'utf8'));const b=fs.readFileSync('$L/model.glb');
const j=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)));const at=j.animations.find(x=>x.name==='Attack');
const sec=Math.max(...at.samplers.map(s=>j.accessors[s.input].max[0]));
a.clips=a.clips.filter(x=>x.name!=='Attack');a.clips.unshift({name:'Attack',seconds:sec,loop:false,description:'Retargeted from the delivered C1 clip (scripts/remake/retarget_clip.py).'});
a.sha256=c.createHash('sha256').update(b).digest('hex');a.bytes=b.length;fs.writeFileSync(f,JSON.stringify(a,null,2));console.log('attack',sec)"
fi
"$B" -b --python scripts/build-performance-lods.py -- "$(pwd -W)/$S/loco/r1/$key/model.glb" "$(pwd -W)/$S/lod-performance.glb" 0.2 2>&1 | grep -iE "error|traceback"
ls $S/loco/r1/$key/
