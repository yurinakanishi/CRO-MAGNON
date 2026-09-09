import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {sampleGameMagic} from './sample-desert-game-magic.mjs';
const source='public/models/desert-fennec-mage/model.glb',revision=process.argv[2]||'06';
if(!/^\d{2}$/.test(revision))throw Error('Expected revision');
const directory=`output/desert-mage-magic/revision-${revision}`;await mkdir(directory,{recursive:true});
const bytes=await readFile(source),jl=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jl)),original=structuredClone(doc),oldBinary=bytes.subarray(28+jl),blocks=[oldBinary];let offset=oldBinary.length;
function view(bytes){const pad=(4-offset%4)%4;if(pad){blocks.push(Buffer.alloc(pad));offset+=pad;}doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.length});blocks.push(bytes);offset+=bytes.length;return doc.bufferViews.length-1;}
function floats(values,type){const a=Float32Array.from(values),width={SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[type],record={bufferView:view(Buffer.from(a.buffer)),componentType:5126,count:a.length/width,type};if(type==='SCALAR'||type==='VEC3'){record.min=Array.from({length:width},(_,j)=>a.reduce((v,x,i)=>i%width===j?Math.min(v,x):v,Infinity));record.max=Array.from({length:width},(_,j)=>a.reduce((v,x,i)=>i%width===j?Math.max(v,x):v,-Infinity));}doc.accessors.push(record);return doc.accessors.length-1;}
const sampled=await sampleGameMagic(source),{snapshots,profile,duration}=sampled;
const referenceCamera={position:[-1.28,.79,1.90],target:[0,.43,.25],fov:36,height:960,maxPointPixels:180};
const cameraPosition=new THREE.Vector3(...referenceCamera.position),cameraForward=new THREE.Vector3(...referenceCamera.target).sub(cameraPosition).normalize();
function spriteDiameter(p){const depth=Math.max(.2,new THREE.Vector3(...p.position).sub(cameraPosition).dot(cameraForward));return 2*Math.min(p.size,referenceCamera.maxPointPixels*depth/(referenceCamera.height/Math.tan(referenceCamera.fov*Math.PI/360)));}
const magic={name:'Magic_Loop',channels:[],samplers:[],extras:{loop:true,source:'Actual CharacterAnimation + SpellEffects + server combat sampling',attackSeconds:profile.durationMs/1000,releaseSeconds:profile.impactMs/1000,projectileMetresPerSecond:profile.projectileSpeed}};
const input=floats(snapshots.map(s=>s.seconds),'SCALAR');
function track(node,path,values,interpolation='LINEAR'){const sampler=magic.samplers.length;magic.samplers.push({input,output:floats(values,path==='rotation'?'VEC4':'VEC3'),interpolation});magic.channels.push({sampler,target:{node,path}});}
const q1=new THREE.Quaternion(),q2=new THREE.Quaternion();
for(const [name,first] of Object.entries(sampled.firstPose)){
 const node=doc.nodes.findIndex(n=>THREE.PropertyBinding.sanitizeNodeName(n.name||'')===name);assert.ok(node>=0,`Unresolved node ${name}`);
 for(const path of ['translation','rotation','scale']){
  const values=[];
  for(const snapshot of snapshots){let value=snapshot.pose[name][path];
   // The cast itself is sampled without retiming. Only the final 0.1s of idle
   // returns to the starting idle pose to close the display loop seamlessly.
   if(snapshot.seconds>1.5){const u=(snapshot.seconds-1.5)/.1,f=Math.min(1,u*u*(3-2*u));if(path==='rotation')value=q1.fromArray(value).slerp(q2.fromArray(first[path]),f).toArray();else value=value.map((v,k)=>v+(first[path][k]-v)*f);}
   values.push(...value);
  }track(node,path,values);
 }
}
function crc(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=c&1?(c>>>1)^0xedb88320:c>>>1;}return(c^0xffffffff)>>>0;}
function chunk(type,data){const t=Buffer.from(type),out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);t.copy(out,4);data.copy(out,8);out.writeUInt32BE(crc(Buffer.concat([t,data])),data.length+8);return out;}
const size=128,raw=Buffer.alloc(size*(size*4+1));
for(let y=0;y<size;y++)for(let x=0;x<size;x++){const r=Math.hypot((x+.5-size/2)/(size/2),(y+.5-size/2)/(size/2)),core=Math.exp(-r*r*22),halo=Math.max(0,1-r)**2,alpha=r<1?Math.min(1,halo*.7+core):0,at=y*(size*4+1)+1+x*4;raw[at]=Math.round(255*(.26+(1-.26)*core));raw[at+1]=Math.round(255*(.75+(.9-.75)*core));raw[at+2]=Math.round(255*(.85+(.55-.85)*core));raw[at+3]=Math.round(alpha*255);}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(size);ihdr.writeUInt32BE(size,4);ihdr[8]=8;ihdr[9]=6;
const png=Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',ihdr),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]);
doc.images.push({name:'Game_Magic_Particle_Profile',mimeType:'image/png',bufferView:view(png)});doc.samplers??=[];doc.samplers.push({magFilter:9729,minFilter:9729,wrapS:33071,wrapT:33071});doc.textures.push({source:doc.images.length-1,sampler:doc.samplers.length-1});doc.extensionsUsed=[...new Set([...(doc.extensionsUsed||[]),'KHR_materials_unlit'])];
const positions=[],uv=[];for(let axis=0;axis<3;axis++)for(const[x,y,u,v]of[[-.5,-.5,0,1],[.5,-.5,1,1],[.5,.5,1,0],[-.5,-.5,0,1],[.5,.5,1,0],[-.5,.5,0,0]]){positions.push(...(axis===0?[x,y,0]:axis===1?[x,0,y]:[0,x,y]));uv.push(u,v);}
const attributes={POSITION:floats(positions,'VEC3'),TEXCOORD_0:floats(uv,'VEC2')},meshes=new Map(),particleRoots=[];let meshNodes=0;
function meshForAlpha(alpha){const key=alpha.toFixed(8);if(meshes.has(key))return meshes.get(key);const material=doc.materials.length;doc.materials.push({name:`Game_Magic_alpha_${key}`,pbrMetallicRoughness:{baseColorFactor:[1,1,1,alpha],baseColorTexture:{index:doc.textures.length-1},metallicFactor:0,roughnessFactor:1},alphaMode:'BLEND',doubleSided:true,extensions:{KHR_materials_unlit:{}}});const mesh=doc.meshes.length;doc.meshes.push({name:`Game_Magic_Sprite_${key}`,primitives:[{attributes,material,mode:4}]});meshes.set(key,mesh);return mesh;}
for(let p=0;p<24;p++){
 const root=doc.nodes.length;doc.nodes.push({name:`Magic_Particle_${String(p).padStart(2,'0')}`,children:[],scale:[0,0,0],extras:{gameParticleIndex:p,role:p<14?'hand-charge':p===14?'projectile-core':'projectile-trail'}});doc.scenes[doc.scene||0].nodes.push(root);particleRoots.push(root);
 const values=snapshots.map((s,i)=>i===snapshots.length-1?snapshots[0].particles[p]:s.particles[p]);
 // Inactive GPU slots contain zeroes, not a real trajectory to the origin.
 // Hold the nearest active transform and use STEP visibility to switch off.
 // Otherwise glTF interpolation drags a fading spark through the caster.
 let held=values.find(v=>v.alpha>0&&v.size>0)??values[0];
 const transforms=values.map(v=>{if(v.alpha>0&&v.size>0)held=v;return held;});
 track(root,'translation',transforms.flatMap(v=>v.position));
 // Game shader multiplies by full viewport height; ordinary planes project
 // using half the viewport height. Diameter 2*size preserves apparent size.
 track(root,'scale',transforms.flatMap(v=>{const diameter=spriteDiameter(v);return[diameter,diameter,diameter];}));
 const alphaLevels=p===0||p===7?Array.from({length:8},(_,i)=>.55+i*.05):[Math.max(...snapshots.map(s=>s.particles[p].alpha))];
 for(let layer=0;layer<alphaLevels.length;layer++){
  const node=doc.nodes.length;doc.nodes.push({name:`Magic_Light_${String(p).padStart(2,'0')}_${layer}`,mesh:meshForAlpha(alphaLevels[layer]),scale:[0,0,0]});doc.nodes[root].children.push(node);meshNodes++;
  track(node,'scale',values.flatMap(v=>{const selected=alphaLevels.length===1?0:Math.max(0,Math.min(7,Math.round((v.alpha-.55)/.05)));const visible=v.size>0&&v.alpha>0&&selected===layer?1:0;return[visible,visible,visible];}),'STEP');
 }
}
doc.animations.unshift(magic);const sourceSHA256=createHash('sha256').update(bytes).digest('hex');doc.extras={...(doc.extras||{}),defaultAnimation:'Magic_Loop',sourceSHA256,presentationOnly:true,gameTimingMatched:true};doc.asset.extras={...(doc.asset.extras||{}),defaultAnimation:'Magic_Loop'};doc.buffers[0].byteLength=offset;
let binary=Buffer.concat(blocks);binary=Buffer.concat([binary,Buffer.alloc((4-binary.length%4)%4)]);assert.ok(binary.subarray(0,oldBinary.length).equals(oldBinary));assert.deepEqual(doc.meshes.slice(0,original.meshes.length),original.meshes);assert.deepEqual(doc.skins,original.skins);assert.deepEqual(doc.animations.slice(1),original.animations);
let json=Buffer.from(JSON.stringify(doc));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);const output=Buffer.alloc(28+json.length+binary.length);output.writeUInt32LE(0x46546c67);output.writeUInt32LE(2,4);output.writeUInt32LE(output.length,8);output.writeUInt32LE(json.length,12);output.writeUInt32LE(0x4e4f534a,16);json.copy(output,20);output.writeUInt32LE(binary.length,20+json.length);output.writeUInt32LE(0x004e4942,24+json.length);binary.copy(output,28+json.length);
const file=`${directory}/desert-fennec-mage-magic.glb`;await writeFile(file,output,{flag:'wx'});
const report={source,sourceSHA256,file,sha256:createHash('sha256').update(output).digest('hex'),bytes:output.length,revision,defaultAnimation:'Magic_Loop',duration,attackSeconds:profile.durationMs/1000,releaseAt:profile.impactMs/1000,projectileSpeed:profile.projectileSpeed,projectileHeight:.4,coverTime:.5,sourceBinaryPreserved:true,sourceMeshesAndSkinsPreserved:true,sourceNineClipsPreserved:true,particleRoots,particleSlots:24,meshNodes,referenceCamera,referenceConditions:sampled.referenceConditions,sampling:'Actual game CharacterAnimation, SpellEffects, startAttack, resolveAttack, updateProjectiles; no motion retiming or added orb height.',visualLimitation:'Portable GLB uses alpha-blended crossed sprites instead of the game additive point shader. Core opacity is quantized in 0.05 increments. The game 180px point-size cap is baked for the recorded cover camera; arbitrary viewer zoom cannot retain a pixel-size cap in standard glTF. Positions and event timing match the game sampler.',loopClosure:'Only last 0.1s of idle returns to first pose; Attack timing is unchanged.'};await writeFile(`${directory}/packaging.json`,JSON.stringify(report,null,2)+'\n',{flag:'wx'});await writeFile(`${directory}/game-samples.json`,JSON.stringify(sampled)+'\n',{flag:'wx'});console.log(JSON.stringify({...report,particleRoots:undefined}));
