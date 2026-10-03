import * as THREE from 'three';
import { walkHeight } from '../shared/terrain.mjs';
import type { WorldRenderer } from './world3d.js';

/** Lightweight ground contact effect: one instanced draw, no shadow-map pass. */
export class ContactShadows {
  private texture: THREE.CanvasTexture;
  private mesh: THREE.InstancedMesh;
  private matrix = new THREE.Matrix4();
  private position = new THREE.Vector3();
  private scale = new THREE.Vector3();
  private rotation = new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(1, 0, 0),
    -Math.PI / 2,
  );
  constructor(private world: WorldRenderer) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const context = canvas.getContext('2d')!;
    const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
    gradient.addColorStop(0, 'rgba(24,31,22,0.28)');
    gradient.addColorStop(0.4, 'rgba(24,31,22,0.18)');
    gradient.addColorStop(1, 'rgba(24,31,22,0)');
    context.fillStyle = gradient;
    context.fillRect(0, 0, 64, 64);
    this.texture = new THREE.CanvasTexture(canvas);
    this.mesh = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({
        map: this.texture,
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
      }),
      128,
    );
    this.mesh.name = 'lightweight ground contacts';
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 1;
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    world.scene.add(this.mesh);
  }
  update() {
    this.mesh.visible = this.world.graphics.tier === 'low';
    if (!this.mesh.visible) return;
    let count = 0;
    const add = (root: THREE.Object3D | undefined, radius: number) => {
      if (!root?.visible || count >= 128) return;
      root.getWorldPosition(this.position);
      if (this.position.distanceToSquared(this.world.camera.position) > 25 * 25) return;
      const floor = walkHeight(this.position.x, this.position.z),
        height = this.position.y - floor;
      if (height > 2.5 || height < -0.2) return;
      this.position.y = floor + 0.025;
      this.scale.setScalar(radius * 2 * (1 + Math.max(0, height) * 0.15));
      this.mesh.setMatrixAt(count++, this.matrix.compose(this.position, this.rotation, this.scale));
    };
    for (const p of this.world.players.values())
      if (!p.state.boatId && !p.state.mountId && !p.state.carrierId)
        add(p.model, p.state.radius ?? 0.32);
    for (const a of this.world.mammoths) add(a.model, 0.85);
    for (const b of this.world.orbBotRenderer?.bots.values() ?? []) add(b.actor.root, 0.16);
    add(this.world.rimoNekoRenderer?.root, 0.28);
    add(this.world.maeRenderer?.root, 0.24);
    add(this.world.companion524Renderer?.root, 0.18);
    this.mesh.count = count;
    this.mesh.instanceMatrix.clearUpdateRanges();
    if (count) {
      this.mesh.instanceMatrix.addUpdateRange(0, count * 16);
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }
  dispose() {
    this.mesh.removeFromParent();
    this.mesh.dispose();
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
