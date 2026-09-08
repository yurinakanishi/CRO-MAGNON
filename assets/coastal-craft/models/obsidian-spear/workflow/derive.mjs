import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const source='public/models/flint-spear/model.glb',b=await readFile(source),n=b.readUInt32LE(12),g=JSON.parse(b.subarray(20,20+n)),bin=b.subarray(28+n);
const sha=createHash('sha256').update(b).digest('hex');
g.materials[1].name='Knapped obsidian';
Object.assign(g.materials[1].pbrMetallicRoughness,{baseColorFactor:[.065,.072,.085,1],metallicFactor:0,roughnessFactor:.28});
async function save(key,doc,notes){const dir=`assets/coastal-craft/models/${key}/work/revision-01`;await mkdir(dir,{recursive:true});
  const text=Buffer.from(JSON.stringify(doc)),pad=Buffer.alloc((4-text.length%4)%4,32),json=Buffer.concat([text,pad]);
  const h=Buffer.alloc(20);h.writeUInt32LE(0x46546c67,0);h.writeUInt32LE(2,4);h.writeUInt32LE(28+json.length+bin.length,8);h.writeUInt32LE(json.length,12);h.writeUInt32LE(0x4e4f534a,16);
  const bh=Buffer.alloc(8);bh.writeUInt32LE(bin.length,0);bh.writeUInt32LE(0x004e4942,4);
  await writeFile(`${dir}/candidate.glb`,Buffer.concat([h,json,bh,bin]),{flag:'wx'});
  await writeFile(`${dir}/process.json`,JSON.stringify({candidate:1,revision:1,source,sourceSha256:sha,notes,binaryBufferPreserved:true},null,2));
}
await save('obsidian-spear',g,'Reuse the complete accepted imagegen → TRELLIS spear geometry, UV and textures. Material-only dark nonmetallic glass response on the existing knapped head. The original flint GLB is unchanged.');
const blade=structuredClone(g);blade.meshes[0].primitives=[blade.meshes[0].primitives[1]];blade.nodes[0].name='Knapped obsidian blade';blade.nodes[0].translation=[0,-1.0944492816925049,0];
await save('obsidian-blade',blade,'Extract only the source stone-head primitive; keep exact original vertex/index/UV buffers. Move the base to origin and retain the obsidian material. No new geometry.');
