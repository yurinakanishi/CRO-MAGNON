import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { fitSourceRiverBank } from './source-surface-fit.js';
import type { RiverBankBuilder } from './river-bank-builder.js';
import { buildMountainLake } from './mountain-lake.js';
import { CAMP_MOUNTAIN } from '../shared/camp-cave-layout.mjs';
import {
  MOUNTAIN_RIVER_LENGTH,
  MOUNTAIN_WATERFALL,
  mountainRiverSample,
} from '../shared/mountain-river.mjs';

// Expand and fit both accepted mountain LODs, retaining source triangles/UVs.
// Only the enlarged summit and the water banks need extra source subdivision.
export function prepareMountainRiverBed(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const placement = new THREE.Matrix4()
    .makeRotationY(CAMP_MOUNTAIN.yaw)
    .setPosition(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
  root.traverse((node) => {
    if (!isMesh(node)) return;
    const matrix = placement.clone().multiply(node.matrixWorld);
    const source = node.geometry.clone().applyMatrix4(matrix);
    const geometry = fitSourceRiverBank(source, 0.45, true);
    if (geometry !== source) source.dispose();
    geometry.applyMatrix4(matrix.invert());
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    node.geometry.dispose();
    node.geometry = geometry;
  });
}

/** The same source fit off the UI thread while the loading cave is playable. */
export async function prepareMountainRiverBedAsync(
  root: THREE.Object3D,
  builder: RiverBankBuilder,
  active = () => true,
) {
  root.updateMatrixWorld(true);
  const placement = new THREE.Matrix4()
    .makeRotationY(CAMP_MOUNTAIN.yaw)
    .setPosition(CAMP_MOUNTAIN.x, 0, CAMP_MOUNTAIN.z);
  const meshes: THREE.Mesh[] = [];
  root.traverse((node) => {
    if (isMesh(node)) meshes.push(node);
  });
  for (const node of meshes) {
    if (!active()) return;
    const matrix = placement.clone().multiply(node.matrixWorld);
    const source = node.geometry.clone().applyMatrix4(matrix);
    const geometry = await builder.build(source, { maximumEdge: 0.45, mountainOnly: true });
    if (!active()) {
      geometry.dispose();
      return;
    }
    geometry.applyMatrix4(matrix.invert());
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    node.geometry.dispose();
    node.geometry = geometry;
  }
}

function flowingMaterial(map: THREE.Texture | null, time: { value: number }) {
  const material = new THREE.MeshPhysicalMaterial({
    color: '#a3c9c8',
    map,
    roughness: 0.28,
    metalness: 0,
    specularIntensity: 0.4,
    transparent: true,
    opacity: 0.94,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  // A thin water sheet needs one double-sided pass; the transparent back/front
  // passes otherwise flip the analytic normals independently at inside bends.
  material.forceSinglePass = true;
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flowTime = time;
    shader.vertexShader =
      'attribute vec3 riverFlow; varying vec3 vFlow; varying vec3 vWaterPosition;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      '#include <begin_vertex>\nvFlow=riverFlow; vWaterPosition=position;',
    );
    shader.fragmentShader =
      `uniform float flowTime; varying vec3 vFlow; varying vec3 vWaterPosition;
      float waterHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
      float waterNoise(vec2 p) { vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(waterHash(i),waterHash(i+vec2(1,0)),f.x),mix(waterHash(i+vec2(0,1)),waterHash(i+vec2(1,1)),f.x),f.y); }
    ` + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <normal_fragment_begin>',
      // A wide pool's inner curve can reverse a source triangle's winding.
      // Water lighting follows the continuous analytic surface normal.
      '#include <normal_fragment_begin>\nnormal *= faceDirection;',
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `
      #include <color_fragment>
      float falling=smoothstep(.45,.9,vFlow.z);
      float downstream=vFlow.y-flowTime*mix(1.7,8.0,falling);
      float noise=waterNoise(vec2(vFlow.x*11.0,downstream*.6));
      float strands=waterNoise(vec2(vFlow.x*32.0+noise*2.0,downstream*1.4));
      float ripples=pow(sin(downstream*4.2+vFlow.x*3.0+noise*3.0)*.5+.5,14.0);
      float fine=smoothstep(.48,.78,strands);
      float edge=smoothstep(.72,1.0,abs(vFlow.x));
      float foam=clamp(falling*(.28+noise*.38+fine*.3)+ripples*(.06+edge*.2),0.0,.93);
      float poolDistance=length(vWaterPosition.xz-vec2(${MOUNTAIN_WATERFALL.foot.x.toFixed(2)},${MOUNTAIN_WATERFALL.foot.z.toFixed(2)}));
      float rings=pow(sin(poolDistance*5.0-flowTime*5.0+noise*2.5)*.5+.5,10.0);
      foam=max(foam,(1.0-smoothstep(1.0,6.5,poolDistance))*rings*.4*(1.0-falling));
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.87,.96,.95),foam);
      float lakeOutflow=1.0-smoothstep(3.0,25.0,vFlow.y);
      diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.045,.15,.17),lakeOutflow*.75);
      diffuseColor.a*=1.0-smoothstep(.94,1.02,abs(vFlow.x))*.42;
      diffuseColor.a*=smoothstep(0.0,4.0,vFlow.y);
      diffuseColor.a*=1.0-smoothstep(${(MOUNTAIN_RIVER_LENGTH - 5).toFixed(3)},${MOUNTAIN_RIVER_LENGTH.toFixed(3)},vFlow.y);
    `,
    );
  };
  material.customProgramCacheKey = () => 'mountain-river-lake-outlet-v2';
  return material;
}

