import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
import {sampleGameMagic} from './sample-desert-game-magic.mjs';
const directory=process.argv[2]||'output/desert-mage-magic/revision-06';
const pack=JSON.parse(await readFile(`${directory}/packaging.json`,'utf8')),file=pack.file;
const reference=pack.referenceCamera,cameraPosition=reference?new THREE.Vector3(...reference.position):null,cameraForward=reference?new THREE.Vector3(...reference.target).sub(cameraPosition).normalize():null;
const renderedRadius=p=>reference?Math.min(p.size,reference.maxPointPixels*Math.max(.2,new THREE.Vector3(...p.position).sub(cameraPosition).dot(cameraForward))/(reference.height/Math.tan(reference.fov*Math.PI/360))):p.size;
const actual=await geometryScene(file),game=await sampleGameMagic(pack.source),mixer=new THREE.AnimationMixer(actual.scene),clip=actual.animations.find(a=>a.name==='Magic_Loop');
const action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
let maxBoneDelta=0,maxParticlePositionDelta=0,maxParticleSizeDelta=0,minimumGround=Infinity,firstVertices,lastVertices;const perFrame=[];
const meshes=[];actual.scene.traverse(n=>{if(n.isSkinnedMesh)meshes.push(n);});const point=new THREE.Vector3();
for(let i=0;i<game.snapshots.length;i++){
 const expected=game.snapshots[i],seconds=expected.seconds,last=i===game.snapshots.length-1;mixer.setTime(Math.fround(seconds));actual.scene.updateMatrixWorld(true);for(const mesh of meshes)mesh.skeleton.update();
 if(seconds<=1.5)for(const[name,pose]of Object.entries(expected.pose)){const node=actual.scene.getObjectByName(name);for(const[path,actualValues]of[['translation',node.position.toArray()],['rotation',node.quaternion.toArray()],['scale',node.scale.toArray()]])for(let k=0;k<actualValues.length;k++)maxBoneDelta=Math.max(maxBoneDelta,Math.abs(actualValues[k]-pose[path][k]));}
 const particles=last?game.snapshots[0].particles:expected.particles;
 let active=0;
 for(const p of particles){const root=actual.scene.getObjectByName(`Magic_Particle_${String(p.id).padStart(2,'0')}`),visible=root.children.filter(n=>n.scale.x>.5);assert.equal(visible.length,p.alpha>0&&p.size>0?1:0,`Particle visibility ${p.id} @ ${seconds}`);if(!visible.length)continue;active++;for(let k=0;k<3;k++)maxParticlePositionDelta=Math.max(maxParticlePositionDelta,Math.abs(root.position.toArray()[k]-p.position[k]));maxParticleSizeDelta=Math.max(maxParticleSizeDelta,Math.abs(root.scale.x/2-renderedRadius(p)));}
 const vertices=[];for(const mesh of meshes)for(let v=0;v<mesh.geometry.attributes.position.count;v++){mesh.getVertexPosition(v,point).applyMatrix4(mesh.matrixWorld);assert.ok(point.toArray().every(Number.isFinite));minimumGround=Math.min(minimumGround,point.y);if(i===0||last)vertices.push(...point.toArray());}
 if(i===0)firstVertices=vertices;if(last)lastVertices=vertices;
 const orb=actual.scene.getObjectByName('Magic_Particle_14');perFrame.push({seconds,activeParticles:active,orb:orb.position.toArray(),serverProjectile:expected.projectile});
}
const bodyLoopMaxDelta=firstVertices.reduce((m,v,i)=>Math.max(m,Math.abs(v-lastVertices[i])),0);
assert.ok(maxBoneDelta<1e-5);assert.ok(maxParticlePositionDelta<1e-5);assert.ok(maxParticleSizeDelta<1e-5);assert.ok(bodyLoopMaxDelta<1e-5);assert.ok(minimumGround>-.006);
const launch=perFrame.find(f=>Math.abs(f.seconds-.4)<1e-6),emitter=game.snapshots.find(f=>Math.abs(f.seconds-.4)<1e-6).emitter;
assert.equal(launch.activeParticles,1);assert.equal(launch.serverProjectile.travelled,0);
const launchHandDistance=new THREE.Vector3(...launch.orb).distanceTo(new THREE.Vector3(...emitter));assert.ok(launchHandDistance<1e-5);
let minimumTrailForward=Infinity;for(const snapshot of game.snapshots.filter(f=>f.seconds>=.4))for(const p of snapshot.particles.filter(p=>p.id>=14&&p.alpha>0&&p.size>0))minimumTrailForward=Math.min(minimumTrailForward,p.position[2]-emitter[2]);assert.ok(minimumTrailForward>-1e-5,'No particle may start behind the hands');
// Check between keyframes too: zero-filled inactive GPU slots must never
// interpolate a still-visible spark back through the body before switching off.
let subframeMinimumForward=Infinity,chargeMinimumRelativeToHands=Infinity;
action.reset().play();
for(let i=0;i<384;i++){
 const t=i/240;mixer.setTime(t);actual.scene.updateMatrixWorld(true);
 const handZ=Math.min(actual.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.L')).getWorldPosition(new THREE.Vector3()).z,actual.scene.getObjectByName(THREE.PropertyBinding.sanitizeNodeName('Grip.R')).getWorldPosition(new THREE.Vector3()).z);
 for(let id=0;id<24;id++){
  const root=actual.scene.getObjectByName(`Magic_Particle_${String(id).padStart(2,'0')}`);if(!root.children.some(n=>n.scale.x>.5))continue;
  if(id>=14)subframeMinimumForward=Math.min(subframeMinimumForward,root.position.z-emitter[2]);
  else chargeMinimumRelativeToHands=Math.min(chargeMinimumRelativeToHands,root.position.z-handZ);
 }
}
assert.ok(Number.isFinite(subframeMinimumForward)&&subframeMinimumForward>-1e-5);assert.ok(Number.isFinite(chargeMinimumRelativeToHands)&&chargeMinimumRelativeToHands>-.01);
const serverMoving=perFrame.filter(f=>f.serverProjectile);let serverSpeedError=0;for(let i=1;i<serverMoving.length;i++){const a=serverMoving[i-1],b=serverMoving[i];if(Math.abs(b.seconds*20-Math.round(b.seconds*20))<1e-6&&b.serverProjectile.travelled<8)serverSpeedError=Math.max(serverSpeedError,Math.abs((b.serverProjectile.travelled-a.serverProjectile.travelled)/.05-7));}assert.ok(serverSpeedError<1e-5);
const report={status:'passed',file,sha256:createHash('sha256').update(await readFile(file)).digest('hex'),samples:game.snapshots.length,hz:60,bodyMotionComparisonThroughSeconds:1.5,maxBoneDelta,maxParticlePositionDelta,maxParticleSizeDelta,bodyLoopMaxDelta,minimumGround,releaseSeconds:.4,attackSeconds:.8,projectileSpeed:7,serverSpeedError,projectileHeight:.4,subframeSamples:384,subframeHz:240,subframeMinimumForward,chargeMinimumRelativeToHands,launchHandDistance,launchPosition:launch.orb,minimumTrailForward,conditions:game.referenceConditions,visualLimitation:pack.visualLimitation,loopClosure:pack.loopClosure,keyframes:perFrame.filter((_,i)=>i%6===0)};
await writeFile(`${directory}/numeric.json`,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({...report,keyframes:undefined}));
