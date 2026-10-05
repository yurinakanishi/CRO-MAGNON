import * as THREE from 'three';

/** Typography projected into the limestone, without a signboard or a decal mesh. */
export function createCavePreviewLabel() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#723c24';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.font = 'bold 210px Georgia, serif';
  context.fillText('Coming Soon', 1024, 220);
  context.font = '72px sans-serif';
  context.fillText('近日登場', 1024, 403);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
