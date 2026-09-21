import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { woodPileLayout } from '../shared/wood-pile-layout.mjs';
import { WorldAssets } from './world-assets.js';
import { attachSimplifiedShadow, disposeSimplifiedShadow } from './performance-lod.js';

/** Each instance is one entire verified image-to-3D log, including both ends. */
export function buildWoodPile(assets: WorldAssets, total: number, surface: string | null) {
  const key = 'firewood-log';
  const template = assets.get(key, surface);
  const slots = woodPileLayout(total);
  const root = new THREE.LOD();
  root.name = 'wood-pile';
  root.userData.assetKey = key;
  root.userData.regionalSurface = surface;
  const batches: THREE.InstancedMesh[] = [];
  const placement = new THREE.Matrix4();
  const transform = new THREE.Matrix4();
  for (const [level, source] of [template.gltf, ...template.lods].entries()) {
    const group = new THREE.Group();
    group.visible = level === 0;
    source.scene.updateMatrixWorld(true);
    source.scene.traverse((node) => {
      if (!isMesh(node)) return;
      const batch = new THREE.InstancedMesh(node.geometry, node.material, slots.length);
      batch.name = 'whole-firewood-logs';
      batch.castShadow = node.castShadow;
      batch.receiveShadow = node.receiveShadow;
      for (const [index, slot] of slots.entries()) {
        placement.makeRotationY(slot.yaw).setPosition(slot.x, slot.y, slot.z);
        transform.multiplyMatrices(placement, node.matrixWorld);
        batch.setMatrixAt(index, transform);
      }
      batch.instanceMatrix.needsUpdate = true;
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      group.add(batch);
      batches.push(batch);
    });
    root.addLevel(group, level === 0 ? 0 : level === 1 ? 10 : 22, 0.15);
  }
  attachSimplifiedShadow(root, key);
  return {
    root,
    setAmount(amount: number) {
      const count = Math.max(0, Math.min(slots.length, Math.floor(amount)));
      for (const batch of batches) batch.count = count;
      root.visible = count > 0;
    },
    dispose() {
      // Only the instance buffers belong to this pile. Templates own the mesh and material.
      for (const batch of batches) batch.dispose();
      disposeSimplifiedShadow(root);
    },
  };
}
