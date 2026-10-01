// Keep the original bind transforms after Blender's bone-axis reconstruction.
// Only geometry is reduced; both runtime LODs share this exact source skeleton.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
const [source,input,output]=process.argv.slice(2);
async function load(path){const bytes=await readFile(path),length=bytes.readUInt32LE(12);return {json:JSON.parse(bytes.subarray(20,20+length)),bin:Buffer.from(bytes.subarray(28+length))};}
const high=await load(source),low=await load(input),highByName=new Map(high.json.nodes.map(n=>[n.name,n]));
const parentName=(doc,node)=>doc.nodes.find(n=>n.children?.includes(node))?.name;
for(const [i,node] of low.json.nodes.entries()){
  const original=highByName.get(node.name);assert.ok(original,`Unknown LOD node ${node.name}`);
  assert.equal(parentName(low.json,i),parentName(high.json,high.json.nodes.indexOf(original)),`Hierarchy ${node.name}`);
  for(const key of ['matrix','rotation','translation','scale']){
    delete node[key];if(original[key])node[key]=structuredClone(original[key]);
  }
}
for(const [i,skin] of low.json.skins.entries()){
  const original=high.json.skins[i];
  assert.deepEqual(skin.joints.map(j=>low.json.nodes[j].name),original.joints.map(j=>high.json.nodes[j].name));
  const a=high.json.accessors[original.inverseBindMatrices],b=low.json.accessors[skin.inverseBindMatrices];
  assert.equal(a.componentType,5126);assert.equal(b.componentType,5126);assert.equal(a.type,'MAT4');assert.equal(b.type,'MAT4');assert.equal(a.count,b.count);
  const av=high.json.bufferViews[a.bufferView],bv=low.json.bufferViews[b.bufferView];
  assert.ok(!av.byteStride&&!bv.byteStride);
  const start=(av.byteOffset||0)+(a.byteOffset||0),dest=(bv.byteOffset||0)+(b.byteOffset||0);
  high.bin.copy(low.bin,dest,start,start+a.count*64);
}
const raw=Buffer.from(JSON.stringify(low.json)),json=Buffer.alloc(Math.ceil(raw.length/4)*4,32);raw.copy(json);
const header=Buffer.alloc(20);header.write('glTF');header.writeUInt32LE(2,4);header.writeUInt32LE(28+json.length+low.bin.length,8);header.writeUInt32LE(json.length,12);header.writeUInt32LE(0x4e4f534a,16);
const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(low.bin.length);binHeader.writeUInt32LE(0x004e4942,4);
await writeFile(output,Buffer.concat([header,json,binHeader,low.bin]),{flag:'wx'});
console.log(JSON.stringify({source,input,output,nodes:low.json.nodes.length,joints:low.json.skins[0].joints.length,originalSkeletonRetained:true}));
