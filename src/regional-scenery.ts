import * as THREE from 'three';
import { SCENERY, grassForChunk } from '../shared/scenery-layout.mjs';
import { BIOME_SCENERY, resourceAppearance } from '../shared/biome-scenery.mjs';
import { nearbyChunks } from '../shared/biomes.mjs';
import { PlacementGrid } from '../shared/spatial-grid.mjs';
import { terrainHeight, walkHeight } from '../shared/terrain.mjs';
import { LandscapeInstances } from './world-assets.js';
import { WORLD } from '../shared/world.mjs';

export const regionalId = (key, surface) => `${key}:${surface}`;
const RADIUS = 125;

// This owner accounts for every consumer of a regional material. Eviction frees
// only regional materials and their small far-view renders, never source data.
export class RegionalScenery {
  declare world: any;
  declare assets: any;
  declare buildFireEffect: any;
  declare groups: Map<any, any>;
  declare landscapes: Map<any, any>;
  declare props: Map<any, any>;
  declare lastUsed: Map<any, any>;
  declare desired: Set<any>;
  declare nextPlan: number;
  declare disposed: boolean;

  constructor(world, { buildFireEffect }) {
    this.world = world;
    this.assets = world.worldAssets;
    this.buildFireEffect = buildFireEffect;
    this.groups = new Map();
    this.landscapes = new Map();
    this.props = new Map();
    this.lastUsed = new Map();
    this.desired = new Set();
    this.nextPlan = 0;
    this.disposed = false;
    const groupFor = (key, surface) => {
      const id = regionalId(key, surface);
      if (!this.groups.has(id))
        this.groups.set(id, { id, key, surface, vegetation: [], props: [], groundcover: false });
      return this.groups.get(id);
    };
    for (const category of ['trees', 'rocks', 'ridges', 'tents', 'props', 'fires']) {
      for (const [index, item] of SCENERY[category].entries()) {
        if (!item.surface) continue;
        const group = groupFor(item.key, item.surface);
        const spec = { ...item, category, instanceId: `regional-${category}-${index}` };
        if (category === 'trees' || category === 'rocks') group.vegetation.push(spec);
        else group.props.push(spec);
      }
    }
    for (const palette of Object.values(BIOME_SCENERY)) {
      if (palette.surface && palette.groundcover)
        groupFor(palette.groundcover, palette.surface).groundcover = true;
    }
    for (const group of this.groups.values())
      group.grid = new PlacementGrid([...group.vegetation, ...group.props]);
  }

  initialize(position) {
    this.plan(position, 0);
    for (const id of this.desired) this.admit(id, position);
  }

  wants(key, surface) {
    return this.desired.has(regionalId(key, surface));
  }

  plan(position, time) {
    this.desired.clear();
    for (const group of this.groups.values()) {
      for (const item of group.grid.near(position.x, position.z, RADIUS + 25)) {
        if (Math.hypot(item.x - position.x, item.z - position.z) < RADIUS + 25) {
          this.desired.add(group.id);
          break;
        }
      }
    }
    for (const resource of this.world.state?.resources ?? []) {
      const { key, surface } = resourceAppearance(resource);
      if (
        surface &&
        resource.amount > 0 &&
        Math.hypot(resource.x - position.x, resource.z - position.z) < RADIUS
      ) {
        this.desired.add(regionalId(key, surface));
      }
    }
    for (const chunk of nearbyChunks(position.x, position.z, 48)) {
      const palette = BIOME_SCENERY[chunk.biome];
      if (palette.surface && palette.groundcover)
        this.desired.add(regionalId(palette.groundcover, palette.surface));
    }
    for (const id of this.desired) this.lastUsed.set(id, time);
    for (const [id, last] of this.lastUsed) {
      if (time - last <= 12) continue;
      this.evict(id);
      const [key, surface] = id.split(':');
      this.assets.releaseSurface(key, surface);
      this.lastUsed.delete(id);
    }
  }

