import {readFile,writeFile,copyFile,mkdir,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const model='output/model-generation/models/giant-ape',revision='12',candidate=`${model}/work/rig/revision-${revision}/candidate.glb`;
const json=async p=>JSON.parse(await readFile(p,'utf8')),save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n'),hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await json('output/giant-ape/candidate-asset.json'),numeric=await json(`${model}/work/rig/revision-${revision}/qa/numeric.json`),render=await json(`${model}/work/rig/revision-${revision}/qa/render-manifest.json`);
const bytes=await readFile(candidate),sha=hash(bytes);assert.equal(sha,manifest.sha256);assert.equal(numeric.sha256,sha);assert.equal(numeric.numericPass,true);assert.equal(render.sha256,sha);assert.equal(render.clips.length,12);assert.equal(render.videos,true);
for(const c of render.clips){assert.equal(c.views.length,6);await readFile(`${model}/work/rig/revision-${revision}/qa/${c.clip}.mp4`)}
assert.match(await readFile('output/giant-ape/tests-final.log','utf8'),/pass 369/);assert.match(await readFile('output/giant-ape/tests-final.log','utf8'),/fail 0/);
const game=[];
for(const slot of ['a','b']){
 const reports=await Promise.all(['ground','riding'].map(stage=>json(`output/giant-ape/game-qa/${slot}-${stage}.json`)));
 const actors=reports.flatMap(r=>r.samples.flatMap(s=>s.actors.filter(a=>a.name==='Ape A'))),clips=[...new Set(actors.map(a=>a.clip))];
 for(const clip of ['Idle_Loop','Walk_Loop','Run_Loop','Jump','Attack','Wave','Ride_Idle','Ride_Move'])assert.ok(clips.includes(clip),slot+' missing '+clip);
 for(const r of reports)assert.equal(r.errors.length,0);
 assert.ok(actors.every(a=>a.hash===sha));
 game.push({slot,samples:reports.reduce((n,r)=>n+r.samples.length,0),clips,maximumDisplayedPlayers:Math.max(...reports.flatMap(r=>r.samples.map(s=>s.actors.length))),errors:0});
}
const notes=['User selected image candidate 4 and the name 巨腕の大猿. Candidate 1, local TRELLIS-2 1024 seed 42, measured source-preserving reduction; original and all revisions retained.',
 '2 m red-furred broad biped; 106357 triangles. Original source roughness restored with non-metallic fur/hide, base-color JPEG PSNR 43.34 dB; geometry and other buffers retained during packing.',
 'Source-specific skin and 12 clips. All 360 frames reviewed as 6-direction/5-time contact sheets, selected full-size views and real-browser playback; 12 video files generated. Independent 60 Hz full-skin validation passed.',
 'Existing 0.78 m mage used unchanged for a measured lap comparison. This is a size fixture, not a networked lap-sitting feature.',
 'Actual two-screen/three-socket-peer game QA: five players, walking/running, jump, strike, wave, riding and dismount. Profiles, keyboard sequence and mammoth proximity/wait are fixtures. Physical devices, long-duration load, and all-terrain mesh contact are not verified.'];
const review={decision:'adopt',candidate:1,revision,sha256:sha,candidateFile:`work/rig/revision-${revision}/candidate.glb`,visualGate:'passed',browserGate:'passed',portraitRender:`work/rig/revision-${revision}/qa/Idle_Loop-front-00.png`,notes,game,lapComparison:'output/giant-ape/lap-comparison.png',numeric:'assets/giant-ape/numeric.json'};
await mkdir(`${model}/geometry`,{recursive:true});await mkdir(`${model}/qa`,{recursive:true});
await copyFile(candidate,`${model}/geometry/accepted.glb`);
assert.equal(hash(await readFile('public/models/giant-ape/model.glb')),sha);
manifest.status='locally-integrated-and-game-qa-passed';manifest.notes=notes;
await save('public/models/giant-ape/asset.json',manifest);await save(`${model}/qa/adoption-review.json`,review);await save('assets/giant-ape/adoption-review.json',review);await save('assets/giant-ape/numeric.json',numeric);await save('assets/giant-ape/render-manifest.json',render);
const catalog=await json('assets/world-models.json');assert.ok(!catalog.assets.some(a=>a.key==='giant-ape'));
catalog.assets.push({key:'giant-ape',name:manifest.name,kind:'humanoid',height:2,status:'locally-integrated-and-game-qa-passed',geometryResolution:1024,sha256:sha,delivery:manifest.url,gameQA:'assets/giant-ape/adoption-review.json',subject:'Large red-furred ape with broad shoulders, round belly, massive arms and hands, hide loincloth and rawhide wrist wraps; approved image candidate 4.'});await save('assets/world-models.json',catalog);
await save(`${model}/model.json`,{key:'giant-ape',name:manifest.name,candidate:1,revision,lifecycle_status:'locally-integrated-and-game-qa-passed',sha256:sha,heightMetres:2,geometryResolution:1024,provider:'Codex',claudeUsed:false});
const request=await json('assets/giant-ape/request.json');Object.assign(request,{generation:'completed-local-trellis2',rig:'completed-12-clips',adoption:'revision-12-adopted',gameQa:'two-browser-five-player-verified',sha256:sha,lapInteraction:'size-comparison-only',publicDeployment:false});await save('assets/giant-ape/request.json',request);
const delivery=[];
for(const entry of await readdir('public/models',{withFileTypes:true})){
 if(!entry.isDirectory())continue;let asset;try{asset=await json(`public/models/${entry.name}/asset.json`)}catch(e){if(e.code==='ENOENT')continue;throw e}
 for(const item of [asset,...(asset.lods||[])]){assert.match(item.url,/^\/models\/[a-z0-9-]+\/[a-z0-9-]+\.glb$/);const b=await readFile('public'+item.url);assert.equal(hash(b),item.sha256);assert.equal(b.length,item.bytes);delivery.push({url:item.url,sha256:item.sha256,bytes:b.length})}
}
await save('assets/giant-ape/delivery-verification.json',{models:delivery.length,records:delivery,historicalLineageLimitation:'Previous motion baseline files are absent on this machine, so verify-motion-delivery cannot compare their old source buffers. Current manifest hashes were verified independently; giant-ape source lineage is preserved in this workspace.'});
console.log(JSON.stringify({sha256:sha,deliveredGLBs:delivery.length,game}));
