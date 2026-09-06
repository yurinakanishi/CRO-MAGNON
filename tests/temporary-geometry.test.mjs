import test from 'node:test';
import assert from 'node:assert/strict';
import { createHuman, disposeTemporaryGeometry } from '../src/models.js';

test('replacing a temporary character releases its own geometry but retains shared geometry and transferred equipment', () => {
  const replaced = createHuman(), other = createHuman();
  const geometries = root => { const set = new Set(); root.traverse(node => { if (node.geometry) set.add(node.geometry); }); return set; };
  const original = geometries(replaced), others = geometries(other), weapon = replaced.userData.weapon;
  const equipment = geometries(weapon), disposed = new Set();
  original.forEach(geometry => geometry.addEventListener('dispose', () => disposed.add(geometry)));
  weapon.removeFromParent();
  disposeTemporaryGeometry(replaced);
  assert.ok(disposed.size > 0);
  assert.ok([...original].filter(geometry => !others.has(geometry) && !equipment.has(geometry)).every(geometry => disposed.has(geometry)));
  assert.ok([...disposed].every(geometry => !others.has(geometry) && !equipment.has(geometry)));
  disposeTemporaryGeometry(weapon);
  assert.ok([...equipment].filter(geometry => !others.has(geometry)).every(geometry => disposed.has(geometry)));
  disposeTemporaryGeometry(other);
});
