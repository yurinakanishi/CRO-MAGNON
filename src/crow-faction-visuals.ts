import * as THREE from 'three';

const materials = {
  bone: new THREE.MeshStandardMaterial({ color: 0xd8c6a2, roughness: 0.86 }),
  bronze: new THREE.MeshStandardMaterial({ color: 0x8f632e, metalness: 0.62, roughness: 0.48 }),
  ivory: new THREE.MeshStandardMaterial({ color: 0xb9ad95, roughness: 0.94 }),
  red: new THREE.MeshStandardMaterial({ color: 0x651c18, roughness: 0.92 }),
  hide: new THREE.MeshStandardMaterial({ color: 0x39291f, roughness: 1 }),
  wood: new THREE.MeshStandardMaterial({ color: 0x3a2718, roughness: 1 }),
  obsidian: new THREE.MeshStandardMaterial({ color: 0x17131d, metalness: 0.15, roughness: 0.28 }),
  magic: new THREE.MeshStandardMaterial({
    color: 0xff3b2f,
    emissive: 0xa80802,
    emissiveIntensity: 2.2,
    roughness: 0.25,
  }),
};

const geometry = {
  shaft: new THREE.CylinderGeometry(0.028, 0.038, 1.9, 8),
  shortShaft: new THREE.CylinderGeometry(0.035, 0.045, 1.45, 8),
  spearhead: new THREE.ConeGeometry(0.105, 0.34, 4),
  axeBlade: new THREE.ConeGeometry(0.27, 0.56, 4),
  shield: new THREE.CylinderGeometry(0.38, 0.38, 0.09, 18),
  boss: new THREE.SphereGeometry(0.09, 12, 8),
  orb: new THREE.SphereGeometry(0.095, 14, 10),
  ring: new THREE.TorusGeometry(0.23, 0.035, 8, 22),
  halo: new THREE.TorusGeometry(0.28, 0.022, 8, 28),
  spire: new THREE.ConeGeometry(0.045, 0.25, 5),
  pauldron: new THREE.SphereGeometry(0.21, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.58),
};

