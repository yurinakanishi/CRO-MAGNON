import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_MODELS, isCarryable } from '../dist/shared/characters.mjs';
import { canCarry, handleCarryAction } from '../dist/shared/carrying.mjs';

test('carryability comes from each canonical appearance, never a player-supplied flag', () => {
  const ape = { id: 'ape', species: 'ape', x: 0, z: 0, radius: 0.76 };
  const collision = { segmentFree: () => true };
  for (const model of CHARACTER_MODELS) {
    const expected = model.key === 'desert-fennec-mage';
    const passenger = { ...model, id: 'rider', x: 1.3, z: 0, radius: 0.32, carryable: !expected };
    assert.equal(model.carryable, expected);
    assert.equal(isCarryable(passenger), expected, model.key);
    assert.equal(canCarry(ape, passenger, collision, 100000), expected, model.key);
    const room = {
      players: new Map([
        [ape.id, { ...ape }],
        [passenger.id, passenger],
      ]),
      collision,
    };
    const carrier = room.players.get(ape.id);
    handleCarryAction(
      room,
      carrier,
      { action: 'carry', targetId: passenger.id, carryable: true },
      100000,
    );
    assert.equal(carrier.carryOfferToId === passenger.id, expected);
    if (expected) {
      handleCarryAction(room, passenger, { action: 'carry', targetId: ape.id }, 100001);
      assert.equal(carrier.passengerId, passenger.id);
      assert.equal(passenger.carrierId, carrier.id);
    }
  }
  for (const profile of [null, undefined, {}, { species: 'unknown', carryable: true }])
    assert.equal(isCarryable(profile), false);
});

test('acceptance rechecks appearance eligibility even when an invitation already exists', () => {
  const ape = { id: 'ape', species: 'ape', x: 0, z: 0, radius: 0.76 };
  const rider = { id: 'rider', species: 'bear', x: 1.3, z: 0, radius: 0.32 };
  const room = {
    players: new Map([
      [ape.id, ape],
      [rider.id, rider],
    ]),
    collision: { segmentFree: () => true },
  };
  handleCarryAction(room, ape, { action: 'carry', targetId: rider.id }, 100000);
  rider.species = 'cro';
  rider.carryable = true;
  handleCarryAction(room, rider, { action: 'carry', targetId: ape.id }, 100001);
  assert.ok(!ape.passengerId && !rider.carrierId);
});
