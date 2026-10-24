import * as THREE from 'three';
import { CAMP_CAVE, CAMP_MOUNTAIN_TRAIL, CAVE_APPROACH } from '../shared/camp-cave-layout.mjs';

// The accepted meadow is a solid tile. Its baked edge normals include the
// vertical sides, bending the light on the flat top into a dark, curled rim.
// Refit only the top lighting normals to its actual upward-facing triangles;
// positions, UVs, indices and the hidden side/bottom geometry stay untouched.
export function prepareMeadowNormals(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute('position'),
    normal = geometry.getAttribute('normal'),
    index = geometry.getIndex();
  if (!position || !normal) return;
  const sum = new Float64Array(position.count * 3),
    a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3(),
    face = new THREE.Vector3();
  const at = (i: number) => (index ? index.getX(i) : i);
  for (let i = 0, count = index?.count ?? position.count; i < count; i += 3) {
    const ia = at(i),
      ib = at(i + 1),
      ic = at(i + 2);
    a.fromBufferAttribute(position, ia);
    b.fromBufferAttribute(position, ib).sub(a);
    c.fromBufferAttribute(position, ic).sub(a);
    face.crossVectors(b, c);
    if (face.y <= face.length() * 0.5) continue;
    for (const v of [ia, ib, ic]) {
      sum[v * 3] += face.x;
      sum[v * 3 + 1] += face.y;
      sum[v * 3 + 2] += face.z;
    }
  }
  for (let v = 0; v < position.count; v++) {
    face.fromArray(sum, v * 3);
    if (!face.lengthSq()) continue;
    face.normalize();
    normal.setXYZ(v, face.x, face.y, face.z);
  }
  normal.needsUpdate = true;
}

// The meadow and mountain GLBs embed the same accepted meadow image. Sample it
// in world metres on both surfaces, independent of tile rotation, source UVs or
// LOD. Their millimetre-scale overlap must not change the visible grass pattern.
export function meadowMapFragment(position: string) {
  return `
    #ifdef USE_MAP
    vec2 meadowPoint=${position};
    vec2 meadowA=meadowPoint/29.0;
    vec2 meadowB=mat2(.8,-.6,.6,.8)*meadowPoint/37.0+vec2(.31,.67);
    vec2 meadowC=mat2(.28,.96,-.96,.28)*meadowPoint/23.0+vec2(.73,.19);
    diffuseColor.rgb=texture2D(map,meadowA).rgb*.42
      +texture2D(map,meadowB).rgb*.34+texture2D(map,meadowC).rgb*.24;
    #endif
  `;
}

// The approach starts in the grassland and continues over the mountain apron.
// Both draw the same continuous dust mask, including the switchback to the hill.
const segments = [CAMP_MOUNTAIN_TRAIL, CAVE_APPROACH]
  .flatMap((trail) =>
    trail.slice(1).map((b, i) => {
      const a = trail[i];
      return `trail=min(trail,meadowTrailSegment(p,vec2(${a.x.toFixed(1)},${a.z.toFixed(1)}),vec2(${b.x.toFixed(1)},${b.z.toFixed(1)})));`;
    }),
  )
  .join('\n');
export const meadowTrailShader = `
float meadowTrailSegment(vec2 p,vec2 a,vec2 b){vec2 d=b-a;return length(p-a-d*clamp(dot(p-a,d)/dot(d,d),0.0,1.0));}
vec3 meadowTrail(vec3 albedo,vec2 p){
  float trail=1000.0;${segments}
  float path=(1.0-smoothstep(1.25,3.1,trail))*.85;
  vec2 local=vec2(${CAMP_CAVE.x.toFixed(2)},${CAMP_CAVE.z.toFixed(2)})-p;
  float apron=(1.0-smoothstep(6.0,11.0,abs(local.x)))*smoothstep(6.0,12.0,local.y)*(1.0-smoothstep(18.0,24.0,local.y));
  return mix(albedo,caveDust(albedo,p),1.0-(1.0-path)*(1.0-apron));
}
`;
