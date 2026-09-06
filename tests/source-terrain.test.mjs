import test from 'node:test';
import assert from 'node:assert/strict';
import { installSourceTerrain, terrainHeight, riverBankDrop, installSourceBridge, walkHeight } from '../shared/terrain.mjs';

test('reconstructed terrain samples repeat at tile placements and fit the river bank', () => {
  const restore = installSourceTerrain({ resolution: 2, heights: [0, 1, 1, 2], tileSize: 20, origin: 50 });
  try {
    for (const x of [30, 50, 70, 90]) assert.ok(Math.abs(terrainHeight(x, 50) + riverBankDrop(x, 50) - 1) < 1e-10);
    assert.equal(terrainHeight(45, 45), .5);
    const atRiver = terrainHeight(65, 50), withoutBank = atRiver + riverBankDrop(65, 50);
    assert.ok(atRiver < withoutBank);
  } finally { restore(); }
});

test('disposing an old world cannot clear a newer world terrain sampler', () => {
  const previous = installSourceTerrain({ resolution: 2, heights: [1, 1, 1, 1] });
  const current = installSourceTerrain({ resolution: 2, heights: [2, 2, 2, 2] });
  try { previous(); assert.equal(terrainHeight(30, 30), 2); } finally { current(); }
});

test('the measured bridge supports feet only over its actual deck', () => {
  const restoreTerrain = installSourceTerrain({ resolution:2, heights:[0,0,0,0] });
  const old = installSourceBridge({ minX:-5,maxX:5,minZ:-1.3,maxZ:1.3 }, 65,43.5,.3);
  const current = installSourceBridge({ minX:-5,maxX:5,minZ:-1.3,maxZ:1.3 }, 65,43.5,.4);
  try {
    old();
    assert.equal(walkHeight(65,43.5),.4);
    assert.equal(walkHeight(65,45),terrainHeight(65,45));
    assert.equal(walkHeight(70.2,43.5),terrainHeight(70.2,43.5));
  } finally { current();restoreTerrain(); }
});
