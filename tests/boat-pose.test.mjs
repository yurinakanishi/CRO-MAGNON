import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {geometryScene} from '../scripts/measure-collision-bounds.mjs';
import {RidingPose} from '../dist/src/riding-pose.js';
import {CharacterAnimation} from '../dist/src/character-animation.js';
import {CHARACTER_MODELS} from '../dist/shared/characters.mjs';
test('six exact delivered skins sit on the canoe socket with feet inside its cockpit and restore walking',async()=>{
  const hull=await geometryScene('public/models/dugout-canoe/model.glb'),bounds=new THREE.Box3().setFromObject(hull.scene),seat=new THREE.Vector3(0,.67,-1.3);
  for(const profile of CHARACTER_MODELS){
    const gltf=await geometryScene(`public/models/${profile.key}/model.glb`),group=new THREE.Group();group.add(gltf.scene);
    const pose=new RidingPose(gltf.scene),animation=new CharacterAnimation(gltf.scene,gltf.animations,{walkSpeed:1,runSpeed:3});
    for(let i=0;i<20;i++){
      pose.update(animation,i*.1,7,true);group.position.copy(seat).sub(pose.pelvisOffset(new THREE.Vector3()));group.updateMatrixWorld(true);
      assert.ok(pose.hips.getWorldPosition(new THREE.Vector3()).distanceTo(seat)<1e-5);
      for(const name of ['FootL','FootR']){const point=pose.bones.get(name).bone.getWorldPosition(new THREE.Vector3());assert.ok(Math.abs(point.x)<bounds.max.x-.2,profile.key);assert.ok(point.y>.37,profile.key);assert.ok(point.z>seat.z&&point.z<bounds.max.z-.5,profile.key);}
    }
    pose.leave(animation);for(const {bone,q,p}of pose.bones.values()){assert.ok(bone.quaternion.equals(q));assert.ok(bone.position.distanceTo(p)<1e-8);}
    animation.update(.1,1);assert.equal(animation.name,'Walk_Loop');animation.dispose();
  }
});
