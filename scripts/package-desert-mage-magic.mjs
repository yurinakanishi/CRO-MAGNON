import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';

// Append portable, animated light sprites. All source mesh, skin, animation,
// texture and material buffers remain byte-identical to the adopted game GLB.
const source='public/models/desert-fennec-mage/model.glb';
const revision=process.argv[2]||'01';
if(!/^\d{2}$/.test(revision))throw Error('Expected two-digit revision');
const directory=`output/desert-mage-magic/revision-${revision}`;
await mkdir(directory,{recursive:true});
const bytes=await readFile(source),jl=bytes.readUInt32LE(12);
const doc=JSON.parse(bytes.subarray(20,20+jl));
const sourceDoc=structuredClone(doc),oldBinary=bytes.subarray(28+jl);
const blocks=[oldBinary];let offset=oldBinary.length;
const addView=(bytes,target)=>{const pad=(4-offset%4)%4;if(pad){blocks.push(Buffer.alloc(pad));offset+=pad;}const view={buffer:0,byteOffset:offset,byteLength:bytes.length,...(target?{target}:{})};doc.bufferViews.push(view);blocks.push(bytes);offset+=bytes.length;return doc.bufferViews.length-1;};
function floats(values,type){const a=Float32Array.from(values),width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type];const accessor={bufferView:addView(Buffer.from(a.buffer)),componentType:5126,count:a.length/width,type};if(type==='SCALAR'){accessor.min=[Math.min(...a)];accessor.max=[Math.max(...a)];}if(type==='VEC3'){accessor.min=[0,1,2].map(i=>Math.min(...a.filter((_,j)=>j%3===i)));accessor.max=[0,1,2].map(i=>Math.max(...a.filter((_,j)=>j%3===i)));}doc.accessors.push(accessor);return doc.accessors.length-1;}
function readFloats(index){const a=doc.accessors[index],v=doc.bufferViews[a.bufferView];assert.equal(a.componentType,5126);const size={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type];return Array.from({length:a.count*size},(_,i)=>oldBinary.readFloatLE((v.byteOffset||0)+(a.byteOffset||0)+i*4));}
const mapping=[[0,0],[.24,.60],[.40,.90],[.64,1.40],[.80,1.80]];
function mapTime(t){for(let i=1;i<mapping.length;i++)if(t<=mapping[i][0]+1e-6){const [a,b]=[mapping[i-1],mapping[i]];return a[1]+(t-a[0])/(b[0]-a[0])*(b[1]-a[1]);}return 1.8;}
function sourceTime(t){for(let i=1;i<mapping.length;i++)if(t<=mapping[i][1]){const[a,b]=[mapping[i-1],mapping[i]];return a[0]+(t-a[1])/(b[1]-a[1])*(b[0]-a[0]);}return .8;}
const magic=structuredClone(doc.animations.find(a=>a.name==='Attack'));magic.name='Magic_Loop';magic.extras={loop:true,description:'Charge light in bare hands, release a light orb, recover. Portable embedded effects.'};
for(const sampler of magic.samplers){assert.equal(sampler.interpolation,'LINEAR');const input=readFloats(sampler.input),values=readFloats(sampler.output),type=doc.accessors[sampler.output].type,width=type==='VEC4'?4:3;sampler.input=floats([...input.map(mapTime),2.4],'SCALAR');sampler.output=floats([...values,...values.slice(0,width)],type);}
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return (c^0xffffffff)>>>0;}
function pngChunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc32(Buffer.concat([t,data])),8+data.length);return out;}
const size=128,raw=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2));const core=Math.exp(-r*r*48),alpha=r<1?Math.min(1,Math.exp(-r*r*8)*.75+core*.65)*(1-r**4):0;const at=y*(size*4+1)+1+x*4;raw[at]=Math.round(110+145*core);raw[at+1]=Math.round(230+25*core);raw[at+2]=Math.round(245-45*core);raw[at+3]=Math.round(255*alpha);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),pngChunk('IHDR',ihdr),pngChunk('IDAT',deflateSync(raw)),pngChunk('IEND',Buffer.alloc(0))]);
doc.images.push({bufferView:addView(png),mimeType:'image/png',name:'Embedded_Magic_Glow'});
doc.samplers??=[];doc.samplers.push({magFilter:9729,minFilter:9729,wrapS:33071,wrapT:33071});
doc.textures.push({sampler:doc.samplers.length-1,source:doc.images.length-1});
doc.extensionsUsed=[...new Set([...(doc.extensionsUsed||[]),'KHR_materials_unlit'])];
const material=doc.materials.length;doc.materials.push({name:'Magic_Light_Glow',pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],baseColorTexture:{index:doc.textures.length-1},metallicFactor:0,roughnessFactor:1},alphaMode:'BLEND',doubleSided:true,extensions:{KHR_materials_unlit:{}}});
const positions=[],uv=[];
for(let axis=0;axis<3;axis++)for(const [x,y,u,v]of[[-.5,-.5,0,1],[.5,-.5,1,1],[.5,.5,1,0],[-.5,-.5,0,1],[.5,.5,1,0],[-.5,.5,0,0]]){positions.push(...(axis===0?[x,y,0]:axis===1?[x,0,y]:[0,x,y]));uv.push(u,v);}
const spriteMesh=doc.meshes.length;doc.meshes.push({name:'Light_particle_crossed_sprites',primitives:[{attributes:{POSITION:floats(positions,'VEC3'),TEXCOORD_0:floats(uv,'VEC2')},material,mode:4}]});
const gltf=await geometryScene(source),mixer=new THREE.AnimationMixer(gltf.scene),attack=gltf.animations.find(a=>a.name==='Attack');
const action=mixer.clipAction(attack);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
const left=gltf.scene.getObjectByName('HandL')??gltf.scene.getObjectByName('Hand.L'),right=gltf.scene.getObjectByName('HandR')??gltf.scene.getObjectByName('Hand.R');assert.ok(left&&right,'Both actual hand bones must resolve');
const frames=145,times=Array.from({length:frames},(_,i)=>i/60),hands=[];
for(const t of times){mixer.setTime(Math.min(.799999,sourceTime(t)));gltf.scene.updateMatrixWorld(true);hands.push([left.getWorldPosition(new THREE.Vector3()).toArray(),right.getWorldPosition(new THREE.Vector3()).toArray()]);}
const input=floats(times,'SCALAR'),effectNodes=[];
const smooth=x=>Math.max(0,Math.min(1,x))**2*(3-2*Math.max(0,Math.min(1,x)));
for(let p=0;p<19;p++){
 const node=doc.nodes.length;doc.nodes.push({name:`Magic_Light_${p.toString().padStart(2,'0')}`,mesh:spriteMesh,translation:[0,.4,0],scale:[0,0,0],extras:{purpose:'portable light effect, not a replacement character mesh'}});doc.scenes[doc.scene||0].nodes.push(node);effectNodes.push(node);
 const xyz=[],scale=[];
 for(let i=0;i<frames;i++){const t=times[i],[l,r]=hands[i],mid=l.map((v,k)=>(v+r[k])*.5),launch=hands[54][0].map((v,k)=>(v+hands[54][1][k])*.5);let pos=[...mid],s=0;
  if(p<2){pos=[...hands[i][p]];pos[2]+=.025;s=.18*smooth(t/.35)*(1-smooth((t-1.1)/.35))*(1+.06*Math.sin(t*26));}
  else if(p===2){const f=Math.max(0,(t-.90)/.8);pos=[launch[0],launch[1]+.06+Math.sin(Math.min(1,f)*Math.PI)*.025,launch[2]+.06+f*.85];s=.26*smooth((t-.88)/.08)*(1-smooth((t-1.40)/.30));}
  else {const n=p-3,phase=n*2.39996+t*8;if(t<.9){pos=[mid[0]+Math.cos(phase)*.11,mid[1]+Math.sin(phase)*.08,mid[2]+.015+Math.sin(phase*.7)*.08];s=.035*smooth((t-.15-n*.009)/.25);}else{const dt=t-.9-n*.014;const f=Math.max(0,dt/.8);pos=[launch[0]+Math.cos(phase)*(.025+f*.05),launch[1]+.06+Math.sin(phase)*(.025+f*.05),launch[2]+.06+f*.85-n*.012];s=.043*smooth(dt/.06)*(1-smooth((t-1.30-n*.01)/.25));}}
  if(t===0||i===frames-1)s=0;xyz.push(...pos);scale.push(s,s,s);
 }
 // Hidden endpoints share exact transforms, making every effect channel loop closed.
 xyz.splice(xyz.length-3,3,...xyz.slice(0,3));
 for(const[path,values]of[['translation',xyz],['scale',scale]]){const sampler=magic.samplers.length;magic.samplers.push({input,output:floats(values,'VEC3'),interpolation:'LINEAR'});magic.channels.push({sampler,target:{node,path}});}
}
doc.animations.unshift(magic);doc.extras={...(doc.extras||{}),defaultAnimation:'Magic_Loop',sourceSHA256:createHash('sha256').update(bytes).digest('hex'),presentationOnly:true};
doc.asset.extras={...(doc.asset.extras||{}),defaultAnimation:'Magic_Loop'};
doc.buffers[0].byteLength=offset;
let binary=Buffer.concat(blocks);binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);
assert.ok(binary.subarray(0,oldBinary.length).equals(oldBinary));
assert.deepEqual(doc.meshes.slice(0,sourceDoc.meshes.length),sourceDoc.meshes);assert.deepEqual(doc.skins,sourceDoc.skins);assert.deepEqual(doc.animations.slice(1),sourceDoc.animations);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const result=Buffer.alloc(28+json.length+binary.length);result.writeUInt32LE(0x46546c67);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);result.writeUInt32LE(json.length,12);result.writeUInt32LE(0x4e4f534a,16);json.copy(result,20);result.writeUInt32LE(binary.length,20+json.length);result.writeUInt32LE(0x004e4942,24+json.length);binary.copy(result,28+json.length);
const file=`${directory}/desert-fennec-mage-magic.glb`;await writeFile(file,result,{flag:'wx'});
const report={source,sourceSHA256:doc.extras.sourceSHA256,file,sha256:createHash('sha256').update(result).digest('hex'),bytes:result.length,revision,defaultAnimation:'Magic_Loop',duration:2.4,releaseAt:.9,coverTime:1.1,sourceBinaryPreserved:true,sourceMeshesAndSkinsPreserved:true,sourceNineClipsPreserved:true,effectParticles:effectNodes.length,effectTriangles:19*6,lightStyle:'Embedded transparent cyan / warm-white sprites; visible without custom game shaders',note:'Portable glTF has no mandatory default-play mechanism; Meshmell default action must also be set by its CLI.'};
await writeFile(`${directory}/packaging.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(report));
