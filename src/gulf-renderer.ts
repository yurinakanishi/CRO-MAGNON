import { FISHING_SITES } from '../shared/fishing-sites.mjs';
import { BOATING } from '../shared/boats.mjs';
import * as THREE from 'three';
import { isMesh } from './three-types.js';
import { FARM_PLOTS, SPRINGS, SETTLEMENTS, LANDINGS, GULF_STOPS } from '../shared/gulf-region.mjs';
import { walkHeight } from '../shared/terrain.mjs';
import { plotCrop } from '../shared/crops.mjs';

// Farm markers reuse the accepted boulder mesh, instanced below ankle height.
// Crops reuse the accepted bush/grass GLBs; fictional root crops show only their leaves.
export class GulfRenderer {
  world: any;
  crops = new Map<string, any>();
  springs = new Map<string, any>();
  labels: any[] = [];
  borders: THREE.InstancedMesh[] = [];
  nextUpdate = 0;
  plotLabel: any;
  cropMaterials = new Map<string, { material: THREE.Material; cropId: string }>();
  cropLastUsed = new Map<string, number>();
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
    for (const s of [
      ...SETTLEMENTS,
      ...GULF_STOPS,
      ...SPRINGS,
      ...LANDINGS.map((l) => ({ ...l, name: l.name + '・魚場' })),
    ]) {
      const label = world.createLabel(
        s.name,
        'gulf',
        new THREE.Vector3(s.x, walkHeight(s.x, s.z) + 2.3, s.z),
      );
      this.labels.push(label);
    }
    for (const site of FISHING_SITES.filter((s) => s.boatOnly)) {
      this.labels.push(
        world.createLabel(
          site.name,
          'gulf',
          new THREE.Vector3(site.x, BOATING.waterY + 2.3, site.z),
        ),
      );
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
          const variety = plotCrop(plot);
          if (crop && crop.userData.cropId !== variety.id) {
            world.scene.remove(crop);
            this.crops.delete(spec.id);
            crop = null;
          }
          if (!crop) {
            crop = world.worldAssets.createResource(variety.model);
            crop.userData.cropId = variety.id;
            if (variety.id !== 'berry')
              crop.traverse((node) => {
                if (!isMesh(node)) return;
                const tint = (source) => {
                  const key = `${variety.id}:${source.uuid}`;
                  if (!this.cropMaterials.has(key)) {
                    const material = source.clone();
                    material.color?.multiply(new THREE.Color(variety.tint));
                    this.cropMaterials.set(key, { material, cropId: variety.id });
                  }
                  return this.cropMaterials.get(key).material;
                };
                node.material = Array.isArray(node.material)
                  ? node.material.map(tint)
                  : tint(node.material);
              });
            this.crops.set(spec.id, crop);
            world.scene.add(crop);
          }
          this.cropLastUsed.set(variety.id, time);
          const scale = variety.scale * { planted: 0.2, growing: 0.55, ripe: 1 }[plot.stage];
          crop.scale.setScalar(scale);
          crop.position.set(spec.x, walkHeight(spec.x, spec.z), spec.z);
          crop.visible = true;
        } else if (crop) {
          world.scene.remove(crop);
          this.crops.delete(spec.id);
        }
        const d = Math.hypot(spec.x - focus.x, spec.z - focus.z);
        if (d < nearestDistance) {
          nearest = { ...spec, cropId: plot?.cropId, stage: plot?.stage ?? 'empty' };
          nearestDistance = d;
        }
      } else if (crop) {
        world.scene.remove(crop);
        this.crops.delete(spec.id);
      }
    }
    for (const [key, entry] of this.cropMaterials) {
      if (time - (this.cropLastUsed.get(entry.cropId) ?? time) > 12) {
        entry.material.dispose();
        this.cropMaterials.delete(key);
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
      this.plotLabel.title.textContent = `${nearest.stage === 'empty' ? '共同の畑' : plotCrop(nearest).name} · ${{ empty: '作物を選んで植える', planted: '水が必要', growing: '成長中', ripe: '収穫できる' }[nearest.stage]}`;
      this.plotLabel.position.set(nearest.x, walkHeight(nearest.x, nearest.z) + 1.7, nearest.z);
    }
    world.canvas.dataset.gulfPlots = String(index / 4);
    world.canvas.dataset.gulfCrops = String(this.crops.size);
    world.canvas.dataset.cropVarieties = [
      ...new Set([...this.crops.values()].map((c) => c.userData.cropId)),
    ]
      .sort()
      .join(',');
    world.canvas.dataset.cropMaterials = String(this.cropMaterials.size);
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
    for (const { material } of this.cropMaterials.values()) material.dispose();
    this.cropMaterials.clear();
    this.cropLastUsed.clear();
  }
}