  admit(id, position) {
    const group = this.groups.get(id);
    if (!group) return;
    const { key, surface } = group;
    if (!this.landscapes.has(id) && (group.vegetation.length || group.groundcover)) {
      const asset = this.assets.get(key).asset,
        foliage = group.groundcover;
      const place = (item) => ({
        ...item,
        height: asset.heightMetres * (Array.isArray(item.scale) ? item.scale[1] : item.scale),
        position: new THREE.Vector3(
          item.x,
          terrainHeight(item.x, item.z) - (foliage ? 0.012 : 0),
          item.z,
        ),
        scale: Array.isArray(item.scale)
          ? new THREE.Vector3(...item.scale)
          : new THREE.Vector3().setScalar(item.scale),
      });
      const landscape = new LandscapeInstances({
        assets: this.assets,
        key,
        surface,
        placements: group.vegetation.map(place),
        renderer: this.world.renderer,
        scene: this.world.scene,
        // Snow exposes large facets in the tree's coarse LOD. At mid-distance
        // use the render of its accepted detailed GLB, retaining the same buffers.
        distances: foliage ? [5, 14, 42] : asset.kind === 'tree' ? [14, 14, 110] : [28, 50, 110],
        foliage,
        generateCell: foliage
          ? (x, z) =>
              grassForChunk(x - WORLD.minX / 32, z - WORLD.minZ / 32)
                .filter((item) => item.key === key && item.surface === surface)
                .map(place)
          : null,
      });
      this.landscapes.set(id, landscape);
      this.world.landscapes.push(landscape);
    }
    for (const item of group.props) {
      if (
        this.props.has(item.instanceId) ||
        Math.hypot(item.x - position.x, item.z - position.z) > RADIUS + 25
      )
        continue;
      let root,
        fire = null;
      if (item.category === 'fires') {
        fire = this.buildFireEffect(this.world, item.x, item.z, item.scale, key, surface);
        root = fire.root;
      } else {
        root = this.assets.createResource(key, surface);
        root.position.set(item.x, walkHeight(item.x, item.z), item.z);
        root.rotation.y = item.yaw;
        Array.isArray(item.scale)
          ? root.scale.set(...item.scale)
          : root.scale.setScalar(item.scale);
        this.world.scene.add(root);
      }
      root.name = item.instanceId;
      root.updateMatrixWorld(true);
      const record = {
        root,
        radius: new THREE.Box3().setFromObject(root).getSize(new THREE.Vector3()).length() * 0.5,
      };
      this.world.staticScenery.push(record);
      this.props.set(item.instanceId, { id, root, fire, record });
    }
  }

  update(camera, time) {
    if (this.disposed) return;
    if (time >= this.nextPlan) {
      this.nextPlan = time + 0.35;
      this.plan(camera.position, time);
      this.world.syncResources();
    }
    // Building a far-view render can compile a shader. Admit one vegetation
    // surface per frame and retain exactly the source GLB's mesh LODs.
    for (const id of this.desired) {
      const before = this.landscapes.size;
      this.admit(id, camera.position);
      if (this.landscapes.size > before) break;
    }
    this.world.canvas.dataset.regionalKeys = JSON.stringify([...this.lastUsed.keys()].sort());
  }

  evict(id) {
    const landscape = this.landscapes.get(id);
    if (landscape) {
      landscape.dispose();
      this.world.landscapes.splice(this.world.landscapes.indexOf(landscape), 1);
      this.landscapes.delete(id);
    }
    for (const [instanceId, item] of this.props) {
      if (item.id !== id) continue;
      this.world.scene.remove(item.root);
      this.world.staticScenery.splice(this.world.staticScenery.indexOf(item.record), 1);
      if (item.fire) {
        this.world.scene.remove(item.fire.light);
        item.fire.light.dispose();
        item.fire.sparks.geometry.dispose();
        item.fire.sparks.material.dispose();
        this.world.fires.splice(this.world.fires.indexOf(item.fire), 1);
      }
      this.props.delete(instanceId);
    }
    for (const [resourceId, item] of this.world.resources) {
      if (regionalId(item.key, item.surface) !== id) continue;
      this.world.scene.remove(item.model);
      // Resource instances have no labels; only their scene object belongs here.
      this.world.resources.delete(resourceId);
    }
  }

  dispose() {
    this.disposed = true;
    for (const id of this.lastUsed.keys()) this.evict(id);
    this.lastUsed.clear();
  }
}
