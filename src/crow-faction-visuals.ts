import * as THREE from 'three';

// The cult's rank regalia are TRELLIS-derived prop assets (public/models/crow-*, kind 'prop'). Each is
// ground-centred (pivot at the bottom centre, +Y up), so a placement is the point in the crow rig's rest-pose
// model space where that pivot sits (staff line x -0.39 / z 0.25, neck base 1.415 m); the groups are then
// re-parented to their bone so the props follow the animation. Group names are the rank silhouettes the castle
// QA looks for. The red focus orbs are spell light (emissive VFX), not modelled props.
const magic = new THREE.MeshStandardMaterial({
  color: 0xff3b2f,
  emissive: 0xa80802,
  emissiveIntensity: 2.2,
  roughness: 0.25,
});
const orb = new THREE.SphereGeometry(0.095, 14, 10);

type Placement = { key: string; position: [number, number, number] };
type Part = {
  name: string;
  bone: string;
  props: Placement[];
  focus?: { position: [number, number, number]; scale: number };
};

export const CROW_RANK_PARTS: Record<string, Part[]> = {
  pontiff: [
    {
      name: 'CrowPontiffCrown',
      bone: 'Head',
      props: [{ key: 'crow-pontiff-crown', position: [0, 1.6, -0.11] }],
    },
    {
      name: 'CrowPontiffMantle',
      bone: 'Chest',
      props: [{ key: 'crow-ivory-vestment', position: [0, 0.6, -0.13] }],
    },
    {
      name: 'CrowPontiffCrozier',
      bone: 'Staff',
      props: [{ key: 'crow-pontiff-crozier', position: [-0.39, 0, 0.25] }],
      focus: { position: [-0.39, 1.93, 0.25], scale: 0.72 },
    },
  ],
  prelate: [
    {
      name: 'CrowPrelateMantle',
      bone: 'Chest',
      props: [{ key: 'crow-red-mantle', position: [0, 0.82, -0.13] }],
    },
    {
      name: 'CrowPrelatePolearm',
      bone: 'Staff',
      props: [{ key: 'crow-prelate-glaive', position: [-0.39, 0, 0.25] }],
      focus: { position: [-0.39, 1.9, 0.25], scale: 0.7 },
    },
  ],
  shaman: [
    {
      name: 'CrowShamanFocus',
      bone: 'Staff',
      props: [],
      focus: { position: [-0.39, 1.79, 0.25], scale: 1 },
    },
  ],
  brute: [
    {
      name: 'CrowBruteArmor',
      bone: 'Chest',
      props: [{ key: 'crow-bone-pauldrons', position: [0, 0.76, -0.13] }],
    },
    {
      name: 'CrowBruteAxe',
      bone: 'Staff',
      props: [{ key: 'crow-brute-axe', position: [-0.39, 0.225, 0.25] }],
    },
  ],
  soldier: [
    {
      name: 'CrowSoldierSpear',
      bone: 'Staff',
      props: [{ key: 'crow-soldier-spear', position: [-0.39, 0, 0.25] }],
    },
    {
      name: 'CrowSoldierShield',
      bone: 'HandL',
      props: [{ key: 'crow-hide-shield', position: [0.46, 0.39, 0.02] }],
    },
  ],
};

const rankParts = (crowRole: string) => CROW_RANK_PARTS[crowRole] ?? CROW_RANK_PARTS.shaman;

/** Prop asset keys a crow of this rank needs before decorateCrowFaction can run. */
export function crowPropKeys(crowRole = 'shaman') {
  return rankParts(crowRole).flatMap((part) => part.props.map((prop) => prop.key));
}

// The prayer seal: a translucent red veil that encloses the whole praying
// crow like a capsule. A fresnel rim keeps the silhouette readable while the
// centre stays faint enough to see the body inside; a soft ring marks the floor.
const sealVertex = `
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    vViewW = cameraPosition - world.xyz;
    gl_Position = projectionMatrix * viewMatrix * world;
  }`;
const sealFragment = `
  uniform float uOpacity;
  uniform float uTime;
  varying vec3 vNormalW;
  varying vec3 vViewW;
  void main() {
    float facing = abs(dot(normalize(vNormalW), normalize(vViewW)));
    float rim = pow(1.0 - facing, 2.4);
    float bands = 0.5 + 0.5 * sin(vNormalW.y * 9.0 - uTime * 1.6);
    vec3 colour = mix(vec3(0.95, 0.22, 0.16), vec3(1.0, 0.55, 0.35), rim);
    float alpha = uOpacity * (0.16 + 0.84 * rim) * (0.85 + 0.15 * bands);
    gl_FragColor = vec4(colour, alpha);
  }`;
