import test from 'node:test';
import assert from 'node:assert/strict';
import { movePlayer } from '../dist/shared/movement.mjs';
import { WORLD } from '../dist/shared/world.mjs';
const player = () => ({ x:40,z:50,dx:1,dz:0,lastInput:1000,target:null,facing:0,runningRequested:false });

test('walk and run cover their configured distance; diagonal input cannot boost speed', () => {
  for (const runningRequested of [false,true]) {
    const p = {...player(),runningRequested,dx:1,dz:1};
    movePlayer(p,.1,1000);
    const speed = runningRequested ? WORLD.runSpeed : WORLD.walkSpeed;
    assert.ok(Math.abs(Math.hypot(p.x-40,p.z-50)-speed*.1)<1e-10);
    assert.equal(p.running,runningRequested);
    assert.ok(Math.abs(p.facing-Math.PI/4)<1e-10);
  }
});

test('the short bear uses a measured smaller gait and the kunoichi outpaces the human tribes', () => {
  for (const [species,walk,run] of [['bear',1.5,4.6],['cat',2.1,5.8]]) {
    for (const runningRequested of [false,true]) {
      const p={...player(),species,runningRequested,dx:-1,dz:1};
      movePlayer(p,.1,1000);
      assert.ok(Math.abs(Math.hypot(p.x-40,p.z-50)-(runningRequested?run:walk)*.1)<1e-10);
      assert.ok(Math.abs(p.facing+Math.PI/4)<1e-10);
      assert.equal(p.running,runningRequested);
    }
  }
});
