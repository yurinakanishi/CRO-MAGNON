import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { createSurfaceTemplate, SURFACES } from '../dist/src/biome-surfaces.js';
import { WorldAssets, LandscapeInstances } from '../dist/src/world-assets.js';
import { SCENERY, grassForChunk } from '../dist/shared/scenery-layout.mjs';
import { biomeAt, JOURNEY_STOPS } from '../dist/shared/biomes.mjs';
import { resourceAppearance, BIOME_SCENERY } from '../dist/shared/biome-scenery.mjs';
import { INITIAL_RESOURCES } from '../dist/shared/world.mjs';

function fixture() {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute([0,0,0,1,0,0,0,1,0],3));
  geometry.setAttribute('normal',new THREE.Float32BufferAttribute([0,0,1,0,0,1,0,0,1],3));
  const texture = new THREE.Texture(), material = new THREE.MeshStandardMaterial({map:texture});
  const scene = new THREE.Group();scene.add(new THREE.Mesh(geometry,material));
  return {asset:{modelKey:'valley-boulder',heightMetres:1.7},gltf:{scene},lods:[{scene:scene.clone(true)}],geometry,texture,material};
}

test('all regional appearances share source vertex buffers, texture objects and existing LODs',()=>{
  const source=fixture(),attributes=source.geometry.attributes,originalMaterial=source.material.clone();
  for(const surface of SURFACES){
    const result=createSurfaceTemplate(source,surface);
    assert.equal(result.lods.length,source.lods.length);
    for(const model of [result.gltf,...result.lods])model.scene.traverse(node=>{
      if(!node.isMesh)return;
      assert.equal(node.geometry,source.geometry);
      assert.equal(node.geometry.attributes,attributes);
      assert.equal(node.material.map,source.texture);
      assert.notEqual(node.material,source.material);
      const shader={uniforms:{},vertexShader:'#include <begin_vertex>',fragmentShader:'#include <color_fragment>\n#include <roughnessmap_fragment>'};
      node.material.onBeforeCompile(shader);
      assert.ok(shader.vertexShader.includes('regionalSourceMatrix'));
      assert.ok(shader.fragmentShader.includes('regionalTop()'));
    });
  }
  assert.equal(source.material.map,originalMaterial.map);
  assert.equal(source.material.roughness,originalMaterial.roughness);
  assert.equal(source.material.userData.regionalSurface,undefined);
});

test('repeated instances reuse each material variant and evict without disposing shared geometry or textures',()=>{
  const source=fixture(),assets=new WorldAssets();assets.templates.set('valley-boulder',source);
  let geometryDisposals=0,textureDisposals=0,materialDisposals=0;
  source.geometry.addEventListener('dispose',()=>geometryDisposals++);source.texture.addEventListener('dispose',()=>textureDisposals++);
  const first=assets.get('valley-boulder','snow'),second=assets.get('valley-boulder','snow');assert.equal(first,second);
  for(const material of first.materials)material.addEventListener('dispose',()=>materialDisposals++);
  const a=assets.createResource('valley-boulder','snow'),b=assets.createResource('valley-boulder','snow');
  assert.equal(a.levels[0].object.children[0].material,b.levels[0].object.children[0].material);
  assets.releaseSurface('valley-boulder','snow');assert.equal(materialDisposals,2);assert.equal(geometryDisposals,0);assert.equal(textureDisposals,0);
  assert.ok(assets.templates.has('valley-boulder'));assert.equal(assets.surfaceTemplates.size,0);
  assert.throws(()=>assets.get('valley-boulder','unknown'),/Unknown regional surface/);
  assert.throws(()=>assets.get('missing','snow'),/Missing model/);
});