function mesh(
  name: string,
  shape: THREE.BufferGeometry,
  material: THREE.Material,
  position: [number, number, number],
  rotation: [number, number, number] = [0, 0, 0],
  scale: [number, number, number] = [1, 1, 1],
) {
  const result = new THREE.Mesh(shape, material);
  result.name = name;
  result.position.fromArray(position);
  result.rotation.fromArray(rotation);
  result.scale.fromArray(scale);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function group(name: string, bone: string) {
  const result = new THREE.Group();
  result.name = name;
  result.userData.crowBone = bone;
  return result;
}

function magicFocus(name: string, height = 1.79) {
  const focus = group(name, 'Staff');
  focus.add(mesh(`${name}Orb`, geometry.orb, materials.magic, [-0.39, height, 0.25]));
  return focus;
}

function pontiffParts() {
  const crown = group('CrowPontiffCrown', 'Head');
  crown.add(
    mesh('CrowPontiffHalo', geometry.halo, materials.bronze, [0, 1.82, -0.11], [Math.PI / 2, 0, 0]),
  );
  for (let i = 0; i < 7; i++) {
    const angle = (i * Math.PI * 2) / 7;
    crown.add(
      mesh(`CrowPontiffSpire${i + 1}`, geometry.spire, i % 2 ? materials.bone : materials.bronze, [
        Math.cos(angle) * 0.21,
        1.88 + (i % 2) * 0.035,
        -0.11 + Math.sin(angle) * 0.17,
      ]),
    );
  }
  const mantle = group('CrowPontiffMantle', 'Chest');
  mantle.add(
    mesh(
      'CrowPontiffVestmentL',
      geometry.pauldron,
      materials.ivory,
      [0.36, 1.36, -0.1],
      [0, 0, -0.38],
      [1.42, 0.68, 1.08],
    ),
    mesh(
      'CrowPontiffVestmentR',
      geometry.pauldron,
      materials.ivory,
      [-0.36, 1.36, -0.1],
      [0, 0, 0.38],
      [1.42, 0.68, 1.08],
    ),
  );
  const crozier = group('CrowPontiffCrozier', 'Staff');
  crozier.add(
    mesh('CrowPontiffCrozierShaft', geometry.shaft, materials.wood, [-0.39, 0.96, 0.25]),
    mesh('CrowPontiffCrozierRing', geometry.ring, materials.bronze, [-0.39, 1.93, 0.25]),
    mesh(
      'CrowPontiffFocus',
      geometry.orb,
      materials.magic,
      [-0.39, 1.93, 0.25],
      [0, 0, 0],
      [0.72, 0.72, 0.72],
    ),
  );
  return [crown, mantle, crozier];
}

function prelateParts() {
  const mantle = group('CrowPrelateMantle', 'Chest');
  mantle.add(
    mesh(
      'CrowPrelateRedMantleL',
      geometry.pauldron,
      materials.red,
      [0.34, 1.35, -0.1],
      [0, 0, -0.4],
      [1.25, 0.62, 1],
    ),
    mesh(
      'CrowPrelateRedMantleR',
      geometry.pauldron,
      materials.red,
      [-0.34, 1.35, -0.1],
      [0, 0, 0.4],
      [1.25, 0.62, 1],
    ),
  );
  const weapon = group('CrowPrelatePolearm', 'Staff');
  weapon.add(
    mesh(
      'CrowPrelateBlade',
      geometry.axeBlade,
      materials.obsidian,
      [-0.39, 1.73, 0.25],
      [0, 0, Math.PI / 2],
      [0.72, 0.72, 0.72],
    ),
    mesh(
      'CrowPrelateFocus',
      geometry.orb,
      materials.magic,
      [-0.39, 1.9, 0.25],
      [0, 0, 0],
      [0.7, 0.7, 0.7],
    ),
  );
  return [mantle, weapon];
}

function bruteParts() {
  const armor = group('CrowBruteArmor', 'Chest');
  armor.add(
    mesh(
      'CrowBrutePauldronL',
      geometry.pauldron,
      materials.bone,
      [0.35, 1.36, -0.1],
      [0, 0, -0.42],
      [1.3, 0.8, 1],
    ),
    mesh(
      'CrowBrutePauldronR',
      geometry.pauldron,
      materials.bone,
      [-0.35, 1.36, -0.1],
      [0, 0, 0.42],
      [1.3, 0.8, 1],
    ),
  );
  const axe = group('CrowBruteAxe', 'Staff');
  axe.add(
    mesh('CrowBruteAxeShaft', geometry.shortShaft, materials.wood, [-0.39, 0.95, 0.25]),
    mesh(
      'CrowBruteAxeBladeL',
      geometry.axeBlade,
      materials.obsidian,
      [-0.61, 1.61, 0.25],
      [0, 0, -Math.PI / 2],
    ),
    mesh(
      'CrowBruteAxeBladeR',
      geometry.axeBlade,
      materials.obsidian,
      [-0.17, 1.61, 0.25],
      [0, 0, Math.PI / 2],
    ),
  );
  return [armor, axe];
}

function soldierParts() {
  const spear = group('CrowSoldierSpear', 'Staff');
  spear.add(
    mesh('CrowSoldierShaft', geometry.shaft, materials.wood, [-0.39, 0.95, 0.25]),
    mesh('CrowSoldierSpearhead', geometry.spearhead, materials.obsidian, [-0.39, 1.98, 0.25]),
  );
  const shield = group('CrowSoldierShield', 'HandL');
  shield.add(
    mesh(
      'CrowSoldierHideShield',
      geometry.shield,
      materials.hide,
      [0.46, 0.84, 0.02],
      [Math.PI / 2, 0, 0],
      [1, 1.18, 1],
    ),
    mesh('CrowSoldierShieldBoss', geometry.boss, materials.bone, [0.46, 0.84, -0.04]),
  );
  return [spear, shield];
}

export function decorateCrowFaction(root: THREE.Object3D, crowRole = 'shaman') {
  const parts =
    crowRole === 'pontiff'
      ? pontiffParts()
      : crowRole === 'prelate'
        ? prelateParts()
        : crowRole === 'brute'
          ? bruteParts()
          : crowRole === 'soldier'
            ? soldierParts()
            : [magicFocus('CrowShamanFocus')];
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
