import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const root=resolve('.'),dir='output/desert-mage-magic/revision-01',read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex');
const packageInfo=read(`${dir}/packaging.json`),numeric=read(`${dir}/numeric.json`),qa=read('assets/desert-mage-magic-qa.json');
const file=`${dir}/desert-fennec-mage-magic.glb`,cover=`${dir}/light-release-cover.jpg`,recordPath='assets/meshmell/desert-fennec-mage-magic.json';
assert.equal(hash(file),packageInfo.sha256);assert.equal(numeric.sha256,packageInfo.sha256);assert.equal(numeric.status,'passed');assert.equal(qa.visualReview,'passed');assert.equal(qa.cover.sha256,hash(cover));
const visibility=process.argv.find(a=>a.startsWith('--visibility='))?.split('=')[1];
const plan={modelKey:'desert-fennec-mage',slug:'desert-fennec-mage',name:'砂耳の魔法使い — 光の魔法',file,sha256:packageInfo.sha256,cover,coverSHA256:hash(cover),license:'CC-BY-4.0',credit:'Yuri Nakanishi',defaultAnimation:'Magic_Loop',description:'Original sandy fennec mage created for CRO-MAGNON from an original concept image and local TRELLIS-2 reconstruction. Primitive hide and fur clothing, bare paws, upright ears and a tail. Magic_Loop is the default 2.4-second animation: charge light in the hands and release a glowing orb. The GLB embeds 19 animated light sprites, plus the nine preserved game animations. Cover photographed from this exact GLB at 1.10 seconds. No custom game shader is required for the light sprites.',visibility:visibility??'awaiting-user-choice'};
if(!process.argv.includes('--upload')){console.log(JSON.stringify(plan,null,2));process.exit(0);}
assert.ok(['public','private'].includes(visibility),'Explicit user-selected --visibility=public|private is required');
const cli=resolve('../meshmell.com/packages/cli/dist/src/bin.js');
function call(args,source=false){const prefix=source?['--import',pathToFileURL(resolve('../meshmell.com/node_modules/tsx/dist/loader.mjs')).href,resolve('scripts/meshmell-cli-source.mjs')]:[cli];try{return JSON.parse(execFileSync(process.execPath,[...prefix,'--json',...args],{env:{...process.env,MESHMELL_CREDENTIAL_STORE:'file'},encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){let code='CLI_FAILED';try{code=JSON.parse(String(e.stdout)).error?.code??code;}catch{}throw Error(`Official CLI ${args.slice(0,3).join(' ')}: ${code}; retry with the same recorded idempotency key only.`);}}
const auth=call(['auth','status']);assert.equal(auth.authenticated,true);assert.equal(auth.principal.email,'yurinakanishi@meshmell.com');for(const s of ['models:read','models:write','uploads:write'])assert.ok(auth.principal.scopes.includes(s));
const doctor=call(['doctor']).data;assert.equal(doctor.status,'READY');
const prior=existsSync(recordPath)?read(recordPath):null;
const found=call(['models','list','--query',plan.slug,'--limit','100']);assert.equal(found.meta.hasMore,false);const existing=found.data.find(m=>m.slug===plan.slug);
assert.ok(!existing||(prior?.modelId===existing.id&&existing.owner.id===auth.principal.id),'Unexpected existing slug: inspect ownership and recorded model before replacing');
mkdirSync('assets/meshmell/history',{recursive:true});
const key=`desert-mage-magic-${plan.sha256.slice(0,20)}`;let record=prior??{...plan,idempotencyKey:key,account:auth.principal.email,status:'prepared'};
const save=()=>writeFileSync(recordPath,JSON.stringify(record,null,2)+'\n');
save();
if(!record.modelId){
 console.log('Uploading display GLB into a private staging model...');
 const response=call(['models','upload',resolve(file),'--name',plan.name,'--slug',plan.slug,'--license',plan.license,'--credit',plan.credit,'--description',plan.description,'--idempotency-key',key,'--wait-timeout','10m']);
 const operation=response.data;if(operation.status)assert.equal(operation.status,'SUCCEEDED');record.modelId=operation.result?.resourceId??operation.id;assert.ok(Number.isInteger(record.modelId)&&record.modelId>0);record.status='uploaded-private-awaiting-default-action';record.uploadedAt=new Date().toISOString();save();
}
const id=String(record.modelId),remote=call(['models','get',id]).data;assert.equal(remote.owner.id,auth.principal.id);assert.equal(remote.slug,plan.slug);
let actions=call(['models','actions','list',id]).data;if(!actions.some(a=>a.name==='Magic_Loop'))actions=call(['models','actions','list',id],true).data;
const selected=actions.find(a=>a.name==='Magic_Loop');record.actions=actions;save();assert.ok(selected?.id,'Magic_Loop was not registered by Meshmell; do not publish an incomplete model');
console.log(`Setting default action, photographed cover and ${visibility} visibility on model ${id}...`);
const update=call(['models','update',id,'--default-action-id',String(selected.id),'--cover-image',resolve(cover),'--default-camera-distance','2.2','--default-light-intensity','2','--scale','1','--rotation-y','0','--requires-credit-for-commercial-use','true','--requires-credit-for-personal-use','true',visibility==='public'?'--public':'--private','--idempotency-key',`${key}-metadata-${visibility}-${plan.coverSHA256.slice(0,10)}`]);
const after=call(['models','get',id]).data;assert.equal(after.defaultActionId,selected.id);assert.equal(after.isPublic,visibility==='public');assert.equal(after.image.id,update.data.image.id);for(const k of ['name','slug','description','license','credit'])assert.equal(after[k],plan[k]);
const downloaded=`${dir}/meshmell-readback.glb`;call(['models','download',id,'--output',resolve(downloaded),'--overwrite']);assert.equal(hash(downloaded),plan.sha256);
const finalActions=call(['models','actions','list',id],true).data;assert.ok(finalActions.some(a=>a.id===selected.id&&a.isDefault));
record={...record,visibility,status:'verified',verifiedAt:new Date().toISOString(),url:`https://meshmell.com/ja/viewer/models/${plan.slug}`,defaultActionId:selected.id,actions:finalActions,coverImageId:after.image.id,readback:after,downloadSHA256:hash(downloaded),doctorStatus:doctor.status};save();
writeFileSync(`assets/meshmell/history/${record.verifiedAt.replace(/[-:.]/g,'')}-desert-fennec-mage-magic-upload.json`,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({modelId:record.modelId,url:record.url,visibility:record.visibility,defaultAnimation:'Magic_Loop',coverImageId:record.coverImageId,sha256:record.downloadSHA256,status:record.status}));
