// CMU's original ASF/AMC data: angular channels in degrees, lengths in ASF units.
// No generator, external rigging service, or third-party animation package is used.
import { readFile } from 'node:fs/promises';
import * as T from 'three';

export const CMU_METRES = ((1 / 0.45) * 2.54) / 100;
const vector = (a) => new T.Vector3(...a);
const rotation = (a) =>
  new T.Quaternion().setFromEuler(new T.Euler(...a.map(T.MathUtils.degToRad), 'ZYX'));
export async function readCmu(trial) {
  const text = await readFile(`assets/human-locomotion/source/${trial.split('_')[0]}.asf`, 'utf8');
  const bones = new Map();
  for (const block of text
    .split(':bonedata')[1]
    .split(':hierarchy')[0]
    .matchAll(/begin\s+([\s\S]*?)\s+end/g)) {
    const fields = Object.fromEntries(
      block[1]
        .trim()
        .split('\n')
        .map((l) => {
          const [k, ...v] = l.trim().split(/\s+/);
          return [k, v];
        }),
    );
    bones.set(fields.name[0], {
      name: fields.name[0],
      direction: vector(fields.direction.map(Number)),
      length: Number(fields.length[0]) * CMU_METRES,
      axis: rotation(fields.axis.slice(0, 3).map(Number)),
      dof: fields.dof || [],
      children: [],
    });
  }
  bones.set('root', { name: 'root', children: [] });
  for (const line of text.split(':hierarchy')[1].split('\n')) {
    const [parent, ...children] = line.trim().split(/\s+/);
    if (bones.has(parent)) bones.get(parent).children = children;
  }
  const frames = [];
  for (const line of (await readFile(`assets/human-locomotion/source/${trial}.amc`, 'utf8')).split(
    '\n',
  )) {
    if (/^\d+\s*$/.test(line)) frames.push({});
    else if (frames.length && /^[a-z]/.test(line)) {
      const [name, ...values] = line.trim().split(/\s+/);
      frames.at(-1)[name] = values.map(Number);
    }
  }
  const poses = frames.map((channels) => {
    const points = new Map();
    function visit(name, parent) {
      const b = bones.get(name),
        values = channels[name] || [];
      let p, q;
      if (name === 'root') {
        p = vector(values.slice(0, 3)).multiplyScalar(CMU_METRES);
        q = rotation(values.slice(3));
      } else {
        const angles = [0, 0, 0];
        b.dof.forEach((d, i) => {
          angles['xyz'.indexOf(d[1])] = values[i];
        });
        q = parent.q
          .clone()
          .multiply(b.axis)
          .multiply(rotation(angles))
          .multiply(b.axis.clone().invert());
        p = parent.end.clone();
      }
      const end =
        name === 'root'
          ? p.clone()
          : b.direction.clone().multiplyScalar(b.length).applyQuaternion(q).add(p);
      const result = { p, end, q };
      points.set(name, result);
      for (const child of b.children) visit(child, result);
    }
    visit('root');
    return points;
  });
  return { trial, bones, poses, fps: 120 };
}

// Remove only the trajectory's heading. Pelvis yaw/roll and the measured body
// motion remain, so an in-place actor can still shift weight naturally.
export function headingFor(poses, start, end) {
  const travel = poses[end].get('root').p.clone().sub(poses[start].get('root').p);
  return new T.Quaternion().setFromAxisAngle(
    new T.Vector3(0, 1, 0),
    -Math.atan2(travel.x, travel.z),
  );
}
