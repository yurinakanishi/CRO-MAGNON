import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
const result={};
for(const key of ['glacier-spires','volcanic-cone']){
  const data=JSON.parse(await readFile(`output/model-generation/models/${key}/qa/footprint.json`));
  const bytes=await readFile(`public/models/${key}/model.glb`);
  assert.equal(createHash('sha256').update(bytes).digest('hex'),data.sha256);
  assert.ok(data.boxes.length>0&&data.boxes.every(b=>b.minX<b.maxX&&b.minZ<b.maxZ&&b.height>0));result[key]=data;
}
await writeFile('shared/landmark-bounds.mjs','// Measured from the exact delivered GLBs; see each source hash and footprint method.\nexport const LANDMARK_BOUNDS = '+JSON.stringify(result,null,2)+';\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result).map(([key,data])=>[key,{sha256:data.sha256,boxes:data.boxes.length,occupiedCells:data.occupiedCells}]))));
