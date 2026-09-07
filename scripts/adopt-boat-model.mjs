import {readFile,writeFile,mkdir,copyFile} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
const key='dugout-canoe',base='assets/boat/model',source=`${base}/work/revision-02/candidate.glb`;
const json=async p=>JSON.parse(await readFile(p,'utf8')),save=(p,o)=>writeFile(p,JSON.stringify(o,null,2)+'\n'),sha=b=>createHash('sha256').update(b).digest('hex');
const review=await json(`${base}/qa/adoption-review.json`),bytes=await readFile(source);assert.equal(review.decision,'adopt');assert.equal(sha(bytes),review.sha256);
await mkdir(`public/models/${key}`,{recursive:true});
try{await copyFile(source,`public/models/${key}/model.glb`,constants.COPYFILE_EXCL);}catch(e){if(e.code!=='EEXIST')throw e;assert.equal(sha(await readFile(`public/models/${key}/model.glb`)),review.sha256);}
const bounds=(await json(`${base}/qa/revision-02-browser.json`)).bounds[1];
const manifest={modelKey:key,name:'丸木舟',kind:'boat',candidate:1,status:'reviewed-prototype',environment:true,url:`/models/${key}/model.glb`,sha256:review.sha256,bytes:bytes.length,triangles:62145,upAxis:'Y',forwardAxis:'+Z',heightMetres:bounds.max[1]-bounds.min[1],widthMetres:bounds.max[0]-bounds.min[0],lengthMetres:bounds.max[2]-bounds.min[2],placement:{pivot:'hull-bottom-centred',...bounds,seat:[0,.67,-1.3],waterlineOffset:-.28},clips:[],lods:[],notes:review.notes,provenance:{provider:'Codex',claudeUsed:false,referenceGenerator:'Built-in imagegen',referenceImage:`${base}/source/reference-v1.png`,referenceSha256:sha(await readFile(`${base}/source/reference-v1.png`)),reconstruction:'Local TRELLIS-2 1024, seed 42, texture 512, atlas 2048',candidateFile:source,visualReview:`${base}/qa/adoption-review.json`}};
await save(`public/models/${key}/asset.json`,manifest);
const catalog=await json('assets/world-models.json');catalog.assets=catalog.assets.filter(a=>a.key!==key);catalog.assets.push({key,name:'丸木舟',kind:'boat',height:manifest.heightMetres,status:'adopted-awaiting-game-QA',sha256:review.sha256,delivery:manifest.url,geometryResolution:1024,subject:'A wooden dugout canoe carved from a log with an open cockpit.'});await save('assets/world-models.json',catalog);
const world=await json('public/models/world-assets.json');world.assets=world.assets.filter(a=>a.modelKey!==key);world.assets.push(manifest);await save('public/models/world-assets.json',world);
await mkdir(`output/model-generation/models/${key}/qa`,{recursive:true});await save(`output/model-generation/models/${key}/qa/adoption-review.json`,review);
console.log(JSON.stringify({key,sha256:review.sha256,triangles:62145,bytes:bytes.length}));
