import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Parse the actual mesh/skin data; omit materials only in this measurement copy.
// No model file is changed and no substitute visible geometry is constructed.
export async function geometryScene(filename) {
  const bytes = await readFile(filename), jsonLength = bytes.readUInt32LE(12);
  const doc = JSON.parse(bytes.subarray(20,20+jsonLength).toString());
  doc.materials=[];doc.images=[];doc.textures=[];
  for (const mesh of doc.meshes) for (const primitive of mesh.primitives) delete primitive.material;
  const json = Buffer.from(JSON.stringify(doc));
  const padding = (4-json.length%4)%4;
  const chunk = Buffer.concat([json,Buffer.alloc(padding,32)]);
  const binary = bytes.subarray(20+jsonLength);
  const result = Buffer.alloc(20+chunk.length+binary.length);
  result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(chunk.length,12);result.writeUInt32LE(0x4e4f534a,16);
  chunk.copy(result,20);binary.copy(result,20+chunk.length);
  return new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset,result.byteOffset+result.length),'');
}

if (process.argv[1]?.endsWith('measure-collision-bounds.mjs')) {
  const keys=['hide-tent','valley-boulder','valley-pine','firewood-pile','drying-rack','stone-firepit','wood-footbridge','woolly-mammoth'];
  const bounds={};
  for (const key of keys) {
    const file=`public/models/${key}/model.glb`,gltf=await geometryScene(file);
    gltf.scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(gltf.scene,true);
    const trunk = new THREE.Box3();const point=new THREE.Vector3();let radius=0;
    gltf.scene.traverse(node=>{
      if(!node.isMesh)return;
      for(let i=0;i<node.geometry.attributes.position.count;i++){
        node.getVertexPosition(i,point);point.applyMatrix4(node.matrixWorld);
        radius=Math.max(radius,Math.hypot(point.x,point.z));
        if(key==='valley-pine'&&point.y>.1&&point.y<1)trunk.expandByPoint(point);
      }
    });
    bounds[key]={min:box.min.toArray(),max:box.max.toArray(),radius,sha256:createHash('sha256').update(await readFile(file)).digest('hex')};
    if(key==='valley-pine')bounds[key].trunk={min:trunk.min.toArray(),max:trunk.max.toArray()};
  }
  await writeFile('shared/model-bounds.mjs','// Measured from the delivered TRELLIS GLBs by scripts/measure-collision-bounds.mjs.\nexport const MODEL_BOUNDS = '+JSON.stringify(bounds,null,2)+';\n');
  console.log(JSON.stringify(bounds,null,2));
}
