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
const oldMeshes=[],newMeshes=[];
prior.scene.traverse(m=>{if(m.isSkinnedMesh)oldMeshes.push(m);});current.scene.traverse(m=>{if(m.isSkinnedMesh)newMeshes.push(m);});
assert.equal(oldMeshes.length,newMeshes.length);
const uvKey=(uv,i)=>uv?`${uv.getX(i)},${uv.getY(i)}`:'none';
function topology(mesh){const g=mesh.geometry,uv=g.attributes.uv,si=g.attributes.skinIndex,sw=g.attributes.skinWeight,keys=[];
  for(let i=0;i<g.index.count;i+=3){const a=[0,1,2].map(k=>uvKey(uv,g.index.getX(i+k)));keys.push([a.join(';'),[a[1],a[2],a[0]].join(';'),[a[2],a[0],a[1]].join(';')].sort()[0]);}
  const weights=[];
  for(let i=0;i<g.attributes.position.count;i++){
    const a=[0,1,2,3].map(k=>[si.getComponent(i,k),sw.getComponent(i,k)]).filter(a=>a[1]>0).sort((a,b)=>a[0]-b[0]);
    weights.push(uvKey(uv,i)+'|'+JSON.stringify(a));
  }
  return {triangles:sha(keys.sort().join('\n')),weights:sha(weights.sort().join('\n'))};
}
let triangles=0,vertices=0;
for(let i=0;i<oldMeshes.length;i++){
  assert.deepEqual(topology(oldMeshes[i]),topology(newMeshes[i]),'UV triangle winding/connectivity and per-UV skin influence multiset');
  assert.equal(oldMeshes[i].geometry.attributes.position.count,newMeshes[i].geometry.attributes.position.count);
  assert.deepEqual(oldMeshes[i].skeleton.bones.map(b=>b.name),newMeshes[i].skeleton.bones.map(b=>b.name));
  vertices+=newMeshes[i].geometry.attributes.position.count;triangles+=newMeshes[i].geometry.index.count/3;
}
function images(g){return g.doc.images.map(im=>{const v=g.doc.bufferViews[im.bufferView];return sha(g.binary.subarray(v.byteOffset??0,(v.byteOffset??0)+v.byteLength));});}
assert.deepEqual(images(prior),images(current));
function probe(at){const target=new THREE.Vector3(at[0],at[2],-at[1]);let best={distance:Infinity};const tri=new THREE.Triangle(),near=new THREE.Vector3(),bary=new THREE.Vector3();
  oldMeshes.forEach((m,mesh)=>{const p=m.geometry.attributes.position,index=m.geometry.index;for(let i=0;i<index.count;i+=3){
    const ids=[index.getX(i),index.getX(i+1),index.getX(i+2)];
    [tri.a,tri.b,tri.c].forEach((v,k)=>m.localToWorld(v.fromBufferAttribute(p,ids[k])));
    tri.closestPointToPoint(target,near);const d=near.distanceTo(target);
    if(d<best.distance){tri.getBarycoord(near,bary);best={mesh,ids,distance:d,bary:bary.toArray()};}
  }});
  assert.ok(best.distance<1e-5,`Surface probe distance ${best.distance}`);
  best.newIds=best.ids.map(index=>{const key=uvKey(oldMeshes[best.mesh].geometry.attributes.uv,index),uv=newMeshes[best.mesh].geometry.attributes.uv;
    const indices=[];for(let i=0;i<uv.count;i++)if(uvKey(uv,i)===key)indices.push(i);assert.ok(indices.length);
    const p=newMeshes[best.mesh].geometry.attributes.position,first=new THREE.Vector3().fromBufferAttribute(p,indices[0]);
    assert.ok(indices.every(i=>new THREE.Vector3().fromBufferAttribute(p,i).distanceTo(first)<1e-6));return indices[0];});
  return best;
}
const probes={left:probe(measured.eyeImageLeft.at),right:probe(measured.eyeImageRight.at),nose:probe(marks.nose.at)};
function point(meshes,p,skinned){const m=meshes[p.mesh],v=new THREE.Vector3(),out=new THREE.Vector3(),indices=meshes===oldMeshes?p.ids:p.newIds;for(let i=0;i<3;i++){if(skinned)m.getVertexPosition(indices[i],v);else v.fromBufferAttribute(m.geometry.attributes.position,indices[i]);out.addScaledVector(v,p.bary[i]);}return m.localToWorld(out);}
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
  triangleConnectivityUvJointsWeightsRetained:true,exportedVertexOrderChanged:true,imageBytesRetained:true,images:images(current),oldFace,newFace,tailRest,idle,
  correction:processRecord.straightening,scope:'Rest shape intentionally changes. Actual exported eye vertices and tail bones demonstrate forward/centred alignment; 180 idle poses measure absence of a constant lateral bias. UVs, topology, weights and embedded image bytes are unchanged.'};
await mkdir(`${base}/qa/rig-${revision}`,{recursive:true});await writeFile(`${base}/qa/rig-${revision}/straightening.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
