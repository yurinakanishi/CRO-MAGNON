import * as THREE from 'three';
import { COMPANION_524, type Companion524Snapshot } from '../shared/companion-524.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import { isMesh } from './three-types.js';
import { VisibleActorGroup } from './visible-actor-group.js';
import type { WorldRenderer } from './world3d.js';

/** Additive placement motion; the delivered bones and Floating_Ripple stay intact. */
export function companion524Pose(c: Companion524Snapshot, now: number) {
  const happyAge = c.petSequence > 0 ? now - c.petAt : Infinity;
  const hitAge = c.hitSequence > 0 ? now - c.hitAt : Infinity;
  const hit = hitAge >= 0 && hitAge < COMPANION_524.hitMs;
  const happy = !hit && happyAge >= 0 && happyAge < COMPANION_524.happyMs;
  const hp = hit ? hitAge / COMPANION_524.hitMs : 0;
  const jp = happy ? happyAge / COMPANION_524.happyMs : 0;
  const kick = hit ? Math.sin(hp * Math.PI) * (1 - hp) : 0;
  const bounce = happy ? Math.sin(jp * Math.PI * 3) ** 2 * (1 - jp) : 0;
  return {
    reaction: hit ? 'hit' : happy ? 'happy' : 'floating',
    height: COMPANION_524.hoverHeight + kick * 0.23 + bounce * 0.2,
    pitch:
      kick * 0.38 * (c.hitDirectionX * Math.sin(c.facing) + c.hitDirectionZ * Math.cos(c.facing)),
    roll:
      kick * 0.38 * (-c.hitDirectionX * Math.cos(c.facing) + c.hitDirectionZ * Math.sin(c.facing)) +
      (happy ? Math.sin(jp * Math.PI * 6) * Math.sin(jp * Math.PI) * 0.12 : 0),
    happyAge: happy ? happyAge : -1,
  };
}

function heartTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(64, 111);
  ctx.bezierCurveTo(53, 97, 10, 68, 10, 40);
  ctx.bezierCurveTo(10, 10, 49, 7, 64, 32);
  ctx.bezierCurveTo(79, 7, 118, 10, 118, 40);
  ctx.bezierCurveTo(118, 68, 75, 97, 64, 111);
  ctx.closePath();
  ctx.fillStyle = '#ff689d';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffe5ed';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Companion524Renderer {
  readonly root = new VisibleActorGroup();
  readonly tilt = new THREE.Group();
  readonly actor: ReturnType<WorldRenderer['worldAssets']['createAnimal']>;
  readonly hearts: THREE.Sprite[] = [];
  readonly texture = heartTexture();
  readonly label: ReturnType<WorldRenderer['createLabel']>;
  private placed = false;
  private floor = 0;
  private reaction = 'floating';

  constructor(private world: WorldRenderer) {
    this.root.name = '524 floating companion';
    this.actor = world.worldAssets.createAnimal(COMPANION_524.modelKey, 'Floating_Ripple');
    this.actor.update(0.25);
    this.actor.root.scale.setScalar(COMPANION_524.scale);
    this.root.userData.animalId = COMPANION_524.id;
    this.tilt.add(this.actor.root);
    this.root.add(this.tilt);
    world.scene.add(this.root);
    this.label = world.createLabel('524', 'companion', new THREE.Vector3());
    for (let i = 0; i < 5; i++) {
      const heart = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: this.texture,
          transparent: true,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      heart.visible = false;
      heart.raycast = () => {};
      this.hearts.push(heart);
      world.scene.add(heart);
    }
  }

  update(dt: number) {
    const c = this.world.state.companion524;
    if (!c) {
      this.root.visible = false;
      this.label.active = false;
      for (const heart of this.hearts) heart.visible = false;
      return;
    }
    const now = this.world.serverNow();
    const pose = companion524Pose(c, now);
    this.reaction = pose.reaction;
    const ground = walkHeight(c.x, c.z);
    const blend = 1 - Math.exp(-dt * 14);
    if (!this.placed || Math.hypot(this.root.position.x - c.x, this.root.position.z - c.z) > 25) {
      this.root.position.set(c.x, ground + pose.height, c.z);
      this.root.rotation.y = c.facing;
      this.floor = ground;
      this.placed = true;
    } else {
      this.root.position.x += (c.x - this.root.position.x) * blend;
      this.root.position.z += (c.z - this.root.position.z) * blend;
    }
    // Float above the actual floor, including the interpolated position on slopes.
    const floor = Math.max(ground, walkHeight(this.root.position.x, this.root.position.z));
    this.floor = Math.max(floor, this.floor + (floor - this.floor) * blend);
    this.root.position.y = this.floor + pose.height;
    const delta = Math.atan2(
      Math.sin(c.facing - this.root.rotation.y),
      Math.cos(c.facing - this.root.rotation.y),
    );
    this.root.rotation.y += delta * blend;
    this.tilt.rotation.set(pose.pitch, 0, pose.roll);
    const distance = this.root.position.distanceTo(this.world.camera.position);
    this.root.visible = distance < 85;
    if (this.root.visible) {
      // Absolute server phase also resumes correctly after culling or a late join.
      this.actor.mixer.setTime((now / 1000) % 4);
      this.actor.root.traverse((node) => {
        if (isMesh(node)) node.castShadow = distance < 34;
      });
    }
    this.label.active = this.root.visible && distance < 20;
    this.label.position.copy(this.root.position).add(new THREE.Vector3(0, 0.82, 0));
    for (const [i, heart] of this.hearts.entries()) {
      const age = (pose.happyAge - i * 160) / 1200;
      heart.visible = this.root.visible && pose.happyAge >= 0 && age > 0 && age < 1;
      if (!heart.visible) continue;
      heart.position.set(
        this.root.position.x + Math.sin(i * 2.4) * (0.28 + age * 0.38),
        this.root.position.y + 0.55 + age * 0.85,
        this.root.position.z + Math.cos(i * 2.4) * 0.35,
      );
      heart.scale.setScalar(0.22 + Math.sin(age * Math.PI) * 0.1);
      heart.material.opacity = Math.sin(age * Math.PI);
    }
  }

  diagnostics() {
    return {
      visible: this.root.visible,
      clip: this.actor.name,
      time: this.actor.mixer.time,
      reaction: this.reaction,
      hearts: this.hearts.filter((h) => h.visible).length,
      x: this.root.position.x,
      y: this.root.position.y,
      z: this.root.position.z,
      floor: this.floor,
      scale: COMPANION_524.scale,
    };
  }

  dispose() {
    this.world.scene.remove(this.root, ...this.hearts);
    this.actor.dispose();
    for (const heart of this.hearts) heart.material.dispose();
    this.texture.dispose();
    this.label.element.remove();
    const index = this.world.labels.indexOf(this.label);
    if (index >= 0) this.world.labels.splice(index, 1);
  }
}
