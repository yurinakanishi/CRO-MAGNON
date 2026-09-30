// Synthetic open palms for deterministic tests, never camera data.
const shape = [
  [0, 0],
  [-30, -8],
  [-40, -20],
  [-46, -35],
  [-52, -47],
  [-24, -45],
  [-26, -67],
  [-27, -85],
  [-27, -103],
  [0, -50],
  [0, -78],
  [0, -98],
  [0, -120],
  [16, -46],
  [18, -72],
  [18, -92],
  [18, -107],
  [24, -38],
  [31, -57],
  [33, -74],
  [35, -88],
];
export const controlScale = (Math.hypot(48, 7) * 3) / 640;
export function syntheticHand(
  side,
  {
    x = 0,
    y = 0,
    push = 0,
    fold = false,
    gun = false,
    folded = [],
    thumbFold = false,
    onlyFingers = 1,
    flatness = 1,
    roll = 0,
    yaw = 0,
    pitch = 0,
  } = {},
) {
  const wristX = (side === 'left' ? 0.62 : 0.38) - x * controlScale;
  const wristY = 0.6 + (y * controlScale * 640) / 480;
  const scale = 1 + push;
  const landmarks = shape.map(([px, py], i) => ({
    x: wristX + (px * (side === 'left' ? 1 : -1) * flatness * scale) / 640,
    y: wristY + (py * scale) / 480,
    z: 0,
  }));
  for (const i of [5, 9, 13, 17]) {
    const base = landmarks[i],
      wrist = landmarks[0];
    for (let j = 1; j <= 3; j++) {
      const p = landmarks[i + j];
      if (fold || folded.includes(i) || (gun && (i === 13 || i === 17))) {
        p.x = base.x + (wrist.x - base.x) * j * 0.1;
        p.y = base.y + (wrist.y - base.y) * j * 0.1;
      } else {
        p.x = base.x + (p.x - base.x) * onlyFingers;
        p.y = base.y + (p.y - base.y) * onlyFingers;
      }
    }
  }
  if (thumbFold) {
    landmarks[3] = { x: landmarks[2].x * 0.6 + wristX * 0.4, y: landmarks[2].y, z: 0 };
    landmarks[4] = { x: wristX, y: wristY - 0.04, z: 0 };
  }
  if (pitch)
    for (const p of landmarks) {
      const dy = ((p.y - wristY) * 480) / 640;
      p.y = wristY + (dy * Math.cos(pitch) * 640) / 480;
      p.z = dy * Math.sin(pitch);
    }
  if (roll)
    for (const p of landmarks) {
      const px = (p.x - wristX) * 640,
        py = (p.y - wristY) * 480;
      p.x = wristX + (px * Math.cos(roll) - py * Math.sin(roll)) / 640;
      p.y = wristY + (px * Math.sin(roll) + py * Math.cos(roll)) / 480;
    }
  if (yaw)
    for (const p of landmarks) {
      const px = p.x - wristX;
      p.x = wristX + px * Math.cos(yaw);
      const z = p.z;
      p.x = wristX + px * Math.cos(yaw) + z * Math.sin(yaw);
      p.z = z * Math.cos(yaw) - px * Math.sin(yaw);
    }
  return { landmarks, handednessScore: 0.98 };
}
export function syntheticHands(move, act, swapped = false) {
  return {
    left: syntheticHand('left', swapped ? act : move),
    right: syntheticHand('right', swapped ? move : act),
  };
}
