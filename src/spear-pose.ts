import * as THREE from 'three';

const inverseGrip = new THREE.Quaternion(),
  placement = new THREE.Quaternion(),
  aim = new THREE.Quaternion();
const up = new THREE.Vector3(0, 1, 0),
  forward = new THREE.Vector3();

// This changes only the existing tool attachment; the hand position comes from
// the GLB Attack animation and the visible spear remains its verified TRELLIS GLB.
export function orientSpear(weapon, character, attacking, gripUp) {
  if (!attacking) {
    weapon.quaternion.copy(gripUp);
    return;
  }
  character.updateMatrixWorld(true);
  weapon.parent.getWorldQuaternion(inverseGrip).invert();
  character.getWorldQuaternion(placement);
  forward.set(0, 0, 1).applyQuaternion(placement);
  aim.setFromUnitVectors(up, forward);
  weapon.quaternion.copy(inverseGrip.multiply(aim));
}
