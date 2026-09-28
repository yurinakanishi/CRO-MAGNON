// A motion-only correction must preserve the previously delivered geometry,
// skin, textures, rest rig and the five clips outside the requested correction.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unpack } from './motion-glb.mjs';
const rev = process.argv[2] || '06', base = 'output/model-generation/models/rimo-neko';
const a = unpack(await readFile(`${base}/work/rig/revision-03/candidate.glb`));
const b = unpack(await readFile(`${base}/work/rig/revision-${rev}/candidate.glb`));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const view = (g, i) => { const v = g.doc.bufferViews[i]; return g.binary.subarray(v.byteOffset || 0, (v.byteOffset || 0) + v.byteLength); };
const accessor = (g, i) => { const v = g.doc.accessors[i]; return { ...v, bufferView: sha(view(g, v.bufferView)) }; };
function mesh(g) {return g.doc.meshes.map(m => ({name:m.name,primitives:m.primitives.map(p=>({...p,indices:accessor(g,p.indices),attributes:Object.fromEntries(Object.entries(p.attributes).map(([n,i])=>[n,accessor(g,i)]))}))}));}
assert.deepEqual(mesh(b),mesh(a),'geometry / skin buffers changed');
assert.deepEqual(b.doc.materials,a.doc.materials,'materials changed');
assert.deepEqual(b.doc.images.map(i=>sha(view(b,i.bufferView))),a.doc.images.map(i=>sha(view(a,i.bufferView))),'image bytes changed');
assert.deepEqual(b.doc.nodes,a.doc.nodes,'rest hierarchy changed');
assert.deepEqual(b.doc.skins.map(s=>({...s,inverseBindMatrices:accessor(b,s.inverseBindMatrices)})),a.doc.skins.map(s=>({...s,inverseBindMatrices:accessor(a,s.inverseBindMatrices)})),'bind pose changed');
const preserved=[];
for(const name of ['Idle_Loop','Walk_Loop','Pet','Happy','Hit']) {
  const clip=(g)=>{const c=g.doc.animations.find(c=>c.name===name);return {...c,samplers:c.samplers.map(s=>({...s,input:accessor(g,s.input),output:accessor(g,s.output)}))};};
  assert.deepEqual(clip(b),clip(a),`${name} changed`);preserved.push(name);
}
const report={revision:rev,parentRevision:'03',geometryAndSkin:'byte-identical',textures:'byte-identical',materials:'identical',restHierarchy:'identical',preservedAnimationBuffers:preserved};
await mkdir(`${base}/qa/rig-${rev}`,{recursive:true});
await writeFile(`${base}/qa/rig-${rev}/preservation.json`,JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));
