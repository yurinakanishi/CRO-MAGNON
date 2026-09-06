import test from 'node:test';
import assert from 'node:assert/strict';
import { movementFromCamera, terrainHeight, walkHeight, riverX, installSourceTerrain, installSourceBridge } from '../shared/terrain.mjs';
test('forward and strafe follow the orbit camera without a diagonal speed advantage',()=>{
  for(const yaw of [0,Math.PI/2,Math.PI,Math.PI*1.5,.73]){
    const forward=movementFromCamera(0,-1,yaw),right=movementFromCamera(1,0,yaw);
    assert.ok(Math.abs(forward.dx+Math.sin(yaw))<1e-10);
    assert.ok(Math.abs(forward.dz+Math.cos(yaw))<1e-10);
    assert.ok(Math.abs(forward.dx*right.dx+forward.dz*right.dz)<1e-10);
    assert.ok(Math.abs(Math.hypot(...Object.values(movementFromCamera(1,-1,yaw)))-1)<1e-10);
  }
  assert.deepEqual(movementFromCamera(0,0,1),{dx:0,dz:0});
});
test('terrain remains finite throughout the map and bridge is above the river bed',()=>{
  const terrain=installSourceTerrain({resolution:2,heights:[0,0,0,0]});
  const bridge=installSourceBridge({minX:-5,maxX:5,minZ:-1.2,maxZ:1.2});
  try {
  for(let x=0;x<=100;x+=2)for(let z=0;z<=100;z+=2)assert.ok(Number.isFinite(terrainHeight(x,z)));
  assert.equal(walkHeight(riverX(43.5),43.5),.3);
  assert.ok(terrainHeight(riverX(43.5),43.5)<walkHeight(riverX(43.5),43.5));
  } finally {bridge();terrain();}
});
