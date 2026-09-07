import test from 'node:test';
import assert from 'node:assert/strict';
import { RideApproach } from '../src/riding-input.js';
const player={id:'p',x:20,z:0,radius:.32},animal={id:'m',x:0,z:0,radius:2.9,phase:'alive'};
test('an explicit ride request follows the moving animal, throttles paths, then mounts once in reach',()=>{
  const input=new RideApproach();assert.equal(input.update(player,[animal],0),null);input.begin('m');
  const first=input.update(player,[animal],0);assert.equal(first.kind,'target');assert.ok(first.x>3.22);assert.equal(input.update(player,[animal],100),null);
  const moved=input.update(player,[{...animal,x:1}],1300);assert.equal(moved.x,first.x+1);
  assert.deepEqual(input.update({...player,x:4},[animal],1400),{kind:'mount',id:'m'});assert.equal(input.update({...player,x:4},[animal],1500),null);
});
test('cancelled, occupied, missing or stalled targets stop approach and cannot cause an unwanted mount',()=>{
  const input=new RideApproach();input.begin('m');input.cancel();assert.equal(input.update(player,[animal],0),null);
  input.begin('m');assert.equal(input.update(player,[{...animal,riderId:'other'}],0).kind,'cancel');
  input.begin('m');assert.equal(input.update(player,[],0).kind,'cancel');
  input.begin('m');input.update(player,[animal],0);assert.equal(input.update(player,[animal],10001).kind,'cancel');
  input.begin('m');assert.equal(input.update({...player,downedUntil:10},[animal],0),null);assert.equal(input.targetId,null);
});
