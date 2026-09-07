import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from './measure-collision-bounds.mjs';

// Rasterize actual source triangles, including their edges, into conservative
// top-down cells. Nothing visible is constructed by this measurement tool.
export function triangleTouchesCell(points,x,z,step) {
  const axes=[[1,0],[0,1]];
  for(let i=0;i<3;i++){
    const a=points[i],b=points[(i+1)%3];axes.push([b.z-a.z,a.x-b.x]);
  }
  const corners=[[x,z],[x+step,z],[x+step,z+step],[x,z+step]];
  for(const [dx,dz] of axes){
    if(Math.abs(dx)+Math.abs(dz)<1e-12)continue;
    const a=points.map(p=>p.x*dx+p.z*dz),b=corners.map(([cx,cz])=>cx*dx+cz*dz);
    if(Math.max(...a)<Math.min(...b)-1e-7||Math.max(...b)<Math.min(...a)-1e-7)return false;
  }
  return true;
}

if(process.argv[1]?.endsWith('measure-region-feature.mjs')){
  const key=process.argv[2],revision=process.argv[3]??'01';
  assert.ok(['desert-cactus','volcanic-basalt-columns'].includes(key));assert.match(revision,/^\d{2}$/);
  const file=`output/model-generation/models/${key}/work/low-poly/candidate-${revision}/candidate.glb`;
  const gltf=await geometryScene(file);gltf.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(gltf.scene,true),step=key==='desert-cactus'?.25:.5;
  const cells=new Map(),triangles=[];
  gltf.scene.traverse(node=>{
    if(!node.isMesh)return;
    const geometry=node.geometry,index=geometry.index,count=index?.count??geometry.attributes.position.count;
    for(let i=0;i<count;i+=3){
      const points=[0,1,2].map(j=>new THREE.Vector3().fromBufferAttribute(geometry.attributes.position,index?index.getX(i+j):i+j).applyMatrix4(node.matrixWorld));
      triangles.push(points);
      const minX=Math.floor(Math.min(...points.map(p=>p.x))/step),maxX=Math.floor(Math.max(...points.map(p=>p.x))/step);
      const minZ=Math.floor(Math.min(...points.map(p=>p.z))/step),maxZ=Math.floor(Math.max(...points.map(p=>p.z))/step);
      for(let ix=minX;ix<=maxX;ix++)for(let iz=minZ;iz<=maxZ;iz++)if(triangleTouchesCell(points,ix*step,iz*step,step)){
        const id=`${ix},${iz}`,height=Math.max(...points.map(p=>p.y));
        cells.set(id,{ix,iz,height:Math.max(height,cells.get(id)?.height??0)});
      }
    }
  });
  const rows=new Map();
  for(const cell of cells.values()){
    if(!rows.has(cell.iz))rows.set(cell.iz,[]);rows.get(cell.iz).push(cell);
  }
  const boxes=[];
  for(const [iz,row] of [...rows].sort(([a],[b])=>a-b)){
    row.sort((a,b)=>a.ix-b.ix);let current;
    for(const cell of row){
      const height=Math.ceil(cell.height*4)/4;
      if(current&&Math.abs(current.maxX-cell.ix*step)<1e-8&&current.height===height)current.maxX+=step;
      else {current={minX:cell.ix*step,maxX:(cell.ix+1)*step,minZ:iz*step,maxZ:(iz+1)*step,height};boxes.push(current);}
    }
  }
  // Every triangle contributes deterministic interior probes. This independent
  // containment check catches holes and axis mistakes in cell consolidation.
  let samples=0,misses=0;
  for(const triangle of triangles)for(const [u,v] of [[0,0],[1,0],[0,1],[.333,.333],[.2,.6]]){
    const p=triangle[0].clone().multiplyScalar(1-u-v).addScaledVector(triangle[1],u).addScaledVector(triangle[2],v);samples++;
    if(!boxes.some(b=>p.x>=b.minX-1e-6&&p.x<=b.maxX+1e-6&&p.z>=b.minZ-1e-6&&p.z<=b.maxZ+1e-6&&p.y<=b.height+1e-6))misses++;
  }
  assert.equal(misses,0);
  const record={key,revision,sha256:createHash('sha256').update(await readFile(file)).digest('hex'),source:file,
    method:'Every exact GLB triangle projected into XZ cells using separating axes; merged only across adjacent cells of equal conservative height.',
    cellSize:step,maximumHorizontalOverestimateMetres:Math.SQRT2*step,bounds:{min:bounds.min.toArray(),max:bounds.max.toArray()},
    occupiedCells:cells.size,boxes,verification:{surfaceSamples:samples,misses},limitations:'Conservative full silhouette collision; no under-arm passage or climbing physics.'};
  const target=`output/model-generation/models/${key}/qa/footprint-rev${revision}.json`;
  await writeFile(target,JSON.stringify(record,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({key,triangles:triangles.length,boxes:boxes.length,occupiedCells:cells.size,samples,misses,target}));
}
