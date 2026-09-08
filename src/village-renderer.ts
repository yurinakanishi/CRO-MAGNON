import * as THREE from 'three';
import { characterModel } from '../shared/characters.mjs';
import { RESIDENTS } from '../shared/village-sites.mjs';
import { COUNTRIES } from '../shared/gulf-region.mjs';
import { walkHeight } from '../shared/terrain.mjs';

/** Separate actors, shared adopted geometry/textures and existing character providers. */
export class VillageRenderer {
  world: any;
  entities = new Map<string, any>();
  disposed = false;
  constructor(world) {
    this.world = world;
  }
  remove(id: string) {
    const entity = this.entities.get(id);
    if (!entity) return;
    entity.actor?.root.removeFromParent();
    entity.actor?.dispose();
    if (entity.label) {
      entity.label.element.remove();
      const i = this.world.labels.indexOf(entity.label);
      if (i >= 0) this.world.labels.splice(i, 1);
    }
    this.entities.delete(id);
  }
  async load(definition, entity) {
    try {
      const provider = this.world.humanAssets.get(characterModel(definition).key);
      const color = COUNTRIES.find((c) => c.id === definition.settlementId)?.color ?? '#dfbe80';
      const actor = await provider.create({ color });
      if (this.disposed || this.entities.get(definition.id) !== entity) {
        actor?.dispose();
        return;
      }
      if (!actor) throw new Error(`Resident model unavailable: ${definition.id}`);
      entity.actor = actor;
      entity.label = this.world.createLabel(
        definition.name,
        'npc resident',
        new THREE.Vector3(),
        '集落の住人',
      );
      entity.detail = entity.label.element.querySelector('small');
      const p = entity.state;
      actor.root.position.set(p.x, walkHeight(p.x, p.z), p.z);
      actor.root.rotation.y = p.facing;
      this.world.scene.add(actor.root);
      this.world.updateAssetDiagnostics();
    } catch (error) {
      if (!this.disposed)
        this.world.failWorld('住人の3D素材を読み込めませんでした。再読み込みしてください。', error);
    }
  }
  obstacles(exceptId?: string) {
    return (this.world.state.residents ?? [])
      .filter((p) => p.id !== exceptId)
      .map((p) => {
        const position = this.entities.get(p.id)?.actor?.root.position ?? p;
        return { id: p.id, type: 'circle', x: position.x, z: position.z, radius: p.radius };
      });
  }
  update(dt: number, time: number) {
    if (this.disposed) return;
    const w = this.world;
    const present = new Set<string>();
    for (const p of w.state.residents ?? []) {
      const definition = RESIDENTS.find((d) => d.id === p.id);
      if (!definition) continue;
      present.add(p.id);
      const near = Math.hypot(p.x - w.focus.x, p.z - w.focus.z) < 65;
      let entity = this.entities.get(p.id);
      if (!entity && near) {
        entity = { state: p, lastUsed: time, clip: '' };
        this.entities.set(p.id, entity);
        void this.load(definition, entity);
      }
      if (!entity) continue;
      entity.state = p;
      if (near) entity.lastUsed = time;
      else if (time - entity.lastUsed > 12) {
        this.remove(p.id);
        continue;
      }
      if (!entity.actor) continue;
      const { root, animation, asset } = entity.actor;
      root.visible = near;
      entity.label.active = near && Math.hypot(p.x - w.focus.x, p.z - w.focus.z) < 22;
      if (!near) continue;
      const remaining = Math.hypot(p.x - root.position.x, p.z - root.position.z);
      const factor = remaining < 0.012 ? 1 : 1 - Math.exp(-dt * 16);
      const dynamic = this.obstacles(p.id).concat(
        [...w.players.values()].map((e: any) => ({
          id: e.state.id,
          type: 'circle',
          x: e.model.position.x,
          z: e.model.position.z,
          radius: e.state.radius,
        })),
      );
      const next =
        remaining > 6
          ? p
          : w.collision.move(
              root.position,
              (p.x - root.position.x) * factor,
              (p.z - root.position.z) * factor,
              p.radius,
              dynamic,
            );
      const speed =
        remaining > 6
          ? p.speed
          : Math.hypot(next.x - root.position.x, next.z - root.position.z) / Math.max(dt, 0.001);
      root.position.set(next.x, walkHeight(next.x, next.z), next.z);
      const diff = Math.atan2(
        Math.sin(p.facing - root.rotation.y),
        Math.cos(p.facing - root.rotation.y),
      );
      root.rotation.y += diff * (1 - Math.exp(-dt * 20));
      if (entity.clip !== p.clip && p.clip === 'Idle_Loop') animation.change('Idle_Loop');
      if (speed < 0.025 && ['Gather', 'Craft'].includes(p.clip) && !animation.oneShot)
        animation.play(p.clip);
      animation.update(dt, speed, false);
      entity.clip = p.clip;
      entity.label.position.set(
        root.position.x,
        root.position.y + (asset.heightMetres ?? 1.7) + 0.3,
        root.position.z,
      );
      if (entity.detail.textContent !== p.activity) entity.detail.textContent = p.activity;
    }
    for (const id of this.entities.keys()) if (!present.has(id)) this.remove(id);
    w.canvas.dataset.residentModels = String(
      [...this.entities.values()].filter((e) => e.actor?.root.visible).length,
    );
    w.canvas.dataset.residentActors = String(this.entities.size);
  }
  dispose() {
    this.disposed = true;
    for (const id of this.entities.keys()) this.remove(id);
  }
}