// Water meshes are deformations of the existing image-to-3D river-water GLB,
// not replacement primitives. Tiles overlap in arc length even at the falls.
export function buildMountainRiver(template: THREE.Object3D, time: { value: number }) {
  template.updateMatrixWorld(true);
  const root = new THREE.Group();
  root.name = 'Mountain lake, waterfall and connected tributary';
  root.add(buildMountainLake(template, time));
  const bounds = new THREE.Box3().setFromObject(template),
    size = bounds.getSize(new THREE.Vector3()),
    centre = bounds.getCenter(new THREE.Vector3());
  const parts: {
    geometry: THREE.BufferGeometry;
    matrix: THREE.Matrix4;
    map: THREE.Texture | null;
  }[] = [];
  template.traverse((node) => {
    if (isMesh(node))
      parts.push({
        geometry: node.geometry,
        matrix: node.matrixWorld.clone(),
        map:
          (
            (Array.isArray(node.material)
              ? node.material[0]
              : node.material) as THREE.MeshStandardMaterial
          ).map ?? null,
      });
  });
  const material = flowingMaterial(parts.find((p) => p.map)?.map ?? null, time);
  const length = 5,
    count = Math.ceil(MOUNTAIN_RIVER_LENGTH / length);
  for (let tile = 0; tile < count; tile++) {
    const start = (tile * MOUNTAIN_RIVER_LENGTH) / count,
      end = ((tile + 1) * MOUNTAIN_RIVER_LENGTH) / count;
    for (const part of parts) {
      const geometry = part.geometry.clone().applyMatrix4(part.matrix),
        p = geometry.attributes.position;
      const flow = new Float32Array(p.count * 3),
        normals = new Float32Array(p.count * 3);
      const normal = new THREE.Vector3();
      for (let i = 0; i < p.count; i++) {
        const across = ((p.getX(i) - centre.x) / size.x) * 2;
        const along = (p.getZ(i) - bounds.min.z) / size.z;
        const s = start - 0.14 + along * (end - start + 0.28),
          sample = mountainRiverSample(s);
        const relief =
          (p.getY(i) - bounds.max.y) * 0.012 + (sample.s > MOUNTAIN_RIVER_LENGTH - 6 ? 0.012 : 0);
        p.setXYZ(
          i,
          sample.x + sample.nx * across * sample.width,
          sample.y + relief,
          sample.z + sample.nz * across * sample.width,
        );
        flow.set([across, sample.s, sample.fall], i * 3);
        // Continuous analytic normals avoid lighting seams between water tiles.
        normal
          .set(
            -sample.nz * sample.dy,
            Math.sqrt(Math.max(0.0001, 1 - sample.dy * sample.dy)),
            sample.nx * sample.dy,
          )
          .normalize();
        normals.set(normal.toArray(), i * 3);
      }
      geometry.setAttribute('riverFlow', new THREE.BufferAttribute(flow, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
      geometry.computeBoundingBox();
      geometry.computeBoundingSphere();
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = `Source river water ${tile}`;
      root.add(mesh);
    }
  }
  root.add(waterfallSpray(time));
  root.userData = {
    source: 'river-water',
    length: MOUNTAIN_RIVER_LENGTH,
    tiles: count,
    drop: MOUNTAIN_WATERFALL.lip.y - MOUNTAIN_WATERFALL.foot.y,
    connectedTo: 'valley-river',
  };
  return root;
}

function waterfallSpray(time: { value: number }) {
  const count = 80,
    position = new Float32Array(count * 3),
    seeds = new Float32Array(count * 3);
  const { foot } = MOUNTAIN_WATERFALL;
  for (let i = 0; i < count; i++) {
    position.set([foot.x + 0.7, foot.y + 0.1, foot.z], i * 3);
    seeds.set(
      [((i * 37) % count) / count, ((i * 17) % count) / count, ((i * 53) % count) / count],
      i * 3,
    );
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geometry.setAttribute('spraySeed', new THREE.BufferAttribute(seeds, 3));
  geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(foot.x, foot.y + 1, foot.z), 9);
  const material = new THREE.PointsMaterial({
    color: '#e5f6f2',
    size: 0.22,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.flowTime = time;
    shader.vertexShader =
      'uniform float flowTime; attribute vec3 spraySeed; varying float sprayAge;\n' +
      shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      float age=fract(flowTime*.85+spraySeed.x); sprayAge=age;
      float angle=spraySeed.y*6.283185;
      transformed+=vec3(cos(angle)*age*3.2+age*1.2,sin(age*3.141593)*(1.0+spraySeed.z*1.5),sin(angle)*age*3.2);
    `,
    );
    shader.fragmentShader = 'varying float sprayAge;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      float radius=length(gl_PointCoord-.5)*2.0;
      diffuseColor.a*=(1.0-smoothstep(.2,1.0,radius))*(1.0-sprayAge);
    `,
    );
  };
  material.customProgramCacheKey = () => 'mountain-waterfall-spray-v1';
  const points = new THREE.Points(geometry, material);
  points.name = 'Waterfall splash droplets';
  return points;
}
