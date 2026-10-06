import * as THREE from 'three';
import { CAVE_TORCH } from '../shared/cave-light.mjs';
import type { WorldAssets } from './world-assets.js';
import { TorchGrasp } from './torch-grasp.js';

const up = new THREE.Vector3(0, 1, 0);

/** Reversible left-arm hold over the delivered rig's walking animation. */
export class TorchHoldPose {
  private arm: THREE.Object3D[];
  readonly grip: THREE.Object3D;
  private base: THREE.Quaternion[];
  private rest: THREE.Quaternion[];
  private lengths: number[];
  private applied = false;
  readonly attachment = new THREE.Quaternion();
  weight = 0;

  constructor(
    private actor: THREE.Object3D,
    private grasp?: TorchGrasp,
  ) {
    this.arm = ['UpperArmL', 'LowerArmL', 'HandL'].map((name) => actor.getObjectByName(name)!);
    this.grip = grasp?.grip ?? actor.getObjectByName('GripL')!;
    if (this.arm.some((b) => !b) || !this.grip)
      throw new Error('Torch requires the delivered left arm and grip');
    actor.updateWorldMatrix(true, true);
    this.base = this.arm.map((b) => b.quaternion.clone());
    this.rest = this.base.map((q) => q.clone());
    const positions = this.arm.map((b) => b.getWorldPosition(new THREE.Vector3()));
    this.lengths = [positions[0].distanceTo(positions[1]), positions[1].distanceTo(positions[2])];
  }

  restore() {
    if (this.applied) this.arm.forEach((b, i) => b.quaternion.copy(this.base[i]));
    this.applied = false;
    this.grasp?.update(0);
  }

  private aim(index: number, direction: THREE.Vector3) {
    const bone = this.arm[index],
      child = this.arm[index + 1] ?? this.grip;
    const from = child
      .getWorldPosition(new THREE.Vector3())
      .sub(bone.getWorldPosition(new THREE.Vector3()))
      .normalize();
    const q = bone.getWorldQuaternion(new THREE.Quaternion());
    q.premultiply(new THREE.Quaternion().setFromUnitVectors(from, direction));
    bone.quaternion.copy(
      bone.parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(q),
    );
    bone.updateWorldMatrix(false, true);
  }

  update(active: boolean, dt: number) {
    this.restore();
    this.weight += ((active ? 1 : 0) - this.weight) * (1 - Math.exp(-dt * 12));
    if (this.weight < 0.001) return;
    this.arm.forEach((b, i) => {
      this.base[i].copy(b.quaternion);
      b.quaternion.copy(this.rest[i]);
    });
    this.actor.updateWorldMatrix(true, true);
    const rootQ = this.actor.getWorldQuaternion(new THREE.Quaternion());
    const shoulder = this.arm[0].getWorldPosition(new THREE.Vector3());
    const reach = this.lengths[0] + this.lengths[1];
    // The delivered rigs face +Z: their anatomical left is +X. Keep the
    // wrist outside the shoulder and let the upper arm hang down beside the ribs.
    const axis = new THREE.Vector3(0.32, -0.2, 0.53).applyQuaternion(rootQ);
    const distance = Math.min(
      reach - 0.002,
      Math.max(Math.abs(this.lengths[0] - this.lengths[1]) + 0.002, reach * axis.length()),
    );
    axis.normalize();
    const target = shoulder.clone().addScaledVector(axis, distance);
    const bend = new THREE.Vector3(0.5, -1, -0.35).applyQuaternion(rootQ);
    bend.addScaledVector(axis, -bend.dot(axis)).normalize();
    const [a, b] = this.lengths;
    const along = (a * a - b * b + distance * distance) / (2 * distance);
    const elbow = shoulder
      .clone()
      .addScaledVector(axis, along)
      .addScaledVector(bend, Math.sqrt(Math.max(0, a * a - along * along)));
    this.aim(0, elbow.clone().sub(shoulder).normalize());
    this.aim(1, target.clone().sub(elbow).normalize());
    // The palm continues the forearm, with only a small extension at the wrist.
    const fingers = new THREE.Vector3(0, 0.1, 1).normalize().applyQuaternion(rootQ);
    const shaft = new THREE.Vector3(0.12, 1, -0.1).normalize().applyQuaternion(rootQ);
    const normal = new THREE.Vector3().crossVectors(fingers, shaft).normalize();
    shaft.crossVectors(normal, fingers).normalize();
    const localFrame = new THREE.Matrix4().makeBasis(
      this.grasp?.normal ?? new THREE.Vector3(-1, 0, 0),
      up,
      this.grasp?.width ?? new THREE.Vector3(0, 0, -1),
    );
    const handQ = new THREE.Quaternion().setFromRotationMatrix(
      new THREE.Matrix4().makeBasis(normal, fingers, shaft).multiply(localFrame.invert()),
    );
    this.arm[2].quaternion.copy(
      this.arm[2].parent!.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(handQ),
    );
    this.arm[2].updateWorldMatrix(false, true);
    const upright = new THREE.Quaternion().setFromUnitVectors(up, shaft);
    this.attachment
      .copy(this.grip.getWorldQuaternion(new THREE.Quaternion()).invert())
      .multiply(upright);
    this.arm.forEach((bone, i) =>
      bone.quaternion.slerpQuaternions(this.base[i], bone.quaternion.clone(), this.weight),
    );
    this.actor.updateWorldMatrix(true, true);
    this.grasp?.update(this.weight);
    this.applied = true;
  }
}

