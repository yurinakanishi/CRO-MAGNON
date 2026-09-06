import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';
const file=process.argv[2],destination=process.argv[3],bytes=await readFile(file);
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
const gltf=await geometryScene(file);gltf.scene.updateMatrixWorld(true);
const positions=new Map(),edges=new Map(),point=new THREE.Vector3();let vertices=0,faces=0,degenerate=0;
gltf.scene.traverse(node=>{
  if(!node.isMesh)return;
  const p=node.geometry.attributes.position,ids=[];vertices+=p.count;
  for(let i=0;i<p.count;i++){
    point.fromBufferAttribute(p,i).applyMatrix4(node.matrixWorld);
    const key=point.toArray().join(',');if(!positions.has(key))positions.set(key,positions.size);ids.push(positions.get(key));
  }
  const indices=node.geometry.index?.array??Array.from({length:p.count},(_,i)=>i);
  for(let i=0;i<indices.length;i+=3){
    const v=[ids[indices[i]],ids[indices[i+1]],ids[indices[i+2]]];faces++;
    if(new Set(v).size<3)degenerate++;
    for(let j=0;j<3;j++){const a=v[j],b=v[(j+1)%3],key=a<b?`${a},${b}`:`${b},${a}`;const edge=edges.get(key)??{count:0,winding:0};edge.count++;edge.winding+=a<b?1:-1;edges.set(key,edge);}
  }
});
const report={sha256:createHash('sha256').update(bytes).digest('hex'),faces,exportedVertices:vertices,exactPositionWeldedVertices:positions.size,
  boundaryEdges:[...edges.values()].filter(e=>e.count===1).length,nonManifoldEdges:[...edges.values()].filter(e=>e.count>2).length,inconsistentInteriorWinding:[...edges.values()].filter(e=>e.count===2&&e.winding!==0).length,degenerateIndexFaces:degenerate,
  materials:(doc.materials??[]).map(m=>({name:m.name,baseColor:m.pbrMetallicRoughness?.baseColorFactor??[1,1,1,1],metallic:m.pbrMetallicRoughness?.metallicFactor??1,roughness:m.pbrMetallicRoughness?.roughnessFactor??1,alphaMode:m.alphaMode??'OPAQUE',doubleSided:!!m.doubleSided,hasBaseColorTexture:!!m.pbrMetallicRoughness?.baseColorTexture})),
  warning:'UV atlas seams can duplicate export vertices; visual geometry and material gates are assessed separately.'};
if(destination)await writeFile(destination,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
