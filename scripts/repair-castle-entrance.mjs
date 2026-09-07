// Conservative source-mesh editing: open a bounded stairwell and reuse the
// castle's own reconstructed staircase. No primitive geometry is constructed.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const revision=process.argv[2]??'02';if(!/^\d{2}$/.test(revision))throw new Error('Invalid revision');
const root='output/model-generation/models/valley-castle',source=`${root}/work/low-poly/candidate-01/candidate.glb`,out=`${root}/work/low-poly/candidate-${revision}`;
await mkdir(out,{recursive:true});
const bytes=await readFile(source),jl=bytes.readUInt32LE(12),doc=JSON.parse(bytes.subarray(20,20+jl)),oldBin=bytes.subarray(28+jl);
const scene=await geometryScene(source);scene.scene.updateMatrixWorld(true);
const triangles=[];scene.scene.traverse(node=>{
  if(!node.isMesh)return;const g=node.geometry,nm=new THREE.Matrix3().getNormalMatrix(node.matrixWorld),index=g.index;
  for(let i=0;i<index.count;i+=3)triangles.push([0,1,2].map(j=>{
    const k=index.getX(i+j),p=new THREE.Vector3().fromBufferAttribute(g.attributes.position,k).applyMatrix4(node.matrixWorld),n=new THREE.Vector3().fromBufferAttribute(g.attributes.normal,k).applyMatrix3(nm).normalize();
    return [...p.toArray(),...n.toArray(),g.attributes.uv.getX(k),g.attributes.uv.getY(k)];
  }));
});
const lerp=(a,b,t)=>a.map((v,i)=>v+(b[i]-v)*t);
function split(poly,axis,value,sign){
  const inside=[],outside=[];
  for(let i=0;i<poly.length;i++){
    const a=poly[i],b=poly[(i+1)%poly.length],da=(a[axis]-value)*sign,db=(b[axis]-value)*sign;
    (da>=-1e-8?inside:outside).push(a);
    if((da>1e-8&&db< -1e-8)||(da< -1e-8&&db>1e-8)){const v=lerp(a,b,da/(da-db));inside.push(v);outside.push(v);}
  }
  return {inside,outside};
}
const planes=box=>[[0,box[0],1],[0,box[1],-1],[1,box[2],1],[1,box[3],-1],[2,box[4],1],[2,box[5],-1]];
function intersection(poly,box){for(const [axis,value,sign]of planes(box)){poly=split(poly,axis,value,sign).inside;if(poly.length<3)return [];}return poly;}
const output=[],add=poly=>{for(let i=1;i+1<poly.length;i++)output.push([poly[0],poly[i],poly[i+1]]);};
const opening=[-1.65,1.65,1.4,8.05,revision==='02'?18.35:19.1,26.1];let edited=0,removedArea=0,cloned=0;
const openings=[opening,...(Number(revision)>=4?[[-1.6,1.6,17.8,20.8,-2.3,3.5]]:[])];
for(const triangle of triangles){
  let pieces=[triangle],changed=false;
  for(const box of openings){
    const next=[];
    for(const piece of pieces){
      if(!intersection(piece,box).length){next.push(piece);continue;}changed=true;
      let pending=piece;
      for(const [axis,value,sign]of planes(box)){const parts=split(pending,axis,value,sign);if(parts.outside.length>=3)next.push(parts.outside);pending=parts.inside;if(pending.length<3)break;}
      if(pending.length>=3)for(let i=1;i+1<pending.length;i++){
        const p=pending[0],a=pending[i],b=pending[i+1];removedArea+=new THREE.Vector3(a[0]-p[0],a[1]-p[1],a[2]-p[2]).cross(new THREE.Vector3(b[0]-p[0],b[1]-p[1],b[2]-p[2])).length()/2;
      }
    }
    pieces=next;
  }
  if(changed)edited++;for(const piece of pieces)add(piece);
}
const sourceStair=[-18,-16.5,7.35,13.0,15.9,25.5],scale=1.47;
for(const triangle of triangles){
  const poly=intersection(triangle,sourceStair);if(poly.length<3)continue;cloned++;
  add(poly.map(v=>[(v[0]+17.25)*scale,(v[1]-7.475)*scale,33+(v[2]-25.5)*scale,...v.slice(3)]));
}
// Reuse a piece of the existing hall floor as its shallow door threshold.
// The opened panel otherwise leaves a narrow missing strip between two slabs.
const thresholdSource=[-1.5,1.5,17.5,17.7,-2.2,-1.0];let thresholdTriangles=0;
if(Number(revision)>=5)for(const triangle of triangles){
  const poly=intersection(triangle,thresholdSource);if(poly.length<3)continue;thresholdTriangles++;
  add(poly.map(v=>[v[0],v[1]+.225,v[2]+1.55,...v.slice(3)]));
}
const points=[],normals=[],uvs=[],indices=[],cache=new Map();
for(const triangle of output)for(const v of triangle){
  const key=v.map((n,i)=>n.toFixed(i<3?5:6)).join(',');let index=cache.get(key);
  if(index===undefined){index=points.length/3;cache.set(key,index);points.push(...v.slice(0,3));const n=new THREE.Vector3(...v.slice(3,6)).normalize();normals.push(...n.toArray());uvs.push(...v.slice(6,8));}
  indices.push(index);
}
const chunks=[oldBin];let offset=oldBin.length;
function append(array,type,componentType){
  const padding=(4-offset%4)%4;if(padding){chunks.push(Buffer.alloc(padding));offset+=padding;}
  const buffer=Buffer.from(array.buffer),view=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:buffer.length});chunks.push(buffer);offset+=buffer.length;
  const count=array.length/({VEC3:3,VEC2:2,SCALAR:1}[type]),accessor={bufferView:view,componentType,count,type};
  if(type==='VEC3'&&array===positionArray){accessor.min=[0,1,2].map(a=>points.filter((_,i)=>i%3===a).reduce((m,v)=>Math.min(m,v),Infinity));accessor.max=[0,1,2].map(a=>points.filter((_,i)=>i%3===a).reduce((m,v)=>Math.max(m,v),-Infinity));}
  const id=doc.accessors.length;doc.accessors.push(accessor);return id;
}
const positionArray=new Float32Array(points);
const primitive={attributes:{POSITION:append(positionArray,'VEC3',5126),NORMAL:append(new Float32Array(normals),'VEC3',5126),TEXCOORD_0:append(new Float32Array(uvs),'VEC2',5126)},indices:append(new Uint32Array(indices),'SCALAR',5125),material:doc.meshes[0].primitives[0].material};
doc.meshes=[{name:'valley-castle-source-with-entrance-stair',primitives:[primitive]}];doc.nodes=[{mesh:0,name:'valley-castle'}];doc.scenes=[{nodes:[0]}];doc.scene=0;doc.buffers=[{byteLength:offset}];
const json=Buffer.from(JSON.stringify(doc)),jsonPadded=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]),bin=Buffer.concat(chunks),binPadded=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]),header=Buffer.alloc(12),jh=Buffer.alloc(8),bh=Buffer.alloc(8);
header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+jsonPadded.length+8+binPadded.length,8);jh.writeUInt32LE(jsonPadded.length);jh.writeUInt32LE(0x4e4f534a,4);bh.writeUInt32LE(binPadded.length);bh.writeUInt32LE(0x004e4942,4);
const result=Buffer.concat([header,jh,jsonPadded,bh,binPadded]);await writeFile(`${out}/candidate.glb`,result,{flag:'wx'});
const report={candidate:1,revision,source,sourceSha256:createHash('sha256').update(bytes).digest('hex'),sha256:createHash('sha256').update(result).digest('hex'),method:'Clip a bounded stairwell from reconstructed internal floor slabs; extract a narrow strip of the existing west staircase, uniformly scale it by 1.47 and place it behind the original gate. Preserve source UV, materials, surface normals, all remaining original positions; weld identical attribute tuples. Revision 04 opens the upper hall door panel; revision 05 copies an existing floor strip into its shallow threshold.',openings,sourceStair,stairScale:scale,thresholdSource,thresholdTranslation:[0,.225,1.55],thresholdTriangles,editedSourceTriangles:edited,removedSurfaceAreaMetres2:removedArea,clonedSourceTriangles:cloned,triangles:indices.length/3,vertices:points.length/3,bytes:result.length,status:'awaiting-exact-GLB-QA'};
await writeFile(`${out}/process-report.json`,JSON.stringify(report,null,2));console.log(JSON.stringify(report));
