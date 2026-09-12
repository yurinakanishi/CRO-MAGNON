import * as THREE from 'three';

const inverseGrip = new THREE.Quaternion(),
  placement = new THREE.Quaternion(),
  aim = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0),
  forward = new THREE.Vector3();

const ease = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};

// This changes only the existing tool attachment; the hand position comes from
// the GLB Attack animation and the visible spear remains its verified TRELLIS GLB.
export function orientSpear(
  weapon,
  character,
  attacking,
  gripUp,
  authoredGrip = false,
  elapsedSeconds = 0,
) {
  weapon.position.set(0, 0, 0);
  // The two-handed clip authors the wrist and both grip sockets together. Keep
  // its shaft orientation through wind-up, impact, recovery and action blending.
  if (!attacking || authoredGrip) {
    weapon.quaternion.copy(gripUp);
    if (attacking && authoredGrip) {
      // Slide the shaft through the rear hand while taking the two-handed
      // stance. Its butt then sits 21 cm behind that hand, rather than 71 cm.
      const shift = 0.5 * ease(elapsedSeconds / 0.14) * (1 - ease((elapsedSeconds - 0.52) / 0.18));
      weapon.position.set(0, shift, 0).applyQuaternion(weapon.quaternion);
    }
    return;
  }
  character.updateMatrixWorld(true);
  weapon.parent.getWorldQuaternion(inverseGrip).invert();
  character.getWorldQuaternion(placement);
  forward.set(0, 0, 1).applyQuaternion(placement);
  aim.setFromUnitVectors(up, forward);
  weapon.quaternion.copy(inverseGrip.multiply(aim));
}
