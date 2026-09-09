// Only updates the previously authorized existing model; never creates a model.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const dir='output/desert-mage-magic/revision-06',read=p=>JSON.parse(readFileSync(p,'utf8')),hash=p=>createHash('sha256').update(readFileSync(p)).digest('hex'),save=(p,v)=>writeFileSync(p,JSON.stringify(v,null,2)+'\n');
const pack=read(`${dir}/packaging.json`),qa=read(`${dir}/qa.json`),numeric=read(`${dir}/numeric.json`),recordPath='assets/meshmell/desert-fennec-mage-magic.json',pendingPath='assets/meshmell/desert-fennec-mage-magic-update-r06.json',prior=read(recordPath);
assert.equal(prior.modelId,199);assert.equal(prior.slug,'desert-fennec-mage');assert.equal(qa.visualReview,'passed');assert.equal(numeric.status,'passed');assert.equal(numeric.sha256,pack.sha256);assert.equal(hash(pack.file),pack.sha256);assert.equal(qa.sha256,pack.sha256);assert.equal(hash(qa.cover.path),qa.cover.sha256);
const plan={modelId:199,modelKey:'desert-fennec-mage',slug:'desert-fennec-mage',name:'Desert Fennec Mage',revision:'06',file:pack.file,sha256:pack.sha256,cover:qa.cover.path,coverSHA256:qa.cover.sha256,defaultAnimation:'Magic_Loop',license:'CC-BY-4.0',credit:'Yuri Nakanishi',visibility:'public',description:'An original fennec mage from CRO-MAGNON, with upright ears, a fluffy tail, primitive hide and fur clothing, and bare paws. Created from an original concept image using local TRELLIS-2 reconstruction. The default animation casts a spell in 0.8 seconds and releases it after 0.4 seconds, matching the game. The spell leaves the hands, with a trail that grows along its flight. The 1.6-second display loop includes the spell flight and return to idle. Nine additional game animations are included. Cover photographed from this model in a right-facing pose.',idempotencyKey:`desert-mage-199-parity-${pack.sha256.slice(0,20)}`};
if(!process.argv.includes('--update')){console.log(JSON.stringify({...plan,status:'validated-dry-run'},null,2));process.exit(0);}
const cli=resolve('../meshmell.com/packages/cli/dist/src/bin.js');
function call(args,source=false){const prefix=source?['--import',pathToFileURL(resolve('../meshmell.com/node_modules/tsx/dist/loader.mjs')).href,resolve('scripts/meshmell-cli-source.mjs')]:[cli];try{return JSON.parse(execFileSync(process.execPath,[...prefix,'--json',...args],{env:{...process.env,MESHMELL_CREDENTIAL_STORE:'file'},encoding:'utf8',timeout:600000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','pipe']}));}catch(e){let code='CLI_FAILED';try{const parsed=JSON.parse(String(e.stdout));code=parsed.error?.code??code;}catch{}throw Error(`Official CLI ${args.slice(0,3).join(' ')}: ${code}. Resume with the same recorded idempotency key. No raw credentials or upload URLs were logged.`);}}
const auth=call(['auth','status']);assert.equal(auth.authenticated,true);assert.equal(auth.principal.email,'yurinakanishi@meshmell.com');for(const s of ['models:read','models:write','uploads:write'])assert.ok(auth.principal.scopes.includes(s));
const doctor=call(['doctor']).data;assert.equal(doctor.status,'READY');
const before=call(['models','get','199']).data;assert.equal(before.owner.id,auth.principal.id);assert.equal(before.slug,plan.slug);assert.equal(before.isPublic,true);assert.equal(before.license,plan.license);assert.equal(before.credit,plan.credit);
let pending=existsSync(pendingPath)?read(pendingPath):{...plan,status:'prepared',account:auth.principal.email,preparedAt:new Date().toISOString(),before};assert.equal(pending.sha256,plan.sha256);save(pendingPath,pending);
if(!pending.displayReplaced){
 console.log('Replacing display GLB on existing Meshmell model 199...');
 const updated=call(['models','update','199','--file',resolve(plan.file),'--idempotency-key',`${plan.idempotencyKey}-file`,'--wait-timeout','10m']).data;
 if(updated.status)assert.equal(updated.status,'SUCCEEDED');pending.displayReplaced=true;pending.status='display-replaced';pending.displayReplacedAt=new Date().toISOString();save(pendingPath,pending);
}
const actions=call(['models','actions','list','199'],true).data,magic=actions.find(a=>a.name==='Magic_Loop');assert.ok(magic?.id,'New display must register Magic_Loop');
console.log('Applying English name, right-facing cover and default Magic_Loop...');
const updated=call(['models','update','199','--name',plan.name,'--description',plan.description,'--cover-image',resolve(plan.cover),'--default-action-id',String(magic.id),'--idempotency-key',`${plan.idempotencyKey}-metadata-${plan.coverSHA256.slice(0,10)}`]).data;
pending.status='metadata-updated';save(pendingPath,pending);
const after=call(['models','get','199']).data;assert.equal(after.id,199);assert.equal(after.owner.id,auth.principal.id);for(const key of ['name','slug','description','license','credit'])assert.equal(after[key],plan[key]);assert.equal(after.isPublic,true);assert.equal(after.defaultActionId,magic.id);assert.equal(after.image.id,updated.image.id);assert.notEqual(after.image.id,pending.before.image.id);
for(const key of ['scale','x','y','z','rotationDegreesX','rotationDegreesY','rotationDegreesZ','defaultLightIntensity','defaultCameraDistance','requiresCreditForCommercialUse','requiresCreditForPersonalUse'])assert.equal(after[key],pending.before[key],`Preserve ${key}`);
const downloaded=`${dir}/meshmell-readback.glb`;call(['models','download','199','--output',resolve(downloaded),'--overwrite']);assert.equal(hash(downloaded),plan.sha256);
const finalActions=call(['models','actions','list','199'],true).data;assert.ok(finalActions.some(a=>a.id===magic.id&&a.isDefault));assert.equal(finalActions.length,10);
const now=new Date().toISOString(),record={...plan,status:'verified',account:auth.principal.email,uploadedAt:prior.uploadedAt,updatedAt:now,verifiedAt:now,url:`https://meshmell.com/ja/viewer/models/${plan.slug}`,defaultActionId:magic.id,actions:finalActions,coverImageId:after.image.id,readback:after,downloadSHA256:hash(downloaded),doctorStatus:doctor.status};save(recordPath,record);save(pendingPath,{...pending,status:'verified',verifiedAt:now});
mkdirSync('assets/meshmell/history',{recursive:true});writeFileSync(`assets/meshmell/history/${now.replace(/[-:.]/g,'')}-desert-fennec-mage-parity-update.json`,JSON.stringify({action:'update-existing-model',...record},null,2)+'\n',{flag:'wx'});
qa.upload={status:'verified',service:'Meshmell',method:'official CLI only',modelId:199,url:record.url,visibility:'public',license:record.license,credit:record.credit,name:record.name,defaultActionId:magic.id,defaultAnimation:'Magic_Loop',coverImageId:record.coverImageId,verifiedAt:now,downloadSHA256:record.downloadSHA256,authorization:qa.upload.authorization};
for(const p of ['assets/desert-mage-magic-qa.json','assets/desert-mage-magic-parity-qa.json',`${dir}/qa.json`])save(p,qa);
console.log(JSON.stringify({status:record.status,modelId:199,name:record.name,url:record.url,sha256:record.downloadSHA256,defaultActionId:magic.id,coverImageId:record.coverImageId}));
