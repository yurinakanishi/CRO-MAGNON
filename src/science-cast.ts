import * as THREE from 'three';
import { ATTACK_PROFILES } from '../shared/combat-profiles.mjs';

const armNames = ['UpperArmL', 'LowerArmL', 'HandL', 'UpperArmR', 'LowerArmR', 'HandR'];
const smooth = (value: number) => {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
};

/** Author only Howkey's arms; the delivered torso, feet, coat and hair keep their tracks. */
export function scienceAttackClip(root: THREE.Object3D, source: THREE.AnimationClip) {
  const arms = armNames.map((name) => {
    const bone = root.getObjectByName(name);
    if (!bone) throw new Error(`Science attack needs ${name}`);
    return bone;
  });
  const saved: { node: THREE.Object3D; p: THREE.Vector3; q: THREE.Quaternion; s: THREE.Vector3 }[] =
    [];
  root.traverse((node) =>
    saved.push({
      node,
      p: node.position.clone(),
      q: node.quaternion.clone(),
      s: node.scale.clone(),
    }),
  );
  const mixer = new THREE.AnimationMixer(root);
  const action = mixer.clipAction(source).setLoop(THREE.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  const duration = ATTACK_PROFILES.science.durationMs / 1000;
  const release = ATTACK_PROFILES.science.impactMs / 1000;
  const times: number[] = [],
    values = arms.map(() => [] as number[]);
  try {
    mixer.update(0);
    root.updateWorldMatrix(true, true);
    const neutral = arms.map((bone) => bone.quaternion.clone());
    const worldNeutral = arms.map((bone) => bone.getWorldQuaternion(new THREE.Quaternion()));
    const rootQ = root.getWorldQuaternion(new THREE.Quaternion());
    const up = new THREE.Vector3(0, 1, 0),
      from = new THREE.Vector3(),
      direction = new THREE.Vector3();
    const parentQ = new THREE.Quaternion(),
      desired = new THREE.Quaternion();
    // Prepare with a bent elbow, reach before the authoritative release, hold,
    // then withdraw. The right hand stays relaxed beside the body.
    const wind = [
      new THREE.Vector3(0.18, -0.68, 0.72),
      new THREE.Vector3(-0.08, 0.6, 1),
      new THREE.Vector3(0, 0.45, 1),
    ];
    const reach = [
      new THREE.Vector3(0.1, -0.12, 1),
      new THREE.Vector3(-0.08, 0.2, 1),
      new THREE.Vector3(0, 0.38, 1),
    ];
    const frames = Math.round(duration * 60);
    for (let frame = 0; frame <= frames; frame++) {
      const time = (frame / frames) * duration;
      action.time = Math.min(time, source.duration);
      mixer.update(0);
      arms.forEach((bone, i) => bone.quaternion.copy(neutral[i]));
      root.updateWorldMatrix(true, true);
      const extend = smooth((time - 0.18) / (release - 0.18 - 0.06));
      const weight =
        smooth(time / 0.18) * (1 - smooth((time - release - 0.12) / (duration - release - 0.12)));
      for (let i = 0; i < 3; i++) {
        const bone = arms[i];
        from.copy(up).applyQuaternion(worldNeutral[i]);
        direction.copy(wind[i]).lerp(reach[i], extend).normalize().applyQuaternion(rootQ);
        desired.setFromUnitVectors(from, direction).multiply(worldNeutral[i]);
        bone.parent!.getWorldQuaternion(parentQ).invert();
        desired.premultiply(parentQ);
        bone.quaternion.copy(neutral[i]).slerp(desired, weight).normalize();
        bone.updateWorldMatrix(false, true);
      }
      times.push(time);
      arms.forEach((bone, i) => values[i].push(...bone.quaternion.toArray()));
    }
    const clip = source.clone();
    clip.duration = duration;
    clip.tracks = clip.tracks.filter(
      (track) => !armNames.some((name) => track.name === `${name}.quaternion`),
    );
    arms.forEach((bone, i) =>
      clip.tracks.push(
        new THREE.QuaternionKeyframeTrack(`${bone.name}.quaternion`, times, values[i]),
      ),
    );
    return clip;
  } finally {
    mixer.stopAllAction();
    mixer.uncacheRoot(root);
    for (const { node, p, q, s } of saved) {
      node.position.copy(p);
      node.quaternion.copy(q);
      node.scale.copy(s);
    }
    root.updateWorldMatrix(true, true);
  }
}
