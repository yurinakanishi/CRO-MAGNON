import * as THREE from 'three';

const inverseGrip = new THREE.Quaternion(),
  placement = new THREE.Quaternion(),
  aim = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0),
  direction = new THREE.Vector3(),
  next = new THREE.Vector3();
const poses: [number, number[]][] = [
  [0, [0, 1, 0]],
  [4 / 30, [0.15, 0.97, -0.2]],
  [8 / 30, [0, -0.18, 1]],
  [12 / 30, [-0.65, -0.45, 0.62]],
  [0.6, [0, 1, 0]],
];

// The katana is an unchanged TRELLIS mesh at the animated palm socket. Its
// cutting direction follows the same windup/impact/recovery as the body clip.
export function orientKatana(weapon, character, attacking, elapsed, gripUp) {
  if (!attacking) {
    weapon.quaternion.copy(gripUp);
    return;
  }
  let a = poses[0],
    b = poses[1];
  for (let i = 1; i < poses.length; i++) {
    a = poses[i - 1];
    b = poses[i];
    if (elapsed <= b[0]) break;
  }
  let t = THREE.MathUtils.clamp((elapsed - a[0]) / (b[0] - a[0]), 0, 1);
  t = t * t * (3 - 2 * t);
  direction.fromArray(a[1]).lerp(next.fromArray(b[1]), t).normalize();
  character.updateMatrixWorld(true);
  weapon.parent.getWorldQuaternion(inverseGrip).invert();
  character.getWorldQuaternion(placement);
  direction.applyQuaternion(placement);
  aim.setFromUnitVectors(up, direction);
  weapon.quaternion.copy(inverseGrip.multiply(aim));
}
