import * as THREE from 'three';

/** One forward somersault, easing into release and out before landing. */
export function botFlightTurn(progress: number) {
  const t = THREE.MathUtils.clamp(progress, 0, 1);
  return Math.PI * 2 * t * t * (3 - 2 * t);
}

const rotatedCenter = new THREE.Vector3();

/** Ground-centred models rotate around their body, without orbiting their feet. */
export function applyBotFlightTurn(
  root: THREE.Object3D,
  position: THREE.Vector3,
  facing: number,
  progress: number,
  centerHeight: number,
) {
  root.rotation.set(botFlightTurn(progress), facing, 0, 'YXZ');
  rotatedCenter.set(0, centerHeight, 0).applyQuaternion(root.quaternion);
  root.position.copy(position).sub(rotatedCenter);
  root.position.y += centerHeight;
}
