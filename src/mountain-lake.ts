import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { LAKE_SHORE_HARMONICS, MOUNTAIN_LAKE } from '../shared/mountain-lake.mjs';

// Flatten and trim the accepted image-to-3D water tile to the shared basin.
// The original triangles, UVs and texture are retained; no primitive is added.
export function buildMountainLake(template: THREE.Object3D, time: { value: number }) {
  const root = new THREE.Group();
  root.name = 'Mountain lake';
  template.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(template);
  const size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  template.traverse((node) => {
    if (!isMesh(node)) return;
    const sourceMaterial = (
      Array.isArray(node.material) ? node.material[0] : node.material
    ) as THREE.MeshStandardMaterial;
    const geometry = node.geometry.clone().applyMatrix4(node.matrixWorld);
    const p = geometry.attributes.position,
      normals = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const u = ((p.getX(i) - centre.x) / size.x) * 2;
      const v = ((p.getZ(i) - centre.z) / size.z) * 2;
      // Cover the basin with the full source surface; the shader trims its
      // irregular shore. Warping a coarse tile into an oval can leave gaps.
      p.setXYZ(
        i,
        MOUNTAIN_LAKE.x + u * MOUNTAIN_LAKE.radiusX * 1.25,
        MOUNTAIN_LAKE.y + (p.getY(i) - bounds.max.y) * 0.002,
        MOUNTAIN_LAKE.z + v * MOUNTAIN_LAKE.radiusZ * 1.25,
      );
      normals.set([0, 1, 0], i * 3);
    }
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const mesh = new THREE.Mesh(geometry, lakeMaterial(sourceMaterial.map, time));
    mesh.name = 'Source water with calm lake ripples';
    root.add(mesh);
  });
  root.userData = { source: 'river-water', waterLevel: MOUNTAIN_LAKE.y };
  return root;
}

function lakeMaterial(map: THREE.Texture | null, time: { value: number }) {
  const material = new THREE.MeshPhysicalMaterial({
    map,
    color: '#ffffff',
    roughness: 0.36,
    specularIntensity: 0.18,
    metalness: 0,
    transparent: true,
    opacity: 0.96,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  material.forceSinglePass = true;
  const shape =
    '1.0' +
    LAKE_SHORE_HARMONICS.map(
      (h) =>
        `+${h.amplitude.toFixed(4)}*sin(angle*${h.frequency.toFixed(1)}+${h.phase.toFixed(6)})`,
    ).join('');
  material.onBeforeCompile = (shader) => {
    shader.uniforms.lakeTime = time;
    shader.vertexShader = 'varying vec3 vLakePosition;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvLakePosition=position;',
    );
    shader.fragmentShader =
      'uniform float lakeTime; varying vec3 vLakePosition;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      vec2 q=(vLakePosition.xz-vec2(${MOUNTAIN_LAKE.x.toFixed(1)},${MOUNTAIN_LAKE.z.toFixed(1)}))/vec2(${MOUNTAIN_LAKE.radiusX.toFixed(1)},${MOUNTAIN_LAKE.radiusZ.toFixed(1)});
      float angle=atan(q.y,q.x);
      float shore=(length(q)-(${shape}))*length(vec2(cos(angle)*${MOUNTAIN_LAKE.radiusX.toFixed(1)},sin(angle)*${MOUNTAIN_LAKE.radiusZ.toFixed(1)}));
      if(shore>0.0) discard;
      float shallow=smoothstep(-5.0,-.1,shore);
      float textureTone=dot(diffuseColor.rgb,vec3(.3,.59,.11));
      vec2 p=vLakePosition.xz;
      float ripple=sin(p.x*1.7+p.y*.73-lakeTime*.9+sin(p.y*.28)*.8)*sin(p.y*2.1-p.x*.43+lakeTime*.63);
      diffuseColor.rgb=mix(vec3(.025,.095,.125),vec3(.065,.185,.16),shallow)*(.96+textureTone*.12)+ripple*.006;
      // Sparse, soft ripples at the shallows; the lake has no downstream stripes.
      float shoreWave=pow(sin(shore*4.3+lakeTime*1.1+p.x*.17)*.5+.5,14.0);
      diffuseColor.rgb+=shoreWave*shallow*.017;
      diffuseColor.a*=mix(1.0,.6,smoothstep(-.55,0.0,shore));
    `,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      `
      #include <normal_fragment_begin>
      normal*=faceDirection;
      vec3 waveNormal=vec3(sin(vLakePosition.x*1.7+vLakePosition.z*.73-lakeTime*.9)*.016,0.0,cos(vLakePosition.z*2.1-vLakePosition.x*.43+lakeTime*.63)*.013);
      normal=normalize(normal+mat3(viewMatrix)*waveNormal);
    `,
    );
  };
  material.customProgramCacheKey = () => 'mountain-lake-calm-v2';
  return material;
}
