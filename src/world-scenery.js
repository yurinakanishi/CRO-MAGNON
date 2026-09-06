import * as THREE from 'three';
import { terrainHeight, walkHeight, riverX, riverFade, WATER_LEVEL, clamp, installSourceBridge } from '/shared/terrain.mjs';
import { NPC, INITIAL_RESOURCES } from '/shared/world.mjs';
import { LandscapeInstances } from './world-assets.js';
import { fitSourceRiverBank } from './source-surface-fit.js';
import { SCENERY, seededRandom, grassForChunk } from '/shared/scenery-layout.mjs';
import { OpenWorldTerrain } from './open-world.js';

export const resourceAssets = { wood: 'firewood-pile', stone: 'valley-boulder', berry: 'berry-bush' };
const TAU = Math.PI * 2;
const random=seededRandom;

function addModel(world, key, x, z, yaw = 0, scale = 1) {
  const model = world.worldAssets.create(key); model.position.set(x, walkHeight(x, z), z); model.rotation.y = yaw; model.scale.setScalar(scale); world.scene.add(model); return model;
}

function surfaceMeshes(root) {
  root.updateMatrixWorld(true); const result = [];
  root.traverse(node => { if (node.isMesh) result.push({ geometry: node.geometry, material: node.material, matrix: node.matrixWorld.clone() }); });
  return result;
}

export async function buildTerrainAssets(world) {
  world.openWorld = new OpenWorldTerrain(world);
  await world.openWorld.initialize(world.focus);
  if (world.disposed) return;

  const waterTemplate = world.worldAssets.get('river-water').gltf.scene;
  const waterBounds = new THREE.Box3().setFromObject(waterTemplate), waterSize = waterBounds.getSize(new THREE.Vector3()), waterCentre = waterBounds.getCenter(new THREE.Vector3());
  world.water = new THREE.Group(); world.water.name = 'TRELLIS river tiles';
  world.waterMaterial = new THREE.MeshStandardMaterial({ color: '#92babb', roughness: .27, metalness: 0, transparent: true, opacity: .88, side: THREE.DoubleSide });
  world.waterMaterial.userData.time = { value: 0 };
  world.waterMaterial.onBeforeCompile = shader => {
    shader.uniforms.flowTime = world.waterMaterial.userData.time;
    shader.fragmentShader = 'uniform float flowTime;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n#ifdef USE_MAP\nfloat shimmer = pow(sin(vMapUv.y * 90.0 - flowTime * 1.5 + sin(vMapUv.x * 18.0)) * .5 + .5, 20.0); diffuseColor.rgb += shimmer * .035;\n#endif');
  };
  for (let z = -58; z < 184; z += 12) for (const part of surfaceMeshes(waterTemplate)) {
    const geometry = part.geometry.clone().applyMatrix4(part.matrix), p = geometry.attributes.position;
    if (part.material.map) world.waterMaterial.map = part.material.map;
    for (let i = 0; i < p.count; i++) {
      const wz = z + (p.getZ(i) - waterCentre.z) / waterSize.z * 12.25;
      p.setXYZ(i, riverX(wz) + (p.getX(i) - waterCentre.x) / waterSize.x * 5.5 * riverFade(wz), WATER_LEVEL + (p.getY(i) - waterBounds.max.y) * .015, wz);
    }
    geometry.computeVertexNormals(); geometry.computeBoundingSphere(); world.water.add(new THREE.Mesh(geometry, world.waterMaterial));
  }
  world.scene.add(world.water);
  world.bridge = addModel(world, 'wood-footbridge', riverX(43.5), 43.5);
  const bridgeAsset = world.worldAssets.get('wood-footbridge').asset;
  world.bridge.position.y = .3 - bridgeAsset.placement.deckHeightMetres;
  world.releaseBridgeSampler = installSourceBridge(bridgeAsset.placement.walkBounds);
}

