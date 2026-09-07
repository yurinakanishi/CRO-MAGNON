import test from 'node:test';
import assert from 'node:assert/strict';
import {triangleTouchesCell} from '../scripts/measure-region-feature.mjs';
const triangle=(...points)=>points.map(([x,z])=>({x,z}));

test('a rock face crossing a cell is retained when all its vertices are outside',()=>{
  const face=triangle([-3,.3],[3,.3],[3,.4]);
  assert.equal(triangleTouchesCell(face,0,0,.5),true);
  assert.equal(triangleTouchesCell(face,0,.5,.5),false);
});

test('vertical cactus walls and contact along cell borders survive top-down projection',()=>{
  const face=triangle([.5,-1],[.5,2],[.5,2]);
  assert.equal(triangleTouchesCell(face,0,0,.5),true);
  assert.equal(triangleTouchesCell(face,.5,0,.5),true);
  assert.equal(triangleTouchesCell(face,1,0,.5),false);
});

test('empty triangular corners are excluded even when bounding rectangles overlap',()=>{
  const face=triangle([0,0],[2,0],[0,2]);
  assert.equal(triangleTouchesCell(face,1.5,1.5,.25),false);
  assert.equal(triangleTouchesCell(face,.25,.25,.25),true);
});
