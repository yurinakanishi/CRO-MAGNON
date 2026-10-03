import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {loadMotion} from './motion-glb.mjs';
const revision=process.argv[2]??'02',base='output/model-generation/models/rimo-neko/candidate-2';
const processRecord=JSON.parse(await readFile(`${base}/work/rig/revision-${revision}/process.json`,'utf8'));
const sourcePath=processRecord.straightening?`${processRecord.bindSource}/candidate.glb`:`${base}/work/low-poly/revision-01/candidate.glb`;
const source=await loadMotion(sourcePath);
const rig=await loadMotion(`${base}/work/rig/revision-${revision}/candidate.glb`);
const sha=b=>createHash('sha256').update(b).digest('hex');
if(!processRecord.straightening)assert.equal(sha(source.bytes),'284095b15d1e08fdfa7a7157ba5806c322e52d280d03a0f0436c8f2311761850');
const v=new THREE.Vector3(),cell=.00002,grid=new Map();
let sourceVertices=0,rigVertices=0,maximumDistance=0,maximumUVError=0,missing=0;
rig.scene.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,uv=m.geometry.attributes.uv;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);const key=[v.x,v.y,v.z].map(n=>Math.floor(n/cell)).join(',');let a=grid.get(key);if(!a)grid.set(key,a=[]);a.push([v.x,v.y,v.z,uv?.getX(i),uv?.getY(i)]);rigVertices++;}
});
source.scene.traverse(m=>{if(!m.isMesh)return;const p=m.geometry.attributes.position,uv=m.geometry.attributes.uv;
  for(let i=0;i<p.count;i++){v.fromBufferAttribute(p,i).applyMatrix4(m.matrixWorld);const [x,y,z]=[v.x,v.y,v.z].map(n=>Math.floor(n/cell));let best=Infinity,bestUV=Infinity;
    for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++)for(let c=-1;c<=1;c++)for(const q of grid.get(`${x+a},${y+b},${z+c}`)??[]){const d=Math.hypot(v.x-q[0],v.y-q[1],v.z-q[2]);best=Math.min(best,d);if(d<.000011)bestUV=Math.min(bestUV,Math.hypot(uv.getX(i)-q[3],uv.getY(i)-q[4]));}
    maximumDistance=Math.max(maximumDistance,best);maximumUVError=Math.max(maximumUVError,bestUV);if(best>.000011)missing++;sourceVertices++;
  }
});
function images(g){return (g.doc.images??[]).map(im=>{const b=g.doc.bufferViews[im.bufferView];return sha(g.binary.subarray(b.byteOffset??0,(b.byteOffset??0)+b.byteLength));});}
const sourceImages=images(source),rigImages=images(rig);
const imageBytesRetained=sourceImages.every(h=>rigImages.includes(h));
const result={source:sourcePath,sourceSha256:sha(source.bytes),sha256:sha(rig.bytes),sourceVertices,rigVertices,maximumDistance,maximumUVError,missing,imageBytesRetained,sourceImages,rigImages,scope:processRecord.straightening?'The user-authorized corrected rest surface is retained exactly in the animated GLB. This is not a claim that positions equal the previously bent model. Original topology/UV/image checks are recorded separately in straightening.json.':'Source surface vertex positions and UV correspondence in the unanimated bind pose. A small source lip seam is split and lined; 1e-5 m coincident welding and normals are allowed.'};
await mkdir(`${base}/qa/rig-${revision}`,{recursive:true});
await writeFile(`${base}/qa/rig-${revision}/preservation.json`,JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result));
assert.equal(missing,0);assert.ok(maximumUVError<1e-5);assert.ok(imageBytesRetained);
