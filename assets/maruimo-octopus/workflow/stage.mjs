// Stage a versioned local candidate for real game QA. Adoption is recorded only
// after the separate numerical and browser reviews have passed.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir,copyFile,constants} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import * as THREE from 'three';
import {loadMotion} from '../../../scripts/motion-glb.mjs';
const revision=process.argv[2];assert.match(revision,/^\d{2}$/);
const key='maruimo-octopus',base=`output/model-generation/models/${key}`;
const source=`${base}/work/rig/revision-${revision}/candidate.glb`,destination=`public/models/${key}`;
const hash=b=>createHash('sha256').update(b).digest('hex');
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,data)=>writeFile(p,JSON.stringify(data,null,2)+'\n');
const catalog=await json('assets/world-models.json');
assert.ok(!catalog.assets.some(a=>a.key===key),'Use an explicit revision update after staging');
const inspect=p=>JSON.parse(execFileSync(process.execPath,['scripts/inspect-glb.mjs',p,...(p===source?['--humanoid','--hunting']:[])],{encoding:'utf8'}));
const info=inspect(source),lodSource=`${base}/work/rig/revision-${revision}/lod-aligned.glb`,lodInfo=inspect(lodSource);
assert.equal(info.validation,'passed');assert.equal(lodInfo.validation,'passed');assert.equal(info.animations.length,13);
const gltf=await loadMotion(source),box=new THREE.Box3().setFromObject(gltf.scene,true),size=box.getSize(new THREE.Vector3());
assert.ok(Math.abs(size.y-1.55)<.005);
await mkdir(destination,{recursive:true});
async function retain(from,to){try{await copyFile(from,to,constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;}assert.equal(hash(await readFile(from)),hash(await readFile(to)));}
await retain(source,`${destination}/model-r${revision}.glb`);
await retain(lodSource,`${destination}/lod-r${revision}-aligned.glb`);
await retain(`${base}/qa/final-${revision}/portrait/front.png`,`${destination}/portrait.png`);
const referenceImage='assets/maruimo-octopus/source/reference-v2.png';
const lodBytes=await readFile(lodSource),bytes=await readFile(source);
const manifest={modelKey:key,name:'まるぃも タコ人間',kind:'humanoid',bodyPlan:'octopus',candidate:1,revision,status:'candidate-game-QA',species:'maruimo',gender:'male',
  url:`/models/${key}/model-r${revision}.glb`,sha256:hash(bytes),bytes:bytes.length,triangles:info.triangles,bones:info.skins[0].joints,
  upAxis:'Y',forwardAxis:'+Z',heightMetres:size.y,widthMetres:size.x,placement:{pivot:'ground-centred',min:box.min.toArray(),max:box.max.toArray()},
  clips:info.animations.map(a=>({name:a.name,seconds:a.duration,loop:a.name.endsWith('_Loop')})),
  locomotion:{Walk_Loop:{metresPerSecond:.8,strideMetres:.4,cycleSeconds:.5,dutyFactor:.68,stanceTravelMetres:.272},Run_Loop:{metresPerSecond:2.2,strideMetres:.66,cycleSeconds:.3,dutyFactor:.52,stanceTravelMetres:.3432}},
  octopusMotion:{method:'Source-measured eight-arm travelling wave; planted distal sections and local surface floor projection. Authored fantasy motion.',upperArmSegments:20,grip:'Grip.R',attackImpactSeconds:.4},
  lods:[{url:`/models/${key}/lod-r${revision}-aligned.glb`,sha256:hash(lodBytes),bytes:lodBytes.length,triangles:lodInfo.triangles,distanceMetres:28,purpose:'animated-medium-lod-geometry'}],
  provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen',referenceImage,referenceSha256:hash(await readFile(referenceImage)),
    userReference:'assets/maruimo-octopus/source/user-reference.png',userReferenceSha256:hash(await readFile('assets/maruimo-octopus/source/user-reference.png')),
    reconstruction:'Local TRELLIS-2 v0.8.1; retained dense mesh, source-preserving reduction, source-measured octopus rig.',candidateFile:source,visualReview:'assets/maruimo-octopus/adoption.json'},
  notes:['The side-reaching appendage is interpreted as the right arm. The back is inferred from the supplied single image.','Original visible geometry, UVs and texture retained through rigging; no primitive-built substitute.']};
await save(`${destination}/asset.json`,manifest);
catalog.assets.push({key,name:manifest.name,kind:'humanoid',height:1.55,geometryResolution:1024,referenceVersion:2,status:'candidate-game-QA',sha256:manifest.sha256,delivery:manifest.url,
  subject:'Friendly octopus-human with brown hair, round glasses, cable knit sweater, red lower arms, cream suction cups and a long flexible right tentacle.'});
await save('assets/world-models.json',catalog);
await save(`${base}/qa/staging-inspection.json`,info);
console.log(JSON.stringify({revision,sha256:manifest.sha256,triangles:info.triangles,lodTriangles:lodInfo.triangles,bones:manifest.bones,status:manifest.status}));
