import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { FARM_PLOTS, SPRINGS, SETTLEMENTS, LANDINGS } from '../shared/gulf-region.mjs';
import { walkHeight } from '../shared/terrain.mjs';

// Farm markers reuse the accepted boulder mesh, instanced below ankle height.
// Crops and spring water reuse the accepted bush and water GLBs. No new geometry.
export class GulfRenderer {
  world: any;
  crops = new Map<string, any>();
  springs = new Map<string, any>();
  labels: any[] = [];
  borders: THREE.InstancedMesh[] = [];
  nextUpdate = 0;
  plotLabel: any;
  constructor(world) {
    this.world = world;
    const template = world.worldAssets.get('valley-boulder').gltf.scene;
    template.updateMatrixWorld(true);
    template.traverse((node) => {
      if (!isMesh(node)) return;
      const mesh = new THREE.InstancedMesh(node.geometry, node.material, FARM_PLOTS.length * 4);
      mesh.userData.sourceTransform = node.matrixWorld.clone();
      mesh.count = 0;
      world.scene.add(mesh);
      this.borders.push(mesh);
    });
    for (const s of [...SETTLEMENTS, ...SPRINGS, ...LANDINGS]) {
      const label = world.createLabel(
        s.name,
        'gulf',
        new THREE.Vector3(s.x, walkHeight(s.x, s.z) + 2.3, s.z),
      );
      this.labels.push(label);
    }
    this.plotLabel = world.createLabel('共同の畑', 'resource', new THREE.Vector3());
    this.labels.push(this.plotLabel);
  }
  update(time) {
    if (time < this.nextUpdate) return;
    this.nextUpdate = time + 0.35;
    const world = this.world,
      focus = world.focus,
      matrix = new THREE.Matrix4(),
      dummy = new THREE.Object3D();
    const near = (p, r) => Math.hypot(p.x - focus.x, p.z - focus.z) < r;
    let index = 0,
      nearest = null,
      nearestDistance = 12;
    for (const spec of FARM_PLOTS) {
      const plot = world.state.gulf?.plots.find((p) => p.id === spec.id);
      const visible = near(spec, 95);
      let crop = this.crops.get(spec.id);
      if (visible) {
        for (const [dx, dz] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ]) {
          dummy.position.set(spec.x + dx, walkHeight(spec.x + dx, spec.z + dz), spec.z + dz);
          dummy.scale.set(0.16, 0.045, 0.16);
          dummy.rotation.y = index;
          dummy.updateMatrix();
          for (const border of this.borders) {
            matrix.multiplyMatrices(dummy.matrix, border.userData.sourceTransform);
            border.setMatrixAt(index, matrix);
          }
          index++;
        }
        if (plot && plot.stage !== 'empty') {
          if (!crop) {
            crop = world.worldAssets.createResource('berry-bush');
            this.crops.set(spec.id, crop);
            world.scene.add(crop);
          }
          const scale = { planted: 0.2, growing: 0.55, ripe: 1 }[plot.stage];
          crop.scale.setScalar(scale);
          crop.position.set(spec.x, walkHeight(spec.x, spec.z), spec.z);
          crop.visible = true;
        } else if (crop) crop.visible = false;
        const d = Math.hypot(spec.x - focus.x, spec.z - focus.z);
        if (d < nearestDistance) {
          nearest = { ...spec, stage: plot?.stage ?? 'empty' };
          nearestDistance = d;
        }
      } else if (crop) {
        world.scene.remove(crop);
        this.crops.delete(spec.id);
      }
    }
    for (const mesh of this.borders) {
      mesh.count = index;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingBox();
      mesh.computeBoundingSphere();
    }
    for (const spring of SPRINGS) {
      let root = this.springs.get(spring.id);
      if (near(spring, 100)) {
        if (!root) {
          root = world.worldAssets.create('river-water');
          const box = new THREE.Box3().setFromObject(root),
            size = box.getSize(new THREE.Vector3());
          root.scale.set(2.8 / size.x, 0.01 / size.y, 2.8 / size.z);
          box.setFromObject(root);
          const centre = box.getCenter(new THREE.Vector3());
          root.position.set(
            spring.x - centre.x,
            walkHeight(spring.x, spring.z) + 0.06 - box.max.y,
            spring.z - centre.z,
          );
          this.springs.set(spring.id, root);
          world.scene.add(root);
        }
      } else if (root) {
        world.scene.remove(root);
        this.springs.delete(spring.id);
      }
    }
    for (const label of this.labels) label.active = near(label.position, 60);
    this.plotLabel.active = !!nearest;
    if (nearest) {
      this.plotLabel.title.textContent = `共同の畑 · ${{ empty: '種を植える', planted: '水が必要', growing: '成長中', ripe: '収穫できる' }[nearest.stage]}`;
      this.plotLabel.position.set(nearest.x, walkHeight(nearest.x, nearest.z) + 1.7, nearest.z);
    }
    world.canvas.dataset.gulfPlots = String(index / 4);
    world.canvas.dataset.gulfCrops = String(this.crops.size);
  }
  dispose() {
    for (const root of [...this.crops.values(), ...this.springs.values(), ...this.borders])
      this.world.scene.remove(root);
    for (const mesh of this.borders) mesh.dispose();
    for (const label of this.labels) {
      label.element.remove();
      const i = this.world.labels.indexOf(label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
    this.crops.clear();
    this.springs.clear();
  }
}
