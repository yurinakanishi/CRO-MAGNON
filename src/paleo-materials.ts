import { isMesh } from './three-types.js';
import * as THREE from 'three';
import { EARTH, coastTextureData, geographicWeights } from '../shared/paleo-geography.mjs';
import { BIOMES } from '../shared/biomes.mjs';
import { regionById } from '../shared/adventure-regions.mjs';
const shadow = regionById('shadow-realm');

export function createEarthTextures() {
  const source = coastTextureData();
  const coast = new THREE.DataTexture(source.data, source.width, source.height, THREE.RedFormat);
  coast.minFilter = coast.magFilter = THREE.LinearFilter;
  coast.generateMipmaps = false;
  coast.needsUpdate = true;
  const width = 512,
    height = 256,
    data = new Uint8Array(width * height * 4),
    colors = BIOMES.map((b) => new THREE.Color(b.color).toArray());
  for (let z = 0; z < height; z++)
    for (let x = 0; x < width; x++) {
      const w = geographicWeights(
          EARTH.minX + ((x + 0.5) / width) * EARTH.width,
          EARTH.minZ + ((z + 0.5) / height) * EARTH.height,
        ),
        index = (z * width + x) * 4;
      for (let c = 0; c < 3; c++)
        data[index + c] = Math.round(
          w.reduce((sum, weight, i) => sum + weight * colors[i][c], 0) * 255,
        );
      data[index + 3] = 255;
    }
  const biomes = new THREE.DataTexture(data, width, height);
  biomes.minFilter = biomes.magFilter = THREE.LinearFilter;
  biomes.generateMipmaps = false;
  biomes.needsUpdate = true;
  return {
    coast,
    biomes,
    dispose() {
      coast.dispose();
      biomes.dispose();
    },
  };
}
const earthShader = `
uniform sampler2D earthCoast;
vec2 earthUV(vec2 p){return (p-vec2(${EARTH.minX.toFixed(1)},${EARTH.minZ.toFixed(1)}))/vec2(${EARTH.width.toFixed(1)},${EARTH.height.toFixed(1)});}
float shoreline(vec2 p){return (texture2D(earthCoast,earthUV(p)).r*255.0-128.0)/4.0;}
`;
export function clipRiverAtCoast(shader, textures) {
  shader.uniforms.earthCoast = { value: textures.coast };
  shader.vertexShader = 'varying vec2 vRiverWorld;\n' + shader.vertexShader;
  shader.vertexShader = shader.vertexShader.replace(
    '#include <begin_vertex>',
    '#include <begin_vertex>\nvRiverWorld=(modelMatrix*vec4(transformed,1.0)).xz;',
  );
  shader.fragmentShader = earthShader + 'varying vec2 vRiverWorld;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <color_fragment>',
    '#include <color_fragment>\nif(shoreline(vRiverWorld)<=0.0)discard;',
  );
}
export function earthTerrainMaterial(original, biome, textures) {
  const material = original.clone(),
    base = new THREE.Color(biome.color);
  material.roughness = biome.id === 'ice' ? 0.28 : 0.94;
  material.side = THREE.FrontSide;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.earthCoast = { value: textures.coast };
    shader.uniforms.earthBiomes = { value: textures.biomes };
    shader.vertexShader =
      earthShader +
      'varying vec3 vTerrainWorld;\nvarying float vCoastal;\n#ifdef USE_INSTANCING\nattribute float earthCoastal;\n#endif\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      vec4 earthPoint=vec4(transformed,1.0);
      vCoastal=1.0;
      #ifdef USE_INSTANCING
      earthPoint=instanceMatrix*earthPoint;
      vCoastal=earthCoastal;
      #endif
      earthPoint=modelMatrix*earthPoint;
      if(vCoastal>.5)transformed.y-=.55*(1.0-smoothstep(0.0,4.0,shoreline(earthPoint.xz)));
      vTerrainWorld=earthPoint.xyz;`,
    );
    shader.fragmentShader =
      earthShader +
      'uniform sampler2D earthBiomes;\nvarying vec3 vTerrainWorld;\nvarying float vCoastal;\n' +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float coast=32.0;if(vCoastal>.5)coast=shoreline(vTerrainWorld.xz);if(coast<=0.0)discard;
      vec3 climate=texture2D(earthBiomes,earthUV(vTerrainWorld.xz)).rgb;
      vec3 sourceClimate=vec3(${base.r.toFixed(5)},${base.g.toFixed(5)},${base.b.toFixed(5)});
      float transition=clamp(length(climate-sourceClimate)*8.0,0.0,1.0);
      float relief=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))/max(.04,dot(sourceClimate,vec3(.2126,.7152,.0722))),.65,1.45);
      diffuseColor.rgb=mix(diffuseColor.rgb,climate*relief,transition);
      float beach=1.0-smoothstep(0.0,5.0,coast);
      diffuseColor.rgb=mix(diffuseColor.rgb,${biome.id === 'ice' || biome.id === 'snow' ? 'climate*.8' : 'vec3(.38,.32,.20)'},beach*.55);
      float shadowGarden=1.0-smoothstep(${(shadow.radius - 18).toFixed(1)},${shadow.radius.toFixed(1)},distance(vTerrainWorld.xz,vec2(${shadow.x.toFixed(1)},${shadow.z.toFixed(1)})));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.045,.038,.09)*relief,shadowGarden);`,
    );
    if (biome.id === 'volcano')
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
      float lava=clamp((diffuseColor.r-max(diffuseColor.g,diffuseColor.b)*1.6)*8.0,0.0,1.0);
      totalEmissiveRadiance+=vec3(1.0,.16,.018)*lava*.7;`,
      );
  };
  material.customProgramCacheKey = () => `paleo-terrain-${biome.id}-adventure-1`;
  return material;
}

// The ocean reuses the accepted river-water GLB, scaled as overlapping tiles.
// It is a runtime water effect; no primitive substitutes or new model assets.
export class EarthOcean {
  declare world: any;
  declare parts: any[];
  declare matrix: THREE.Matrix4;
  declare time: {
    value: number;
  };

  constructor(world, textures, capacity = 100) {
    this.world = world;
    this.parts = [];
    this.matrix = new THREE.Matrix4();
    this.time = { value: 0 };
    const root = world.worldAssets.get('river-water').gltf.scene;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root),
      size = box.getSize(new THREE.Vector3()),
      centre = box.getCenter(new THREE.Vector3());
    root.traverse((node) => {
      if (!isMesh(node)) return;
      const geometry = node.geometry
        .clone()
        .applyMatrix4(node.matrixWorld)
        .translate(-centre.x, -box.max.y, -centre.z)
        .scale(34 / size.x, 0.012, 34 / size.z);
      const material = new THREE.MeshStandardMaterial({
        color: '#417d90',
        roughness: 0.38,
        metalness: 0.08,
        side: THREE.DoubleSide,
      });
      material.onBeforeCompile = (shader) => {
        shader.uniforms.earthCoast = { value: textures.coast };
        shader.uniforms.oceanTime = this.time;
        shader.vertexShader = 'varying vec3 vOceanWorld;\n' + shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace(
          '#include <project_vertex>',
          `#include <project_vertex>
          vec4 oceanPoint=vec4(transformed,1.0);
          #ifdef USE_INSTANCING
          oceanPoint=instanceMatrix*oceanPoint;
          #endif
          vOceanWorld=(modelMatrix*oceanPoint).xyz;`,
        );
        shader.fragmentShader =
          earthShader +
          'uniform float oceanTime;\nvarying vec3 vOceanWorld;\n' +
          shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float d=shoreline(vOceanWorld.xz);if(d>1.5)discard;
          float shallow=1.0-smoothstep(0.0,16.0,-d);
          float wave=sin(vOceanWorld.x*.65+oceanTime*.9+sin(vOceanWorld.z*.32))*sin(vOceanWorld.z*.55-oceanTime*.6);
          diffuseColor.rgb=mix(vec3(.055,.15,.21),vec3(.19,.40,.43),shallow)+wave*.014;
          float foam=(1.0-smoothstep(.0,1.1,abs(d+1.3+sin(oceanTime+vOceanWorld.x*.35)*.22)))*.2;
          diffuseColor.rgb+=foam;`,
        );
      };
      material.customProgramCacheKey = () => 'paleo-ocean-1';
      const mesh = new THREE.InstancedMesh(geometry, material, capacity);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      world.scene.add(mesh);
      this.parts.push({ geometry, material, mesh });
    });
  }
  update(chunks, time) {
    this.time.value = time;
    let count = 0;
    for (const c of chunks) {
      this.matrix.makeTranslation(c.x, -0.52, c.z);
      for (const p of this.parts) p.mesh.setMatrixAt(count, this.matrix);
      count++;
    }
    for (const p of this.parts) {
      p.mesh.count = count;
      p.mesh.instanceMatrix.needsUpdate = true;
      p.mesh.boundingSphere = null;
    }
  }
  dispose() {
    for (const p of this.parts) {
      this.world.scene.remove(p.mesh);
      p.mesh.dispose();
      p.geometry.dispose();
      p.material.dispose();
    }
  }
}
