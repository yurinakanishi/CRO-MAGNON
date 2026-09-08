import test from 'node:test';
import assert from 'node:assert/strict';
import { isAttackShortcut, canStartAttack, MovementCommands } from '../dist/src/combat-input.js';
import { HUNTING } from '../dist/shared/hunting.mjs';

test('F uses the physical key across layouts and accepts the alternate attack keys', () => {
  for (const event of [{code:'KeyF',key:'f'},{code:'KeyF',key:'は'},{code:'KeyF',key:'F',shiftKey:true},{code:'Digit5',key:'5'},{code:'Numpad5',key:'5'},{key:'F'}]) assert.equal(isAttackShortcut(event),true);
  for (const flag of ['repeat','isComposing','ctrlKey','metaKey','altKey']) assert.equal(isAttackShortcut({code:'KeyF',key:'f',[flag]:true}),false);
  assert.equal(isAttackShortcut({code:'KeyG',key:'g'}),false);
});

test('navigation immediately after recovery survives idle input and explicit keyboard movement still cancels paths', () => {
  const input=new MovementCommands(),idle={dx:0,dz:0,running:true},walking={dx:0,dz:-1,running:true};
  assert.equal(input.next(idle),null);
  assert.deepEqual(input.next(walking),{type:'move',...walking});
  input.reset(); // Server stopped the actor on defeat, then recovered it.
  input.reset(); // The user clicks the navigation button before the next70ms pulse.
  for(let pulse=0;pulse<10;pulse++)assert.equal(input.next(idle),null);
  assert.deepEqual(input.next(walking),{type:'move',...walking});
  assert.deepEqual(input.next(idle),{type:'move',...idle});
  assert.equal(input.next(idle),null);
  input.next(walking);input.reset(); // A direct ground click also replaces manual motion.
  assert.equal(input.next(idle),null);
});

test('attack control works without a target, during cooking and after cooldown', () => {
  const player={attackSequence:0,attackAt:0,cookingEndsAt:9999};
  assert.equal(canStartAttack(player,1000),true);
  player.attackSequence=1;player.attackAt=1000;
  assert.equal(canStartAttack(player,1000+HUNTING.attackCooldownMs-1),false);
  assert.equal(canStartAttack(player,1000+HUNTING.attackCooldownMs),true);
  assert.equal(canStartAttack(null,2000),false);
  assert.equal(canStartAttack({...player,boatId:'boat-1'},3000),false);
});
