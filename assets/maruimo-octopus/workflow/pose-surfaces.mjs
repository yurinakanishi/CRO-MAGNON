// Evaluate the delivered surface after the game applies its procedural petting pose.
import assert from 'node:assert/strict';
import {writeFile,mkdir} from 'node:fs/promises';
import * as T from 'three';
import {loadMotion} from '../../../scripts/motion-glb.mjs';
import {OctopusPettingPose} from '../../../dist/src/octopus-pose.js';
const revision=process.argv[2],base=`output/model-generation/models/maruimo-octopus`;
const gltf=await loadMotion(`${base}/work/rig/revision-${revision}/candidate.glb`);
const mixer=new T.AnimationMixer(gltf.scene),action=mixer.clipAction(gltf.animations.find(c=>c.name==='Idle_Loop')).play();
const pose=new OctopusPettingPose(gltf.scene),meshes=[];
gltf.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
const point=new T.Vector3(),inverse=new T.Matrix4();const records=[];
for(const height of [.45,.75])for(const weight of [.3,.65,1])for(const stroke of [0,.25,.5,.75,1]){
  pose.restore();action.time=stroke*1.6;mixer.update(0);gltf.scene.updateMatrixWorld(true);
  pose.update(new T.Vector3(-.12,height,1),weight,stroke);
  gltf.scene.updateMatrixWorld(true);inverse.copy(gltf.scene.matrixWorld).invert();
  let low=Infinity,high=-Infinity,vertices=0;
  for(const mesh of meshes){mesh.skeleton.update();
    for(let i=0;i<mesh.geometry.attributes.position.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
      assert.ok(point.toArray().every(Number.isFinite));low=Math.min(low,point.y);high=Math.max(high,point.y);vertices++;
    }
  }
  const gap=pose.contact.distanceTo(pose.requested);assert.ok(low>=-.003,`petting floor ${low}`);
  if(weight===1)assert.ok(gap<.015,`petting gap ${gap}`);
  records.push({height,weight,stroke,vertices,minimumY:low,maximumY:high,gap});
}
const out=`${base}/qa/final-${revision}/runtime-petting.json`;await mkdir(`${base}/qa/final-${revision}`,{recursive:true});
await writeFile(out,JSON.stringify({pass:true,poses:records.length,records},null,2)+'\n');
console.log(JSON.stringify({pass:true,poses:records.length,minimumY:Math.min(...records.map(r=>r.minimumY)),maximumFullWeightGap:Math.max(...records.filter(r=>r.weight===1).map(r=>r.gap))}));
