// Measure the actual exported face and tail against the previously delivered GLB.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {loadMotion,pose} from './motion-glb.mjs';
const revision=process.argv[2]??'03',base='output/model-generation/models/rimo-neko/candidate-2';
const prior=await loadMotion(`${base}/work/rig/revision-02/candidate.glb`);
const current=await loadMotion(`${base}/work/rig/revision-${revision}/candidate.glb`);
const processRecord=JSON.parse(await readFile(`${base}/work/rig/revision-${revision}/process.json`,'utf8'));
const measured=JSON.parse(await readFile(`${base}/qa/straightening-20261003/measurements.json`,'utf8'));
const marks=JSON.parse(await readFile(`${base}/qa/face-landmarks.json`,'utf8'));
const sha=b=>createHash('sha256').update(b).digest('hex');
function accessor(g,i){const a=g.doc.accessors[i],v=g.doc.bufferViews[a.bufferView];assert.ok(!v.byteStride);return g.binary.subarray((v.byteOffset??0)+(a.byteOffset??0),(v.byteOffset??0)+v.byteLength);}
const before=prior.doc.meshes.flatMap(m=>m.primitives),after=current.doc.meshes.flatMap(m=>m.primitives);
assert.equal(before.length,after.length);
let triangles=0,vertices=0;
for(let i=0;i<before.length;i++){
  const a=before[i],b=after[i];
  assert.deepEqual(accessor(prior,a.indices),accessor(current,b.indices),'Triangle connectivity');
  for(const key of ['TEXCOORD_0','JOINTS_0','WEIGHTS_0']){
    if(a.attributes[key]!==undefined)assert.deepEqual(accessor(prior,a.attributes[key]),accessor(current,b.attributes[key]),key);
  }
  assert.equal(prior.doc.accessors[a.attributes.POSITION].count,current.doc.accessors[b.attributes.POSITION].count);
  vertices+=current.doc.accessors[b.attributes.POSITION].count;triangles+=current.doc.accessors[b.indices].count/3;
}
function images(g){return g.doc.images.map(im=>{const v=g.doc.bufferViews[im.bufferView];return sha(g.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));});}
assert.deepEqual(images(prior),images(current));
const oldMeshes=[],newMeshes=[];
prior.scene.traverse(m=>{if(m.isSkinnedMesh)oldMeshes.push(m);});current.scene.traverse(m=>{if(m.isSkinnedMesh)newMeshes.push(m);});
function probe(at){const target=new THREE.Vector3(at[0],at[2],-at[1]);let best={distance:Infinity};const v=new THREE.Vector3();
  oldMeshes.forEach((m,mesh)=>{for(let i=0;i<m.geometry.attributes.position.count;i++){v.fromBufferAttribute(m.geometry.attributes.position,i);m.localToWorld(v);const d=v.distanceTo(target);if(d<best.distance)best={mesh,index:i,distance:d};}});
  assert.ok(best.distance<.002);return best;
}
const probes={left:probe(measured.eyeImageLeft.at),right:probe(measured.eyeImageRight.at),nose:probe(marks.nose.at)};
function point(meshes,p,skinned){const m=meshes[p.mesh],v=new THREE.Vector3();if(skinned)m.getVertexPosition(p.index,v);else v.fromBufferAttribute(m.geometry.attributes.position,p.index);return m.localToWorld(v);}
function face(meshes,skinned=false){const left=point(meshes,probes.left,skinned),right=point(meshes,probes.right,skinned),nose=point(meshes,probes.nose,skinned),line=right.clone().sub(left);return {yawDegrees:THREE.MathUtils.radToDeg(Math.atan2(line.z,line.x)),eyeSpan:line.length(),eyeMidX:(left.x+right.x)/2,noseX:nose.x};}
const oldFace=face(oldMeshes),newFace=face(newMeshes);
assert.ok(Math.abs(newFace.yawDegrees)<1,'Face looks forward');assert.ok(Math.abs(newFace.eyeMidX)<.002,'Face centred');
assert.ok(Math.abs(newFace.noseX)<.008,'Nose on centreline');assert.ok(Math.abs(newFace.eyeSpan-oldFace.eyeSpan)<1e-6,'Face retains its width');
const tailNames=['Tail1','Tail2','Tail3','Tail4','Tail5'];
const tailRest=tailNames.map(name=>({name,oldX:prior.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).x,newX:current.scene.getObjectByName(name).getWorldPosition(new THREE.Vector3()).x}));
assert.ok(tailRest.every(r=>Math.abs(r.newX)<1e-6),'Tail rest chain centred');
const samples=[];
for(let i=0;i<180;i++){
  const mixer=pose(current,current.animations.find(c=>c.name==='Idle_Loop'),i/60);
  samples.push({...face(newMeshes,true),tailX:current.scene.getObjectByName('Tail5').getWorldPosition(new THREE.Vector3()).x});
  mixer.stopAllAction();mixer.uncacheRoot(current.scene);
}
const mean=k=>samples.reduce((s,v)=>s+v[k],0)/samples.length;
const idle={samples:samples.length,meanYawDegrees:mean('yawDegrees'),yawRangeDegrees:[Math.min(...samples.map(v=>v.yawDegrees)),Math.max(...samples.map(v=>v.yawDegrees))],meanTailX:mean('tailX'),tailRange:[Math.min(...samples.map(v=>v.tailX)),Math.max(...samples.map(v=>v.tailX))]};
assert.ok(Math.abs(idle.meanYawDegrees)<1);assert.ok(Math.abs(idle.meanTailX)<.001);
const result={status:'passed',candidate:2,revision,sha256:sha(current.bytes),previousSha256:sha(prior.bytes),vertices,triangles,
  triangleConnectivityUvJointsWeightsByteIdentical:true,imageBytesRetained:true,images:images(current),oldFace,newFace,tailRest,idle,
  correction:processRecord.straightening,scope:'Rest shape intentionally changes. Actual exported eye vertices and tail bones demonstrate forward/centred alignment; 180 idle poses measure absence of a constant lateral bias. UVs, topology, weights and embedded image bytes are unchanged.'};
await mkdir(`${base}/qa/rig-${revision}`,{recursive:true});await writeFile(`${base}/qa/rig-${revision}/straightening.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