export function buildForestAssets(world) {
  const grassPlacement=item=>({...item,position:new THREE.Vector3(item.x,terrainHeight(item.x,item.z)-.018,item.z),scale:new THREE.Vector3().setScalar(item.scale)});
  const trees=SCENERY.trees.map(item=>({...item,position:new THREE.Vector3(item.x,terrainHeight(item.x,item.z),item.z),scale:new THREE.Vector3(...item.scale)}));
  const grass=SCENERY.grass.map(grassPlacement);
  const rocks=SCENERY.rocks.map(item=>({...item,height:1.7*item.scale,position:new THREE.Vector3(item.x,terrainHeight(item.x,item.z),item.z),scale:new THREE.Vector3().setScalar(item.scale)}));
  world.landscapes=[
    new LandscapeInstances({assets:world.worldAssets,key:'valley-pine',placements:trees,renderer:world.renderer,scene:world.scene,distances:[14,38,110]}),
    new LandscapeInstances({assets:world.worldAssets,key:'meadow-grass',placements:grass,renderer:world.renderer,scene:world.scene,distances:[1.1,1.1,28],foliage:true,generateCell:(x,z)=>grassForChunk(x+8,z+8).map(grassPlacement)}),
    new LandscapeInstances({assets:world.worldAssets,key:'valley-boulder',placements:rocks,renderer:world.renderer,scene:world.scene,distances:[28,28,110]}),
  ];
  for(const item of SCENERY.ridges) {
    const rock=addModel(world,item.key,item.x,item.z,item.yaw,1);
    if(Array.isArray(item.scale)){rock.scale.set(...item.scale);rock.traverse(node=>{if(node.isMesh)node.castShadow=false;});}else rock.scale.setScalar(item.scale);
    freezeStatic(world,rock);
  }
}
function freezeStatic(world,root) { root.updateMatrixWorld(true);root.traverse(node=>{node.matrixAutoUpdate=false;});const bounds=new THREE.Box3().setFromObject(root);world.staticScenery.push({root,radius:bounds.getSize(new THREE.Vector3()).length()*.5}); }
export function buildCampAssets(world) {
  for(const item of [...SCENERY.tents,...SCENERY.props])freezeStatic(world,addModel(world,item.key,item.x,item.z,item.yaw,item.scale));
  for(const item of SCENERY.fires)buildFireEffect(world,item.x,item.z,item.scale);
  world.campLabel=world.createLabel('みんなの野営地','camp',new THREE.Vector3(50,3,50));
  world.npcLabel=world.createLabel('オル','npc',new THREE.Vector3(NPC.x,walkHeight(NPC.x,NPC.z)+2.17,NPC.z),'ネアンデルタール人 · 交易');
}

function buildFireEffect(world, x, z, size) {
  const root = addModel(world, 'stone-firepit', x, z, 0, size);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(36 * 3), 3));
  const material = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { scale: { value: world.renderer.getPixelRatio() } },
    vertexShader: 'uniform float scale; varying float heat; void main(){heat=position.y;vec4 mv=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(110.0*scale/max(1.0,-mv.z)*(1.3-position.y*.3),1.0,80.0);gl_Position=projectionMatrix*mv;}',
    fragmentShader: 'varying float heat;void main(){vec2 p=gl_PointCoord*2.0-1.0;float glow=pow(max(0.0,1.0-dot(p,p)),2.0);gl_FragColor=vec4(mix(vec3(1.0,.2,.015),vec3(1.0,.72,.16),clamp(heat,0.0,1.0)),glow*.38);}',
  });
  const sparks = new THREE.Points(geometry, material); root.add(sparks);
  const light = new THREE.PointLight('#ffad57', 4, 11, 1.6); light.position.set(x, terrainHeight(x, z) + 1.3, z); world.scene.add(light);
  world.fires.push({ root, light, sparks, seed: x });
}

export function buildAnimalAssets(world) {
  for (const spec of SCENERY.animals) {
    const actor=world.worldAssets.createAnimal('woolly-mammoth'),model=new THREE.Group();
    model.add(actor.root);model.scale.setScalar(spec.scale);world.scene.add(model);
    model.userData.animalId=spec.id;
    const meat=world.worldAssets.create('mammoth-meat');meat.visible=false;meat.userData.animalId=spec.id;world.scene.add(meat);
    const label=world.createLabel('マンモス','animal',new THREE.Vector3(),'');label.active=false;
    const detail=document.createElement('small'),health=document.createElement('progress');health.max=100;health.value=100;health.setAttribute('aria-label','マンモスの体力');label.element.append(detail,health);
    world.mammoths.push({id:spec.id,model,meat,label,health,detail,actor,initialized:false});
  }
  const rng = random(623), points = [];
  for (let i = 0; i < 65; i++) points.push(rng() * 80 + 10, rng() * 5 + 1, rng() * 80 + 10);
  const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
  world.motes = new THREE.Points(geometry, new THREE.PointsMaterial({ color: '#eee5ab', size: .037, transparent: true, opacity: .57, depthWrite: false })); world.scene.add(world.motes);
}