/** The complete verified TRELLIS firewood mesh, held as a burning brand.
 * Only flame particles and illumination are procedural; no replacement mesh. */
export class CaveTorch {
  readonly root = new THREE.Group();
  readonly light = new THREE.PointLight('#ffd09a', 0, CAVE_TORCH.distance, CAVE_TORCH.decay);
  readonly pose: TorchHoldPose;
  private flame: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;
  private flameHeight: number;
  private grasp: TorchGrasp;

  constructor(
    private scene: THREE.Scene,
    assets: WorldAssets,
    actor: THREE.Object3D,
    height: number,
  ) {
    const diameter = THREE.MathUtils.clamp(height * 0.021, 0.017, 0.044);
    this.grasp = new TorchGrasp(actor, diameter);
    this.pose = new TorchHoldPose(actor, this.grasp);
    this.root.name = 'held-cave-torch';
    const length = Math.min(0.68, Math.max(0.42, height * 0.39));
    const wood = assets.create('firewood-log', 1);
    wood.rotation.z = Math.PI / 2;
    // Grip diameter is about 3.5 cm for an adult, scaled for smaller/larger hands.
    wood.scale.set(length / 1.2, diameter / 0.37, diameter / 0.37);
    const bounds = new THREE.Box3().setFromObject(wood);
    wood.position.sub(bounds.getCenter(new THREE.Vector3()));
    wood.position.y += length * 0.26;
    this.root.add(wood);
    this.flameHeight = length * 0.76;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(18 * 3), 3));
    const material = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: { pixelScale: { value: 1 } },
      vertexShader:
        'uniform float pixelScale;varying float heat;void main(){heat=position.y;vec4 v=modelViewMatrix*vec4(position,1.0);gl_PointSize=clamp(52.0*pixelScale*(1.0-heat)/max(.5,-v.z),1.0,55.0);gl_Position=projectionMatrix*v;}',
      fragmentShader:
        'varying float heat;void main(){vec2 p=gl_PointCoord*2.0-1.0;float a=pow(max(0.0,1.0-dot(p,p)),2.0);gl_FragColor=vec4(mix(vec3(1.0,.68,.15),vec3(1.0,.12,.008),clamp(heat*2.5,0.0,1.0)),a*.65);}',
    });
    this.flame = new THREE.Points(geometry, material);
    this.flame.frustumCulled = false;
    this.flame.position.y = this.flameHeight;
    this.root.add(this.flame);
    this.root.visible = this.light.visible = false;
    scene.add(this.root, this.light);
  }

  update(active: boolean, time: number, dt: number, pixelRatio: number, lit = active) {
    if (!active) {
      this.hide();
      return;
    }
    this.pose.update(active, dt);
    this.root.visible = active;
    this.flame.visible = this.light.visible = lit;
    this.pose.grip.getWorldPosition(this.root.position);
    // Follow the same hand rotation throughout the blended reach into the hold.
    this.pose.grip.getWorldQuaternion(this.root.quaternion).multiply(this.pose.attachment);
    this.root.updateMatrixWorld(true);
    this.light.position.copy(
      this.root.localToWorld(new THREE.Vector3(0, this.flameHeight + 0.08, 0)),
    );
    if (!lit) {
      this.light.intensity = 0;
      return;
    }
    this.light.intensity =
      CAVE_TORCH.intensity * (1 + Math.sin(time * 11) * 0.055 + Math.sin(time * 17.3) * 0.025);
    this.flame.material.uniforms.pixelScale.value = pixelRatio;
    const points = this.flame.geometry.attributes.position;
    for (let i = 0; i < points.count; i++) {
      const life = (time * 1.7 + i / points.count) % 1;
      points.setXYZ(
        i,
        Math.sin(i * 23 + time * 3) * 0.035 * (1 - life),
        life * 0.27,
        Math.cos(i * 17 + time * 2) * 0.035 * (1 - life),
      );
    }
    points.needsUpdate = true;
  }

  hide() {
    this.root.visible = this.light.visible = false;
    this.pose.restore();
    this.pose.weight = 0;
  }

  dispose() {
    this.hide();
    this.grasp.dispose();
    this.scene.remove(this.root, this.light);
    this.flame.geometry.dispose();
    this.flame.material.dispose();
    this.light.dispose();
    // Original firewood geometry/material/texture remain owned by WorldAssets.
  }
}