test('the biome map controls every tree, rock, camp and resource without adding base model keys',()=>{
  assert.ok(SCENERY.trees.some(item=>item.surface==='snow'));
  for(const item of SCENERY.trees)assert.ok(['grassland','snow'].includes(biomeAt(item.x,item.z).id));
  for(const item of [...SCENERY.trees,...SCENERY.rocks,...SCENERY.ridges]){
    const biome=biomeAt(item.x,item.z).id;assert.equal(item.surface??null,BIOME_SCENERY[biome].surface??null);
  }
  for(const stop of JOURNEY_STOPS.filter(stop=>stop.id!=='grassland')){
    const fire=SCENERY.fires.find(item=>item.id===`fire-${stop.id}`);
    assert.equal(fire.key,'stone-firepit');assert.equal(fire.surface,BIOME_SCENERY[stop.id].surface);
    assert.ok(SCENERY.tents.some(item=>item.biome===stop.id&&item.key==='hide-tent'&&item.surface===fire.surface));
  }
  for(const resource of INITIAL_RESOURCES){
    const appearance=resourceAppearance(resource);
    assert.equal(appearance.key,{wood:'firewood-pile',stone:'valley-boulder',berry:'berry-bush',obsidian:'valley-boulder'}[resource.type]);
    assert.equal(appearance.scale,['stone','obsidian'].includes(resource.type)?.55:1);
  }
});

test('regional ground cover is deterministic, sparse and absent on bare ice and volcanic ground',()=>{
  let snow=0,desert=0;
  for(let x=0;x<128;x+=3)for(let z=0;z<64;z+=3){
    const cover=grassForChunk(x,z);assert.ok(cover.length<=250);assert.deepEqual(cover,grassForChunk(x,z));
    for(const item of cover){
      assert.ok(!['ice','volcano'].includes(item.biome));
      if(item.biome==='snow'){snow++;assert.equal(item.key,'berry-bush');assert.equal(item.surface,'snow');}
      if(item.biome==='desert'){desert++;assert.equal(item.key,'meadow-grass');assert.equal(item.surface,'sand');}
    }
  }
  assert.ok(snow>0&&desert>0);
});

test('sharing diagnostics detect a duplicated regional buffer or texture',()=>{
  const source=fixture(),assets=new WorldAssets();assets.templates.set('valley-boulder',source);
  const variant=assets.get('valley-boulder','snow');
  assert.deepEqual(assets.surfaceDiagnostics(),{variants:1,materials:2,sourceGeometries:1,sourceTextures:1,extraGeometries:0,extraTextures:0});
  const node=variant.gltf.scene.children[0];node.geometry=source.geometry.clone();node.material.map=source.texture.clone();
  assert.equal(assets.surfaceDiagnostics().extraGeometries,1);assert.equal(assets.surfaceDiagnostics().extraTextures,1);
});

test('a source without a middle LOD remains visible through the regional distance transition',()=>{
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,1,.1,200);camera.updateMatrixWorld(true);
  const landscape=Object.create(LandscapeInstances.prototype);
  const placement={position:new THREE.Vector3(0,0,-35),height:1.7,yaw:0,scale:new THREE.Vector3(1,1,1)};
  const makeLevel=()=>[{mesh:new THREE.InstancedMesh(fixture().geometry,new THREE.MeshBasicMaterial(),1),local:new THREE.Matrix4()}];
  Object.assign(landscape,{scene,distances:[28,50,110],nextUpdate:0,levels:[makeLevel(),[],makeLevel()],grid:{*near(){yield placement;}},
    matrix:new THREE.Matrix4(),composed:new THREE.Matrix4(),rotation:new THREE.Quaternion(),axis:new THREE.Vector3(0,1,0),
    sphere:new THREE.Sphere(),frustum:new THREE.Frustum(),projection:new THREE.Matrix4()});
  for(const [distance,expectedLevel] of [[27,0],[29,2],[49,2],[51,2]]){
    camera.position.z=distance-35;camera.updateMatrixWorld(true);landscape.update(camera,distance);
    assert.equal(landscape.levels[expectedLevel][0].mesh.count,1,`source visible at ${distance} m`);
    assert.equal(landscape.levels[expectedLevel===0?2:0][0].mesh.count,0);
  }
});
