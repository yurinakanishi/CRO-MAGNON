import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { decorateCrowFaction } from '../dist/src/crow-faction-visuals.js';

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
    const root = rig(),
      parts = decorateCrowFaction(root, role);
    assert.equal(root.userData.crowRole, role);
    assert.equal(parts.length, names.length);
    for (const name of names) assert.ok(root.getObjectByName(name), `${role}: ${name}`);
    assert.ok(
      parts.every((part) => part.parent?.isBone),
      `${role}: decorations follow animated bones`,
    );
  }
});
