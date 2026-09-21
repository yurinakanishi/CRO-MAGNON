import * as THREE from 'three';

/** Actor wrappers are distance-culled before rendering. Avoid walking their
 * hidden skeletons each frame; direct world-space queries still use the normal
 * updateWorldMatrix method, and explicit forced updates remain supported. */
export class VisibleActorGroup extends THREE.Group {
  override updateMatrixWorld(force?: boolean) {
    if (!this.visible && !force) return;
    super.updateMatrixWorld(force);
  }
}
