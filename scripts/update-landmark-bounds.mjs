import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// node scripts/update-landmark-bounds.mjs [key=footprint.json ...]: a remade landmark passes the footprint measured
// from its own delivery (scripts/remake/measure_landmark_footprint.py); the GLB is the one its manifest serves.
const override=Object.fromEntries(process.argv.slice(2).map(arg=>arg.split('=')));
const result={};
for(const key of ['glacier-spires','volcanic-cone']){
  const data=JSON.parse(await readFile(override[key]??`output/model-generation/models/${key}/qa/footprint.json`));
  const manifest=JSON.parse(await readFile(`public/models/${key}/asset.json`,'utf8'));
  const bytes=await readFile(`public${manifest.url}`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),data.sha256);
  assert.ok(data.boxes.length>0&&data.boxes.every(b=>b.minX<b.maxX&&b.minZ<b.maxZ&&b.height>0));result[key]=data;
}
await writeFile('shared/landmark-bounds.mts','// Measured from the exact delivered GLBs; see each source hash and footprint method.\nexport const LANDMARK_BOUNDS = '+JSON.stringify(result,null,2)+';\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key,data])=>[key,{sha256:data.sha256,boxes:data.boxes.length,occupiedCells:data.occupiedCells}]))));
