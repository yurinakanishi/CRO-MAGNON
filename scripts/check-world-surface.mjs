import * as THREE from 'three';
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {BIOMES,chunkDescription} from '../dist/shared/biomes.mjs';
import {installBiomeTerrain,terrainHeight,riverBankDrop} from '../dist/shared/terrain.mjs';
import {geometryScene} from './measure-collision-bounds.mjs';
import {seededRandom} from '../dist/shared/scenery-layout.mjs';
const records=Object.fromEntries(await Promise.all(BIOMES.map(async b=>[b.id,JSON.parse(await readFile(`public/models/${b.ground}/asset.json`))])));
const release=installBiomeTerrain(Object.fromEntries(BIOMES.map(b=>[b.id,records[b.id].placement.heightField])));
const report={createdAt:new Date().toISOString(),method:'Ray hits on delivered GLBs transformed exactly as the streaming renderer, compared against walking-height samples at four actual chunk rotations.',regions:[]};
for(const biome of BIOMES){
  const asset=records[biome.id],gltf=await geometryScene(`public/models/${biome.ground}/model.glb`);gltf.scene.updateMatrixWorld(true);
  const bounds=new THREE.Box3().setFromObject(gltf.scene),size=bounds.getSize(new THREE.Vector3()),centre=bounds.getCenter(new THREE.Vector3()),root=new THREE.Group();
  gltf.scene.traverse(node=>{if(node.isMesh){const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld).translate(-centre.x,-asset.placement.surfaceHeightMetres,-centre.z).scale(32/size.x,1,32/size.z);root.add(new THREE.Mesh(geometry,new THREE.MeshBasicMaterial({side:THREE.DoubleSide})));}});
  const choices=new Map();for(let x=0;x<20;x++)for(let z=0;z<20;z++){const chunk=chunkDescription(x,z);if(chunk.biome===biome.id&&!choices.has(chunk.yaw))choices.set(chunk.yaw,chunk);}
  assert.equal(choices.size,4);const errors=[],rng=seededRandom(771),ray=new THREE.Raycaster();let missing=0;
  for(const chunk of choices.values()){
    root.position.set(chunk.x,0,chunk.z);root.rotation.y=chunk.yaw;root.updateMatrixWorld(true);
    for(let i=0;i<300;i++){
      const x=chunk.x+(rng()-.5)*31.7,z=chunk.z+(rng()-.5)*31.7;ray.set(new THREE.Vector3(x,5,z),new THREE.Vector3(0,-1,0));
      const hit=ray.intersectObject(root,true)[0];if(!hit){missing++;continue;}
      errors.push(Math.abs(hit.point.y-(terrainHeight(x,z)+riverBankDrop(x,z))));
    }
  }
  errors.sort((a,b)=>a-b);const p95=errors[Math.floor(errors.length*.95)],maximum=errors.at(-1);
  assert.equal(missing,0,`${biome.id}: missing top surface`);assert.ok(p95<.04&&maximum<.15,`${biome.id}: walking-height error ${p95}/${maximum}`);
  report.regions.push({id:biome.id,sha256:asset.sha256,samples:errors.length,rotations:choices.size,missing,p95HeightErrorMetres:p95,maximumHeightErrorMetres:maximum});
}
release();report.status='passed';await writeFile('assets/open-world-surface-qa.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));
