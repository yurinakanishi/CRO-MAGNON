import type { BufferAttribute, InstancedMesh } from 'three';

// Call after rewriting the complete active prefix. Unused capacity does not
// need uploading; each instance matrix contains 16 float components.
export function markActiveAttribute(attribute: BufferAttribute, count: number): number {
  if (count === 0) return 0;
  attribute.clearUpdateRanges();
  attribute.addUpdateRange(0, count * attribute.itemSize);
  attribute.needsUpdate = true;
  return count * attribute.itemSize * attribute.array.BYTES_PER_ELEMENT;
}

export function markActiveInstances(mesh: InstancedMesh): number {
  return markActiveAttribute(mesh.instanceMatrix, mesh.count);
}
