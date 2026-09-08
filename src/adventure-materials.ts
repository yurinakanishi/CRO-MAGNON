import { isMesh } from './three-types.js';
import * as THREE from 'three';

// One coating per source material and treatment; original GLB geometry and
// textures remain shared. The owner evicts unused coatings after 12 seconds.
export class AdventureMaterials {
  declare cache: Map<any, any>;

  constructor() {
    this.cache = new Map();
  }
  apply(root, surface, key, time) {
    root.traverse((node) => {
      if (!isMesh(node)) return;
      const coat = (source) => {
        const id = `${source.uuid}:${surface}`;
        if (!this.cache.has(id)) {
          const material = source.clone();
          material.name = `${key} / ${surface}`;
          const tint = new THREE.Color(
            {
              alpine: '#8e929b',
              ochre: '#b17848',
              moss: '#627c70',
              shadow: '#62517f',
              rift: '#7376a2',
            }[surface],
          );
          material.onBeforeCompile = (shader) => {
            shader.uniforms.adventureTint = { value: tint };
            shader.vertexShader =
              'varying float adventureHeight; varying float adventureTop;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace(
              '#include <begin_vertex>',
              '#include <begin_vertex>\nadventureHeight=position.y;adventureTop=normal.y;',
            );
            shader.fragmentShader =
              'uniform vec3 adventureTint; varying float adventureHeight; varying float adventureTop;\n' +
              shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace(
              '#include <color_fragment>',
              `#include <color_fragment>
              float rockDetail=clamp(dot(diffuseColor.rgb,vec3(.2126,.7152,.0722))*3.0+.45,.45,1.5);
              diffuseColor.rgb=adventureTint*rockDetail;
              ${surface === 'alpine' ? 'diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.82,.89,.95),smoothstep(6.0,16.0,adventureHeight)*smoothstep(.0,.65,adventureTop)*.95);' : ''}`,
            );
          };
          material.customProgramCacheKey = () => `adventure-coating-${surface}-1`;
          material.roughness = 0.92;
          if (surface === 'shadow' || surface === 'rift') {
            material.emissive.set(surface === 'shadow' ? '#17102c' : '#222653');
            material.emissiveIntensity = 0.35;
          }
          this.cache.set(id, { material, key, last: time });
        }
        const entry = this.cache.get(id);
        entry.last = time;
        return entry.material;
      };
      node.material = Array.isArray(node.material) ? node.material.map(coat) : coat(node.material);
    });
  }
  touch(key, time) {
    for (const entry of this.cache.values()) if (entry.key === key) entry.last = time;
  }
  evict(time) {
    for (const [id, entry] of this.cache)
      if (time - entry.last > 12) {
        entry.material.dispose();
        this.cache.delete(id);
      }
  }
  dispose() {
    for (const entry of this.cache.values()) entry.material.dispose();
    this.cache.clear();
  }
}
