import { ADVENTURE_REGIONS, RIFTS } from './adventure-regions.mjs';

// Arrangement of the accepted TRELLIS models, with their original shapes.
// Mountain slopes are solid; the authored walking route runs between them.
const landmarks = [],
  props = [],
  fires = [],
  trees = [];
const add = (region, key, dx, dz, scale, yaw = 0, surface = null) =>
  landmarks.push(
    Object.freeze({
      id: `exploration-${region.id}-${landmarks.length}`,
      regionId: region.id,
      key,
      x: region.x + dx,
      z: region.z + dz,
      scale,
      yaw,
      surface,
      clearance: (key === 'volcanic-cone' ? 79 : key === 'glacier-spires' ? 11 : 3.3) * scale,
      groundOffset: -0.08,
    }),
  );
for (const r of ADVENTURE_REGIONS) {
  fires.push({
    id: `adventure-fire-${r.id}`,
    key: 'stone-firepit',
    x: r.camp.x + 3,
    z: r.camp.z - 1,
    yaw: 0,
    scale: 0.8,
  });
  props.push({
    id: `adventure-tent-${r.id}`,
    key: 'hide-tent',
    x: r.camp.x - 7,
    z: r.camp.z + 1,
    yaw: 0.5,
    scale: 0.8,
    biome: r.realm ? 'volcano' : undefined,
    surface: r.realm ? 'ash' : r.kind === '山岳' ? 'snow' : null,
  });
  for (const c of r.checkpoints)
    props.push({
      id: `marker-${c.id}`,
      key: 'valley-boulder',
      x: c.x + 3.8,
      z: c.z,
      yaw: 0.9,
      scale: 0.65,
      surface: r.realm ? 'ice' : r.kind === '峡谷' ? 'sand' : null,
    });
  if (r.id === 'high-pass') {
    for (const [dx, dz, scale, yaw] of [
      [-39, 11, 0.49, 0.3],
      [41, -2, 0.53, 1.9],
      [-41, -37, 0.42, 3.1],
      [36, -48, 0.38, 0.4],
    ])
      add(r, 'volcanic-cone', dx, dz, scale, yaw, 'alpine');
    add(r, 'glacier-spires', -19, -28, 1.05, 0.4);
  } else if (r.id === 'echo-valley') {
    for (const side of [-1, 1])
      for (let i = 0; i < 5; i++)
        add(
          r,
          'volcanic-basalt-columns',
          side * (15 + (i % 2) * 3),
          30 - i * 14,
          2.0 + (i % 2) * 0.3,
          i * 0.48 + side,
          'ochre',
        );
    for (const side of [-1, 1]) add(r, 'volcanic-cone', side * 52, -20, 0.43, side, 'ochre');
  } else if (r.id === 'stone-forest') {
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39996,
        rad = 21 + (i % 3) * 10;
      add(
        r,
        'volcanic-basalt-columns',
        Math.cos(a) * rad,
        Math.sin(a) * rad,
        1.2 + (i % 3) * 0.32,
        a,
        'moss',
      );
    }
    // Sparser grove ring (was 12) per the 2026-09-10 request.
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      trees.push({
        id: `grove-${i}`,
        key: 'valley-pine',
        x: r.x + Math.cos(a) * 52,
        z: r.z + Math.sin(a) * 52,
        yaw: a,
        scale: [1.05, 1.05, 1.05],
        height: 10.5,
      });
    }
  } else if (r.id === 'amber-oasis') {
    for (let i = 0; i < 9; i++) {
      const a = (i * Math.PI * 2) / 9;
      add(
        r,
        'volcanic-basalt-columns',
        Math.cos(a) * 32,
        Math.sin(a) * 26,
        1.3 + (i % 3) * 0.2,
        a,
        'ochre',
      );
    }
    for (let i = 0; i < 6; i++) {
      const a = (i * Math.PI) / 3;
      props.push({
        id: `oasis-bush-${i}`,
        key: 'berry-bush',
        x: r.x + 7 + Math.cos(a) * 9,
        z: r.z + Math.sin(a) * 7,
        yaw: a,
        scale: 1,
      });
    }
  } else if (r.id === 'blue-chasm') {
    for (const side of [-1, 1])
      for (let i = 0; i < 4; i++)
        add(
          r,
          'glacier-spires',
          side * (19 + (i % 2) * 2),
          30 - i * 20,
          1.2 + (i % 2) * 0.18,
          i * 0.4 + side,
        );
  } else {
    for (let i = 0; i < 14; i++) {
      const a = (i * Math.PI * 2) / 14;
      add(
        r,
        'volcanic-basalt-columns',
        Math.cos(a) * 39,
        Math.sin(a) * 38,
        1.7 + (i % 3) * 0.32,
        a,
        'shadow',
      );
    }
    for (const side of [-1, 1]) add(r, 'glacier-spires', side * 24, -16, 1.25, side, 'shadow');
  }
}
for (const rift of RIFTS) {
  const r = ADVENTURE_REGIONS.find((r) => Math.hypot(r.x - rift.x, r.z - rift.z) < r.radius);
  for (const side of [-1, 1])
    add(r, 'volcanic-basalt-columns', rift.x - r.x + side * 5, rift.z - r.z, 1.0, side, 'rift');
}
export const ADVENTURE_LANDMARKS = Object.freeze(landmarks);
export const ADVENTURE_SCENERY = Object.freeze({
  props: Object.freeze(props),
  fires: Object.freeze(fires),
  trees: Object.freeze(trees),
});
