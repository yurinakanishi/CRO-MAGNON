import * as T from 'three';
import {readFile} from 'node:fs/promises';
import {loadMotion} from '../../../scripts/motion-glb.mjs';
import {configureActorPerformance} from '../../../dist/src/performance-lod.js';
const asset=JSON.parse(await readFile('public/models/maruimo-octopus/asset.json','utf8'));
const high=await loadMotion('public'+asset.url),low=await loadMotion('public'+asset.lods[0].url);
const detail=configureActorPerformance(high.scene,low.scene,asset), hm=new T.AnimationMixer(high.scene),lm=new T.AnimationMixer(low.scene);
const meshes=[];low.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});
const h=detail.meshes[0].mesh,l=meshes[0],maxdiff=(a,b)=>Math.max(...a.elements.map((v,i)=>Math.abs(v-b.elements[i])));
const compare=()=>h.skeleton.bones.map((b,i)=>({name:b.name,world:maxdiff(b.matrixWorld,l.skeleton.bones[i].matrixWorld),inverse:maxdiff(h.skeleton.boneInverses[i],l.skeleton.boneInverses[i])})).filter(d=>d.world>1e-6||d.inverse>1e-6);
high.scene.updateMatrixWorld(true);low.scene.updateMatrixWorld(true);console.log('REST',JSON.stringify(compare()));
hm.clipAction(high.animations.find(c=>c.name==='Attack')).play();lm.clipAction(high.animations.find(c=>c.name==='Attack')).play();hm.update(0);lm.update(0);
high.scene.updateMatrixWorld(true);low.scene.updateMatrixWorld(true);h.skeleton.update();l.skeleton.update();console.log('POSE',JSON.stringify(compare()));
const a=new T.Vector3(),b=new T.Vector3();let worst=0,index=-1,above=0;
for(let i=0;i<l.geometry.attributes.position.count;i++){detail.meshes[0].shadow.getVertexPosition(i,a);l.getVertexPosition(i,b);const d=a.distanceTo(b);if(d>worst){worst=d;index=i;}if(d>1e-4)above++;}
console.log(JSON.stringify({worst,index,above,highBind:h.bindMatrix.elements,lowBind:l.bindMatrix.elements,highInverse:h.bindMatrixInverse.elements,lowInverse:l.bindMatrixInverse.elements}));
