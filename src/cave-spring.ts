import * as THREE from 'three';
import { CAVE_SPRING, caveSpringEdge } from '../shared/cave-spring.mjs';

/** Water is a runtime effect over the basin of the verified source-derived GLB.
 * It owns no rock model, lights, reflection render target or new texture. */
export class CaveSpring {
  readonly root: THREE.Mesh<THREE.BufferGeometry, THREE.MeshPhysicalMaterial>;
  private time = { value: 0 };

  constructor() {
    const vertices = [CAVE_SPRING.x, CAVE_SPRING.waterY, CAVE_SPRING.z];
    const indices: number[] = [];
    const segments = 96;
    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;
      // Extend under the actual stone. Depth testing makes the measured basin
      // itself form the shoreline, avoiding a visibly cut-out oval of water.
      const edge = caveSpringEdge(angle) * 1.24;
      vertices.push(
        CAVE_SPRING.x + Math.cos(angle) * CAVE_SPRING.radiusX * edge,
        CAVE_SPRING.waterY,
        CAVE_SPRING.z + Math.sin(angle) * CAVE_SPRING.radiusZ * edge,
      );
      indices.push(0, ((i + 1) % segments) + 1, i + 1);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const material = new THREE.MeshPhysicalMaterial({
      color: '#367a78',
      roughness: 0.19,
      metalness: 0,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
      clearcoat: 1,
      clearcoatRoughness: 0.13,
      side: THREE.DoubleSide,
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.springTime = this.time;
      shader.vertexShader = 'varying vec3 springPosition;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nspringPosition=position;',
      );
      shader.fragmentShader =
        'uniform float springTime;varying vec3 springPosition;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <normal_fragment_maps>',
        `
        #include <normal_fragment_maps>
        vec2 p=springPosition.xz-vec2(${CAVE_SPRING.x},${CAVE_SPRING.z});
        float wave=sin(p.x*3.1+p.y*1.8+springTime*.65)*.025+sin(p.y*4.7-p.x*1.3-springTime*.5)*.018;
        vec3 surface=-vViewPosition;
        vec3 dx=dFdx(surface),dy=dFdy(surface);
        vec3 r1=cross(dy,normal),r2=cross(normal,dx);
        float det=dot(dx,r1);
        normal=normalize(abs(det)*normal-sign(det)*(dFdx(wave)*r1+dFdy(wave)*r2));
      `,
      );
    };
    material.customProgramCacheKey = () => 'cave-spring-water-v1';
    this.root = new THREE.Mesh(geometry, material);
    this.root.name = 'cave-spring-water';
    this.root.renderOrder = 2;
  }

  update(time: number) {
    this.time.value = time;
  }

  dispose() {
    this.root.removeFromParent();
    this.root.geometry.dispose();
    this.root.material.dispose();
  }
}
