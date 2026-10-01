// Assemble an auditable adoption record from the actual delivery and QA files.
import assert from 'node:assert/strict';
import {readFile,writeFile,copyFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const assets='assets/maruimo-octopus',base='output/model-generation/models/maruimo-octopus';
const json=async p=>JSON.parse(await readFile(p,'utf8'));
const save=(p,v)=>writeFile(p,JSON.stringify(v,null,2)+'\n');
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifest=await json('public/models/maruimo-octopus/asset.json');
const numeric=await json(`${base}/work/rig/revision-10/qa/numeric.json`);
const petting=await json(`${base}/qa/final-10/runtime-petting.json`);
assert.equal(numeric.sha256,manifest.sha256);assert.ok(numeric.numericPass&&petting.pass);
for(const r of [manifest,...manifest.lods]){
  const path='public'+r.url,bytes=await readFile(path);
  assert.equal(hash(bytes),r.sha256);assert.equal(bytes.length,r.bytes);
  const inspection=JSON.parse(execFileSync(process.execPath,['scripts/inspect-glb.mjs',path,...(r===manifest?['--humanoid','--hunting']:[])],{encoding:'utf8'}));
  assert.equal(inspection.validation,'passed');assert.equal(inspection.triangles,r.triangles);
}
for(const [path,sha] of [[manifest.provenance.referenceImage,manifest.provenance.referenceSha256],[manifest.provenance.userReference,manifest.provenance.userReferenceSha256]])assert.equal(hash(await readFile(path)),sha);
assert.match(await readFile(`${base}/qa/game-tests-final.log`,'utf8'),/pass 755/);
assert.match(await readFile(`${base}/qa/final-riding-check.log`,'utf8'),/pass 26/);
await copyFile('output/playwright/maruimo/result.json',`${assets}/game-qa.json`);
await save(`${assets}/validation.json`,{
  modelKey:manifest.modelKey,revision:manifest.revision,sha256:manifest.sha256,
  exactDeliveryHashes:'passed',numeric:{...numeric,file:`${base}/work/rig/revision-10/candidate.glb`},
  runtimePetting:{poses:petting.poses,minimumY:Math.min(...petting.records.map(r=>r.minimumY)),maximumFullWeightGap:Math.max(...petting.records.filter(r=>r.weight===1).map(r=>r.gap))},
  checks:{fullTests:755,finalRidingTests:26,typecheck:'passed including strict',syntax:401,architecture:'passed',diffCheck:'passed'},
  browser:'game-qa.json',limitations:[
    'Full historical asset audit stops at the pre-existing missing neanderthal-hunter original reference.',
    'No reliable sustained foreground FPS or mobile viewport measurement in this browser session.',
    'Standalone file:// viewer launch was blocked by the browser tool protocol policy; HTTP runtime was verified.',
    'Physical controllers, real hand input and long-duration operation were not tested.'
  ]
});
await save(`${assets}/revision-history.json`,{candidate:1,adoptedRevision:'10',reconstruction:[
  {attempt:1,result:'rejected',reason:'BiRefNet removed the red octopus flesh along with the background'},
  {attempt:2,result:'failed',reason:'missing tex_flow_1024.gguf; prepared image preserved'},
  {attempt:3,result:'retained',file:'work/trellis/dense-attempt-03-res1024-seed0042.glb',triangles:251466,sha256:'94e72f4fd5d7ed5be13c28b1820468354220c828fd2b273344bf5ef1550ec8fe'}
],revisions:[
  ['01','Initial 65-bone rig; slow first attempt cancelled; initial floor and head-weight failures retained.'],
  ['02','Separate lower-arm floor projection; head deformation remained.'],
  ['03','75 bones and 20 right-arm segments; nonuniform scaling produced shear, rejected.'],
  ['04','Removed segment scaling; stance translation worked but mantle seam stretched.'],
  ['05','Arc-length right-arm curve; Gather IK branch flips crossed the floor between keys.'],
  ['06','Blended local quaternions for strike/gather; mantle and sleeve seams still failed.'],
  ['07','Texture-based skin partition introduced weight discontinuities; rejected.'],
  ['08','Continuous spatial weights fixed body/arm discontinuities; mantle still exceeded edge-stretch limit.'],
  ['09','Broader fixed mantle region; remaining sleeve overlap isolated.'],
  ['10','Sleeve excluded from lower mantle weights; 120Hz surface QA and visual review passed.']
].map(([revision,reason])=>({revision,reason})),lod:[
  {revision:'01',decision:'rejected',reason:'Generic Blender import/export altered bone axes and inverse binds'},
  {revision:'02',decision:'rejected',reason:'Cleared animation poses but bind basis still differed'},
  {revision:'03',decision:'adopted',reason:'Exact original node transforms, joint hierarchy and inverse binds restored; reduced skin passed shadow/animation tests'}
]});
await save(`${assets}/adoption.json`,{
  modelKey:manifest.modelKey,candidate:1,revision:'10',decision:'adopt',sha256:manifest.sha256,
  visualGate:'passed',browserGate:'passed with limitations in validation.json',reviewer:'Codex',
  source:`${base}/work/rig/revision-10/candidate.glb`,
  staticReview:'Seven normal and seven clay views of the reimported delivery; brown hair, round glasses, knit torso, red tentacles and cream suckers retained.',
  motionReview:'Thirteen clips inspected at 65 rendered key poses; all vertices tested at 120 Hz. Existing HTTP viewer and game confirmed the delivered skin and actions.',
  numericReport:`${assets}/validation.json`,browserReport:`${assets}/game-qa.json`,
  notes:['The long side appendage is interpreted as the right arm; unseen depth and back are inferred.','One completed candidate; all failed reconstruction and rig attempts retained.','No public or exhibition deployment.']
});
manifest.status='game-integrated';await save('public/models/maruimo-octopus/asset.json',manifest);
const catalog=await json('assets/world-models.json');const spec=catalog.assets.find(a=>a.key===manifest.modelKey);
assert.equal(spec.sha256,manifest.sha256);spec.status='game-integrated';await save('assets/world-models.json',catalog);
console.log(JSON.stringify({status:manifest.status,sha256:manifest.sha256,lodSha256:manifest.lods[0].sha256,poses:numeric.clips.reduce((sum,c)=>sum+c.samples,0)}));
