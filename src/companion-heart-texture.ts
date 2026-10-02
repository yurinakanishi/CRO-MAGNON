import * as THREE from 'three';

/** Shared appearance for the companions' small, rising affection hearts. */
export function companionHeartTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.moveTo(64, 111);
  ctx.bezierCurveTo(53, 97, 10, 68, 10, 40);
  ctx.bezierCurveTo(10, 10, 49, 7, 64, 32);
  ctx.bezierCurveTo(79, 7, 118, 10, 118, 40);
  ctx.bezierCurveTo(118, 68, 75, 97, 64, 111);
  ctx.closePath();
  ctx.fillStyle = '#ff689d';
  ctx.fill();
  ctx.lineWidth = 5;
  ctx.strokeStyle = '#ffe5ed';
  ctx.stroke();
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
