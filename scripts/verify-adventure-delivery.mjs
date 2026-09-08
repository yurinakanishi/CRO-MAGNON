import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {ADVENTURE_LANDMARKS,ADVENTURE_SCENERY} from '../dist/shared/adventure-layout.mjs';
import {CHARACTER_MODELS} from '../dist/shared/characters.mjs';
const out=process.argv[2]??'assets/adventure/delivery-qa.json';
const world=JSON.parse(await readFile('public/models/world-assets.json','utf8'));
const assets=[...world.assets];
for(const {key} of CHARACTER_MODELS){
  if(assets.some(a=>a.modelKey===key))continue;
  const asset=JSON.parse(await readFile(`public/models/${key}/asset.json`,'utf8'));assets.push(asset);
}
const files=[];
for(const asset of assets)for(const item of [asset,...asset.lods??[]]){
  const url=item.url,bytes=await readFile('public'+url),sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256,item.sha256,url);assert.equal(bytes.readUInt32LE(0),0x46546c67,url);assert.equal(bytes.readUInt32LE(8),bytes.length,url);
  const gltf=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString('utf8'));
  assert.ok(gltf.meshes?.length,url);if(asset.kind==='static')assert.equal(gltf.skins?.length??0,0,url+' no unused rig');
  files.push({url,bytes:bytes.length,sha256,meshes:gltf.meshes.length,animations:gltf.animations?.map(a=>a.name)??[]});
}
for(const item of [...ADVENTURE_LANDMARKS,...Object.values(ADVENTURE_SCENERY).flat()])assert.ok(assets.some(a=>a.modelKey===item.key),item.key);
await mkdir('assets/adventure',{recursive:true});
const result={status:'passed',at:new Date().toISOString(),models:assets.length,files:files.length,newGLBs:0,landmarkPlacements:ADVENTURE_LANDMARKS.length,sceneryPlacements:Object.values(ADVENTURE_SCENERY).flat().length,checks:['delivered GLB SHA-256','GLB headers and payload length','parsed meshes and clips','static assets have no rig','all new placements use accepted models'],delivery:files};
await writeFile(out,JSON.stringify(result,null,2));console.log(JSON.stringify({...result,delivery:undefined}));
