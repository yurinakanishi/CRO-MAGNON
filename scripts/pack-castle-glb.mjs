import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const [sourceRevision='05',revision='06']=process.argv.slice(2);
if(![sourceRevision,revision].every(value=>/^\d{2}$/.test(value)))throw new Error('Invalid revision');
const root='output/model-generation/models/valley-castle',source=`${root}/work/low-poly/candidate-${sourceRevision}/candidate.glb`,out=`${root}/work/low-poly/candidate-${revision}`;
const original=await readFile(source),jl=original.readUInt32LE(12),doc=JSON.parse(original.subarray(20,20+jl)),binary=original.subarray(28+jl);
const usedAccessors=new Set();for(const mesh of doc.meshes)for(const primitive of mesh.primitives){Object.values(primitive.attributes).forEach(i=>usedAccessors.add(i));usedAccessors.add(primitive.indices);}
const amap=new Map([...usedAccessors].map((id,i)=>[id,i])),accessors=[...usedAccessors].map(id=>doc.accessors[id]);
const usedViews=new Set([...accessors.map(a=>a.bufferView),...doc.images.map(i=>i.bufferView)]),vmap=new Map([...usedViews].map((id,i)=>[id,i]));
const chunks=[],views=[];let offset=0;
for(const id of usedViews){const old=doc.bufferViews[id],padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}const bytes=binary.subarray(old.byteOffset??0,(old.byteOffset??0)+old.byteLength);chunks.push(bytes);views.push({...old,buffer:0,byteOffset:offset});offset+=bytes.length;}
for(const mesh of doc.meshes)for(const primitive of mesh.primitives){for(const key in primitive.attributes)primitive.attributes[key]=amap.get(primitive.attributes[key]);primitive.indices=amap.get(primitive.indices);}
for(const accessor of accessors)accessor.bufferView=vmap.get(accessor.bufferView);for(const image of doc.images)image.bufferView=vmap.get(image.bufferView);
doc.accessors=accessors;doc.bufferViews=views;doc.buffers=[{byteLength:offset}];
const json=Buffer.from(JSON.stringify(doc)),jp=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),bin=Buffer.concat(chunks),bp=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+jp.length+bp.length,8);jh.writeUInt32LE(jp.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(bp.length);bh.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,jh,jp,bh,bp]);await mkdir(out,{recursive:true});await writeFile(`${out}/candidate.glb`,result,{flag:'wx'});
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const report={candidate:1,revision,source,sourceSha256:sha(original),sha256:sha(result),method:'Remove unreachable original accessors and buffer views after source editing. All surviving vertex, normal, UV, index and embedded image buffer bytes are copied unchanged.',oldBytes:original.length,bytes:result.length,retainedBufferHashes:chunks.filter(b=>b.length>3).map(sha)};
await writeFile(`${out}/process-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
