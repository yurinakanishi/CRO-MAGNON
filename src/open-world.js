import * as THREE from 'three';
import { WORLD } from '/shared/world.mjs';
import { BIOMES, biomeById, nearbyChunks } from '/shared/biomes.mjs';
import { installBiomeTerrain } from '/shared/terrain.mjs';
import { fitSourceRiverBank } from './source-surface-fit.js';

const RADIUS=128, CAPACITY=100;
const palettes=BIOMES.map(b=>new THREE.Color(b.color));
const matrix=new THREE.Matrix4(),sphere=new THREE.Sphere();

function terrainMaterial(original,biome) {
  const material=original.clone();material.roughness=biome.id==='ice'?.28:.94;material.side=THREE.FrontSide;
  material.onBeforeCompile=shader=>{
    shader.vertexShader='varying vec3 vTerrainWorld;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <project_vertex>',`#include <project_vertex>
      vec4 terrainPoint=vec4(transformed,1.0);
      #ifdef USE_INSTANCING
      terrainPoint=instanceMatrix*terrainPoint;
      #endif
      vTerrainWorld=(modelMatrix*terrainPoint).xyz;`);
    const points=BIOMES.map((b,i)=>`float d${i}=length(vTerrainWorld.xz-vec2(${b.x.toFixed(1)},${b.z.toFixed(1)}))-${b.radius.toFixed(1)};`).join('\n');
    const min=BIOMES.map((_,i)=>`d${i}`).reduce((a,b)=>`min(${a},${b})`);
    const weights=BIOMES.map((_,i)=>`float w${i}=pow(max(0.0,1.0-(d${i}-nearest)/36.0),2.0);`).join('\n');
    const total=BIOMES.map((_,i)=>`w${i}`).join('+');
    const colors=palettes.map((color,i)=>`vec3(${color.r.toFixed(5)},${color.g.toFixed(5)},${color.b.toFixed(5)})*w${i}`).join('+');
    const index=BIOMES.indexOf(biome),base=palettes[index],baseLuma=Math.max(.05,base.r*.2126+base.g*.7152+base.b*.0722);
    shader.fragmentShader='varying vec3 vTerrainWorld;\n'+shader.fragmentShader;
    shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
      ${points} float nearest=${min}; ${weights} float total=${total};
      float boundary=clamp((1.0-w${index}/total)*2.0,0.0,1.0);
      float reliefColor=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))/${baseLuma.toFixed(5)},.55,1.55);
      reliefColor=mix(reliefColor,1.0,boundary);
      diffuseColor.rgb=mix(diffuseColor.rgb,(${colors})/total*reliefColor,boundary);
      float clearing=max(clamp((10.0-length(vTerrainWorld.xz-vec2(50.0,50.0)))/3.0,0.0,1.0),clamp((5.0-length(vTerrainWorld.xz-vec2(70.0,41.0)))/2.0,0.0,1.0));
      float trail=exp(-pow(vTerrainWorld.x-49.0-sin(vTerrainWorld.z*.16)*2.0,2.0)/1.8)*.5;
      trail*=step(-40.0,vTerrainWorld.z)*step(vTerrainWorld.z,140.0);
      float dirt=max(clearing,trail)*w0/total;
      diffuseColor.rgb*=vec3(1.0+dirt*.55,1.0+dirt*.2,1.0-dirt*.08);`);
    if(biome.id==='volcano')shader.fragmentShader=shader.fragmentShader.replace('#include <emissivemap_fragment>',`#include <emissivemap_fragment>
      float lava=clamp((diffuseColor.r-max(diffuseColor.g,diffuseColor.b)*1.6)*8.0,0.0,1.0);
      totalEmissiveRadiance+=vec3(1.0,.16,.018)*lava*.7;`);
  };
  material.customProgramCacheKey=()=>`terrain-biome-${biome.id}-2`;
  return material;
}

export class OpenWorldTerrain {
  constructor(world) {
    this.world=world;this.assets=world.worldAssets;this.root=new THREE.Group();this.root.name='Streamed TRELLIS world';
    this.chunks=new Map();this.prepared=new Map();this.pending=new Map();this.lastUsed=new Map();this.batches=new Map();
    this.desired=[];this.desiredKeys=new Set();this.nextPlan=0;this.nextCull=0;this.disposed=false;
    this.frustum=new THREE.Frustum();this.projection=new THREE.Matrix4();
    this.world.scene.add(this.root);world.terrain=this.root;
  }
  async initialize(position) {
    const fields=Object.fromEntries(BIOMES.map(b=>[b.id,this.assets.catalog.assets.find(a=>a.modelKey===b.ground)?.placement?.heightField]));
    this.world.releaseTerrainSampler=installBiomeTerrain(fields);
    this.plan(position.x,position.z,0);
    await Promise.all([...this.pending.values()]);
    if(this.disposed)return;
    // The nearest floor exists before characters become visible; distant chunks
    // are then admitted in a bounded amount of work each frame.
    for(const chunk of this.desired.filter(c=>c.distance<55))this.admit(chunk);
  }
  plan(x,z,time) {
    this.desired=nearbyChunks(x,z,RADIUS);this.desiredKeys=new Set(this.desired.map(c=>c.key));
    if(this.desired.length>CAPACITY)throw new Error('Terrain working set exceeded its allocation');
    for(const [key,chunk]of this.chunks)if(!this.desiredKeys.has(key)){this.removeChunk(chunk);this.chunks.delete(key);}
    for(const chunk of this.desired) {
      const key=biomeById(chunk.biome).ground;this.lastUsed.set(key,time);
      if(this.assets.templates.has(key)||this.pending.has(key))continue;
      const promise=this.assets.ensureEnvironment(key).then(()=>{if(!this.disposed)this.world.updateAssetDiagnostics();})
        .catch(error=>{if(!this.disposed)this.world.failWorld('地域の3D素材を読み込めませんでした。再読み込みしてください。',error);throw error;})
        .finally(()=>this.pending.delete(key));
      this.pending.set(key,promise);promise.catch(()=>{});
    }
    for(const [key,last]of this.lastUsed)if(time-last>12&&!this.pending.has(key)) {
      this.releasePrepared(key);this.assets.releaseEnvironment(key);this.lastUsed.delete(key);this.world.updateAssetDiagnostics();
    }
  }
  prepare(key) {
    if(this.prepared.has(key))return this.prepared.get(key);
    const template=this.assets.get(key),biome=BIOMES.find(b=>b.ground===key),levels=[];
    for(const gltf of [template.gltf,...template.lods]) {
      const parts=[];gltf.scene.updateMatrixWorld(true);
      const box=new THREE.Box3().setFromObject(gltf.scene),size=box.getSize(new THREE.Vector3()),centre=box.getCenter(new THREE.Vector3());
      gltf.scene.traverse(node=>{
        if(!node.isMesh)return;
        const geometry=node.geometry.clone().applyMatrix4(node.matrixWorld)
          .translate(-centre.x,-(template.asset.placement.surfaceHeightMetres??0),-centre.z).scale(32/size.x,1,32/size.z);
        geometry.computeBoundingSphere();
        const material=terrainMaterial(node.material,biome),mesh=new THREE.InstancedMesh(geometry,material,CAPACITY);
        mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.matrixAutoUpdate=false;mesh.receiveShadow=true;
        this.root.add(mesh);parts.push({geometry,material,mesh});
      });
      levels.push(parts);
    }
    this.prepared.set(key,levels);return levels;
  }
  admit(chunk) {
    if(this.chunks.has(chunk.key))return;
    const key=biomeById(chunk.biome).ground;if(!this.assets.templates.has(key))return;
    const levels=this.prepare(key),bank=chunk.x+16>=57&&chunk.x-16<=73&&chunk.z+16>=-64&&chunk.z-16<=184;
    const record={...chunk,assetKey:key,bankMeshes:[]};
    if(bank)for(const part of levels[0]) {
      const source=part.geometry.clone().rotateY(chunk.yaw).translate(chunk.x,0,chunk.z),geometry=fitSourceRiverBank(source);
      if(source!==geometry)source.dispose();
      const mesh=new THREE.Mesh(geometry,part.material);mesh.matrixAutoUpdate=false;mesh.receiveShadow=true;this.root.add(mesh);record.bankMeshes.push(mesh);
    }
    this.chunks.set(chunk.key,record);
  }
  update(camera,time) {
    if(this.disposed)return;
    if(time>=this.nextPlan){this.plan(camera.position.x,camera.position.z,time);this.nextPlan=time+.3;}
    const started=performance.now();let admitted=0;
    for(const chunk of this.desired)if(!this.chunks.has(chunk.key)&&this.assets.templates.has(biomeById(chunk.biome).ground)) {
      this.admit(chunk);if(++admitted>=2||performance.now()-started>3)break;
    }
    if(time<this.nextCull&&!admitted)return;this.nextCull=time+.10;
    this.projection.multiplyMatrices(camera.projectionMatrix,camera.matrixWorldInverse);this.frustum.setFromProjectionMatrix(this.projection);
    for(const levels of this.prepared.values())for(const parts of levels)for(const part of parts)part.mesh.count=0;
    let visible=0;
    for(const chunk of this.chunks.values()) {
      sphere.center.set(chunk.x,0,chunk.z);sphere.radius=24;
      if(!this.frustum.intersectsSphere(sphere)){for(const mesh of chunk.bankMeshes)mesh.visible=false;continue;}
      visible++;
      if(chunk.bankMeshes.length){for(const mesh of chunk.bankMeshes)mesh.visible=true;continue;}
      const distance=Math.hypot(camera.position.x-chunk.x,camera.position.z-chunk.z),levels=this.prepared.get(chunk.assetKey);
      const level=Math.min(levels.length-1,distance<44?0:distance<82?1:2);matrix.makeRotationY(chunk.yaw).setPosition(chunk.x,0,chunk.z);
      for(const part of levels[level]){part.mesh.setMatrixAt(part.mesh.count,matrix);part.mesh.count++;}
    }
    for(const levels of this.prepared.values())for(const parts of levels)for(const part of parts)part.mesh.instanceMatrix.needsUpdate=true;
    Object.assign(this.world.canvas.dataset,{terrainChunks:String(this.chunks.size),terrainVisibleChunks:String(visible),terrainChunkLimit:String(CAPACITY),terrainRadius:String(RADIUS),terrainAssetTypes:String(this.prepared.size),terrainPending:String(this.pending.size)});
  }
  removeChunk(chunk) {for(const mesh of chunk.bankMeshes){this.root.remove(mesh);mesh.geometry.dispose();}}
  releasePrepared(key) {
    const levels=this.prepared.get(key);if(!levels)return;
    for(const parts of levels)for(const part of parts){this.root.remove(part.mesh);part.mesh.dispose();part.geometry.dispose();part.material.dispose();}
    this.prepared.delete(key);
  }
  dispose() {
    this.disposed=true;for(const chunk of this.chunks.values())this.removeChunk(chunk);this.chunks.clear();
    for(const key of [...this.prepared.keys()])this.releasePrepared(key);this.world.scene.remove(this.root);
  }
}
