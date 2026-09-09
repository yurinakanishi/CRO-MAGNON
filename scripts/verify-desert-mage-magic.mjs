import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const dir=process.argv[2]||'output/desert-mage-magic/revision-01',file=`${dir}/desert-fennec-mage-magic.glb`;
const bytes=await readFile(file),gltf=await geometryScene(file),clip=gltf.animations.find(a=>a.name==='Magic_Loop');assert.ok(clip);assert.equal(gltf.animations.length,10);
const mixer=new THREE.AnimationMixer(gltf.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
const skinned=[];gltf.scene.traverse(n=>{if(n.isSkinnedMesh)skinned.push(n);});const point=new THREE.Vector3(),samples=[];let first,last;
for(let frame=0;frame<=144;frame++){const t=frame/60;mixer.setTime(t);gltf.scene.updateMatrixWorld(true);for(const mesh of skinned)mesh.skeleton.update();const values=[],box=new THREE.Box3();
for(const mesh of skinned)for(let v=0;v<mesh.geometry.attributes.position.count;v++){mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld);assert.ok(point.toArray().every(Number.isFinite));box.expandByPoint(point);if(frame===0||frame===144)values.push(...point.toArray());}
const particles=[];gltf.scene.traverse(n=>{if(n.name.startsWith('Magic_Light_')){assert.ok([...n.position,...n.scale].every(Number.isFinite));particles.push({position:n.position.toArray(),scale:n.scale.toArray()});}});assert.equal(particles.length,19);if(frame===0)first=values;if(frame===144)last=values;
samples.push({seconds:t,bodyMin:box.min.toArray(),bodyMax:box.max.toArray(),activeParticles:particles.filter(p=>p.scale[0]>.001).length});assert.ok(box.min.y>-.006,'Ground clearance');}
const closure=first.reduce((largest,v,i)=>Math.max(largest,Math.abs(v-last[i])),0);assert.ok(closure<1e-5,`Loop seam ${closure}`);assert.equal(samples[0].activeParticles,0);assert.equal(samples.at(-1).activeParticles,0);assert.ok(samples[66].activeParticles>2);
const report={file,sha256:createHash('sha256').update(bytes).digest('hex'),status:'passed',samples:145,hz:60,bodyLoopMaxDelta:closure,allSurfacePositionsFinite:true,minimumGround:Math.min(...samples.map(s=>s.bodyMin[1])),sourceClips:9,displayClips:10,releaseSample:samples[66],keyframes:samples.filter((_,i)=>i%12===0)};await writeFile(`${dir}/numeric.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,keyframes:undefined}));
