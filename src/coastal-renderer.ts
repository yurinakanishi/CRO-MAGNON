import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { SHELL_BEDS, MIDDEN_SITES, KNAPPING_SITES, middenScale } from '../shared/coastal-sites.mjs';
import { walkHeight } from '../shared/terrain.mjs';

// All visible geometry is adopted image-to-3D geometry. Copies share mesh and texture data.
export class CoastalRenderer {
  world: any;
  labels = new Map<string, any>();
  tables = new Map<string, THREE.Object3D>();
  middens = new Map<string, THREE.Object3D>();
  blades = new Map<string, THREE.Object3D>();
  shells: THREE.InstancedMesh[] = [];
  assets = new Map<string, { ready: boolean; lastUsed: number }>();
  nextUpdate = 0;
  disposed = false;
  constructor(world) {
    this.world = world;
    for (const s of [...SHELL_BEDS, ...MIDDEN_SITES, ...KNAPPING_SITES])
      this.labels.set(
        s.id,
        world.createLabel(s.name, 'gulf', new THREE.Vector3(s.x, walkHeight(s.x, s.z) + 1.1, s.z)),
      );
  }
  request(key, time) {
    const existing = this.assets.get(key);
    if (existing) {
      existing.lastUsed = time;
      return existing.ready;
    }
    const record = { ready: false, lastUsed: time };
    this.assets.set(key, record);
    this.world.worldAssets
      .ensureEnvironment(key)
      .then(() => {
        if (this.disposed) return;
        record.ready = true;
        if (key === 'cockle-shell') {
          const template = this.world.worldAssets.get(key).gltf.scene;
          template.updateMatrixWorld(true);
          template.traverse((node) => {
            if (!isMesh(node)) return;
            const mesh = new THREE.InstancedMesh(
              node.geometry,
              node.material,
              SHELL_BEDS.length * 12,
            );
            mesh.userData.sourceTransform = node.matrixWorld.clone();
            mesh.count = 0;
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            this.shells.push(mesh);
            this.world.scene.add(mesh);
          });
        }
      })
      .catch((error) => {
        if (!this.disposed)
          this.world.failWorld('浜の3D素材を読み込めませんでした。再読み込みしてください。', error);
      });
    return false;
  }
  update(time) {
    if (this.disposed || time < this.nextUpdate) return;
    this.nextUpdate = time + 0.25;
    const w = this.world,
      near = (p, r = 65) => Math.hypot(p.x - w.focus.x, p.z - w.focus.z) < r;
    const dummy = new THREE.Object3D(),
      matrix = new THREE.Matrix4();
    let count = 0;
    for (const s of SHELL_BEDS) {
      const amount = w.state.gulf?.shellBeds?.find((b) => b.id === s.id)?.amount ?? 0;
      const label = this.labels.get(s.id);
      label.active = near(s, 23);
      label.title.textContent = `${s.name} · ${amount}/12`;
      if (!amount || !near(s) || !this.request('cockle-shell', time)) continue;
      for (let i = 0; i < amount; i++) {
        const a = i * 2.39996,
          r = 0.22 + Math.sqrt(i / 12) * 0.9;
        const x = s.x + Math.cos(a) * r,
          z = s.z + Math.sin(a) * r;
        dummy.position.set(x, walkHeight(x, z) - 0.017, z);
        dummy.rotation.set(0, a, 0);
        dummy.scale.setScalar(0.8 + (i % 3) * 0.12);
        dummy.updateMatrix();
        for (const mesh of this.shells) {
          matrix.multiplyMatrices(dummy.matrix, mesh.userData.sourceTransform);
          mesh.setMatrixAt(count, matrix);
        }
        count++;
      }
    }
    for (const mesh of this.shells) {
      mesh.count = count;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    for (const s of MIDDEN_SITES) {
      const amount = w.state.gulf?.middens?.find((m) => m.id === s.id)?.shells ?? 0;
      const label = this.labels.get(s.id);
      label.active = near(s, 23);
      label.title.textContent = amount
        ? `貝塚 · 貝殻${amount}個`
        : '貝塚を築く場所 · 貝殻を持ち帰ろう';
      let root = this.middens.get(s.id);
      if (near(s) && amount && this.request('shell-midden', time)) {
        if (!root) {
          root = w.worldAssets.create('shell-midden');
          this.middens.set(s.id, root);
          w.scene.add(root);
        }
        root.position.set(s.x, walkHeight(s.x, s.z), s.z);
        root.scale.setScalar(middenScale(amount));
      } else if (root) {
        w.scene.remove(root);
        this.middens.delete(s.id);
      }
    }
    for (const s of KNAPPING_SITES) {
      this.labels.get(s.id).active = near(s, 23);
      let table = this.tables.get(s.id),
        blade = this.blades.get(s.id);
      if (near(s)) {
        if (!table) {
          table = w.worldAssets.create('valley-boulder');
          table.scale.set(0.3, 0.16, 0.3);
          table.position.set(s.x, walkHeight(s.x, s.z), s.z);
          this.tables.set(s.id, table);
          w.scene.add(table);
        }
        if (this.request('obsidian-blade', time) && !blade) {
          blade = w.worldAssets.create('obsidian-blade');
          blade.rotation.x = -Math.PI / 2;
          blade.position.set(s.x, walkHeight(s.x, s.z) + 0.27, s.z + 0.14);
          this.blades.set(s.id, blade);
          w.scene.add(blade);
        }
      } else {
        if (table) {
          w.scene.remove(table);
          this.tables.delete(s.id);
        }
        if (blade) {
          w.scene.remove(blade);
          this.blades.delete(s.id);
        }
      }
    }
    for (const [key, record] of this.assets)
      if (record.ready && time - record.lastUsed > 12) {
        if (key === 'cockle-shell') {
          for (const mesh of this.shells) {
            w.scene.remove(mesh);
            mesh.dispose();
          }
          this.shells = [];
        }
        w.worldAssets.releaseEnvironment(key);
        this.assets.delete(key);
      }
    w.canvas.dataset.shellInstances = String(count);
    w.canvas.dataset.middenModels = String(this.middens.size);
    w.canvas.dataset.knappingTables = String(this.tables.size);
  }
  dispose() {
    this.disposed = true;
    for (const node of [
      ...this.shells,
      ...this.tables.values(),
      ...this.middens.values(),
      ...this.blades.values(),
    ])
      this.world.scene.remove(node);
    for (const mesh of this.shells) mesh.dispose();
    for (const label of this.labels.values()) {
      label.element.remove();
      const i = this.world.labels.indexOf(label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
    this.labels.clear();
    this.tables.clear();
    this.middens.clear();
    this.blades.clear();
    this.shells = [];
  }
}
