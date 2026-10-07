import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { crowPropKeys, decorateCrowFaction } from '../dist/src/crow-faction-visuals.js';

function rig() {
  const root = new THREE.Group();
  root.name = 'CrowRig';
  for (const name of ['Head', 'Chest', 'Staff', 'HandL']) {
    const bone = new THREE.Bone();
    bone.name = name;
    root.add(bone);
  }
  root.updateMatrixWorld(true);
  return root;
}

test('each crow rank receives its readable production-reference silhouette', () => {
  const expected = {
    pontiff: ['CrowPontiffCrown', 'CrowPontiffMantle', 'CrowPontiffCrozier'],
    prelate: ['CrowPrelateMantle', 'CrowPrelatePolearm'],
    shaman: ['CrowShamanFocus'],
    brute: ['CrowBruteArmor', 'CrowBruteAxe'],
    soldier: ['CrowSoldierSpear', 'CrowSoldierShield'],
  };
  for (const [role, names] of Object.entries(expected)) {
    const keys = crowPropKeys(role),
      props = Object.fromEntries(keys.map((key) => [key, new THREE.Group()]));
    const root = rig(),
      parts = decorateCrowFaction(root, role, props);
    assert.equal(root.userData.crowRole, role);
    assert.equal(parts.length, names.length);
    for (const name of names) assert.ok(root.getObjectByName(name), `${role}: ${name}`);
    assert.ok(
      parts.every((part) => part.parent?.isBone),
      `${role}: decorations follow animated bones`,
    );
    for (const key of keys)
      assert.ok(
        parts.some((part) => part.children.includes(props[key])),
        `${role}: ${key} prop is attached`,
      );
  }
});

test('ranks use the TRELLIS prop assets and refuse to show without them', () => {
  assert.deepEqual(crowPropKeys('soldier'), ['crow-soldier-spear', 'crow-hide-shield']);
  assert.deepEqual(crowPropKeys('brute'), ['crow-bone-pauldrons', 'crow-brute-axe']);
  assert.deepEqual(crowPropKeys('prelate'), ['crow-red-mantle', 'crow-prelate-glaive']);
  assert.deepEqual(crowPropKeys('pontiff'), [
    'crow-pontiff-crown',
    'crow-ivory-vestment',
    'crow-pontiff-crozier',
  ]);
  assert.deepEqual(crowPropKeys('shaman'), []);
  assert.throws(() => decorateCrowFaction(rig(), 'soldier', {}), /Missing crow prop/);
});