const sealCapsule = new THREE.CapsuleGeometry(0.5, 1, 6, 24);
const sealRingGeometry = new THREE.RingGeometry(0.78, 1, 48);
const sealRingMaterial = new THREE.MeshBasicMaterial({
  color: 0xff3b2f,
  transparent: true,
  opacity: 0.35,
  side: THREE.DoubleSide,
  depthWrite: false,
});
export function createPrayerSeal(radius = 0.5, height = 2) {
  const seal = new THREE.Group();
  seal.name = 'CrowPrayerSeal';
  const veil = new THREE.Mesh(
    sealCapsule,
    new THREE.ShaderMaterial({
      vertexShader: sealVertex,
      fragmentShader: sealFragment,
      uniforms: { uOpacity: { value: 0.5 }, uTime: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  veil.name = 'CrowPrayerVeil';
  veil.renderOrder = 3;
  const ring = new THREE.Mesh(sealRingGeometry, sealRingMaterial.clone());
  ring.name = 'CrowPrayerSealRing';
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  ring.renderOrder = 2;
  seal.add(veil, ring);
  seal.userData.veil = veil;
  seal.userData.ring = ring;
  resizePrayerSeal(seal, radius, height);
  seal.visible = false;
  return seal;
}
export function resizePrayerSeal(seal: THREE.Group, radius: number, height: number) {
  const veil = seal.userData.veil as THREE.Mesh,
    ring = seal.userData.ring as THREE.Mesh;
  // The capsule geometry is 2 units tall for its 0.5 radius: stretch the
  // cylinder part so the veil covers the body from the floor to above the head.
  const capsuleHeight = Math.max(height, radius * 2.2);
  veil.scale.set(radius / 0.5, capsuleHeight / 2, radius / 0.5);
  veil.position.y = capsuleHeight / 2;
  ring.scale.setScalar(radius * 1.15);
}
export function pulsePrayerSeal(seal: THREE.Group, seconds: number) {
  const veil = seal.userData.veil as THREE.Mesh,
    material = veil.material as THREE.ShaderMaterial;
  material.uniforms.uOpacity.value = 0.42 + 0.14 * (0.5 + 0.5 * Math.sin(seconds * 2.2));
  material.uniforms.uTime.value = seconds;
  const ring = seal.userData.ring as THREE.Mesh;
  (ring.material as THREE.MeshBasicMaterial).opacity =
    0.25 + 0.15 * (0.5 + 0.5 * Math.sin(seconds * 2.2));
}
export function disposePrayerSeal(seal: THREE.Group) {
  ((seal.userData.veil as THREE.Mesh).material as THREE.Material).dispose();
  ((seal.userData.ring as THREE.Mesh).material as THREE.Material).dispose();
}
export function decorateCrowFaction(
  root: THREE.Object3D,
  crowRole = 'shaman',
  props: Record<string, THREE.Object3D> = {},
) {
  const parts = rankParts(crowRole).map((spec) => {
    const group = new THREE.Group();
    group.name = spec.name;
    group.userData.crowBone = spec.bone;
    for (const placement of spec.props) {
      const model = props[placement.key];
      if (!model) throw new Error(`Missing crow prop ${placement.key}`);
      model.position.fromArray(placement.position);
      // The animated actor uses one low-poly shadow proxy for the entire body.
      model.traverse((node) => {
        if ((node as THREE.Mesh).isMesh) {
          node.castShadow = false;
          node.receiveShadow = true;
        }
      });
      group.add(model);
    }
    if (spec.focus) {
      const focus = new THREE.Mesh(orb, magic);
      focus.name = `${spec.name}Orb`;
      focus.position.fromArray(spec.focus.position);
      focus.scale.setScalar(spec.focus.scale);
      focus.castShadow = false;
      group.add(focus);
    }
    return group;
  });
  root.updateMatrixWorld(true);
  for (const part of parts) {
    root.add(part);
    root.updateMatrixWorld(true);
    const bone = root.getObjectByName(part.userData.crowBone);
    if (bone) bone.attach(part);
  }
  root.userData.crowRole = crowRole;
  return parts;
}
