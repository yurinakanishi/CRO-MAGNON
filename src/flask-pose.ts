import * as THREE from 'three';

const inverseGrip = new THREE.Quaternion(),
  placement = new THREE.Quaternion();

/**
 * Howkey carries her Erlenmeyer flask by the neck in the right hand. Its pivot is
 * the neck grip, so the body hangs below the fist; the flask stays level with the
 * character (liquid upright) whatever the arm's swing.
 */
export function orientFlask(flask: THREE.Object3D, character: THREE.Object3D) {
  const grip = flask.parent;
  if (!grip) return;
  grip.updateWorldMatrix(true, false);
  grip.getWorldQuaternion(inverseGrip).invert();
  character.getWorldQuaternion(placement);
  flask.position.set(0, 0, 0);
  flask.quaternion.copy(inverseGrip.multiply(placement));
}

/** The free right hand shows the flask unless it is busy with a tool, a companion or a craft. */
export function flaskVisible(
  p: { fishing?: unknown; coastalActivity?: unknown },
  clip: string | undefined,
  oneShot: boolean,
  handsBusy: boolean,
) {
  return (
    !handsBusy &&
    !p.fishing &&
    !p.coastalActivity &&
    (!oneShot || clip === 'Attack' || clip === 'Wave')
  );
}
