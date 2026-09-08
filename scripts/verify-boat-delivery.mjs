import {readFile,writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {createGameServer} from '../server.mjs';
const catalog=JSON.parse(await readFile('assets/world-models.json','utf8')),world=JSON.parse(await readFile('public/models/world-assets.json','utf8'));
// The original playable is deliberately kept outside the supplemental catalog.
const original=JSON.parse(await readFile('public/models/cro-magnon-hunter/asset.json','utf8'));
const specs=[...catalog.assets,{key:'cro-magnon-hunter',kind:'humanoid',sha256:original.sha256}];
const game=createGameServer({port:0,host:'127.0.0.1'}),address=await game.listen(),files=[];
try{
  for(const spec of specs){
    const manifest=JSON.parse(await readFile(`public/models/${spec.key}/asset.json`,'utf8'));assert.equal(manifest.sha256,spec.sha256);
    if(spec.kind!=='humanoid')assert.deepEqual(JSON.parse(JSON.stringify(world.assets.find(a=>a.modelKey===spec.key))),JSON.parse(JSON.stringify(manifest)));
    for(const entry of [manifest,...(manifest.lods||[])]){
      const response=await fetch(`http://127.0.0.1:${address.port}`+entry.url);assert.equal(response.status,200,entry.url);
      const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.length,entry.bytes);assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
      const qa=JSON.parse(execFileSync(process.execPath,['scripts/inspect-glb.mjs','public'+entry.url],{encoding:'utf8',windowsHide:true}));assert.equal(qa.validation,'passed');assert.equal(qa.triangles,entry.triangles);
      files.push({url:entry.url,sha256:entry.sha256,bytes:bytes.length,triangles:qa.triangles});
    }
  }
  const report={status:'passed',at:new Date().toISOString(),modelCount:specs.length,glbCount:files.length,files};await writeFile('assets/boat/delivery-qa.json',JSON.stringify(report,null,2));console.log(JSON.stringify({models:specs.length,glbs:files.length,status:'passed'}));
}finally{await game.close();}
