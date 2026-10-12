import * as THREE from 'three';
import type { WorldRenderer } from './world3d.js';
import { Companion524Renderer } from './companion-524-renderer.js';
import { RimoNekoRenderer } from './rimo-neko-renderer.js';
import { FriendMascotRenderer } from './friend-mascot-renderer.js';
import { isLoadCancelled } from './asset-load-queue.js';
import { COMPANION_524 } from '../shared/companion-524.mjs';
import { friendDefinition, type FriendMascotDefinition } from '../shared/friend-mascots.mjs';
import { companionOnGround } from '../shared/companions.mjs';
import type { CompanionSnapshot } from '../shared/companion-types.mjs';

export type CompanionRenderer = Companion524Renderer | RimoNekoRenderer | FriendMascotRenderer;

/** The verified model a companion mascot uses (524's is named for its colour). */
export function companionModelKey(key: string) {
  return key === '524' ? COMPANION_524.modelKey : key;
}

/** Contact-shadow radius of each companion body. */
export function companionShadowRadius(key: string) {
  return key === '524' ? 0.18 : key === 'rimo-neko' ? 0.28 : key === 'mae' ? 0.24 : 0.2;
}

const held = (renderer: CompanionRenderer) => 'inHand' in renderer && renderer.inHand;

/** One renderer per player's companion body, built once its verified model has loaded
 * and released when the body leaves the world. Several players may own the same mascot. */
export class CompanionRenderers {
  readonly renderers = new Map<string, CompanionRenderer>();
  private readonly pending = new Set<string>();
  private disposed = false;

  constructor(private world: WorldRenderer) {}

  sync() {
    const bodies = this.world.state.companions ?? [];
    const ids = new Set(bodies.map((c) => c.id));
    for (const [id, renderer] of this.renderers)
      if (!ids.has(id)) {
        renderer.dispose();
        this.renderers.delete(id);
      }
    for (const c of bodies) {
      if (this.renderers.has(c.id) || this.pending.has(c.id)) continue;
      if (!this.world.worldAssets.templates.has(companionModelKey(c.key))) continue;
      if (c.key === '524') this.renderers.set(c.id, new Companion524Renderer(this.world, c.id));
      else if (c.key === 'rimo-neko')
        this.renderers.set(c.id, new RimoNekoRenderer(this.world, c.id));
      else {
        const def = friendDefinition(c.key);
        if (def) void this.installFriend(def, c.id);
      }
    }
  }

  private async installFriend(def: FriendMascotDefinition, id: string) {
    this.pending.add(id);
    try {
      const equipment = def.equipment
        ? await this.world.worldAssets.createEquipment(def.equipment.key)
        : undefined;
      // The body may have said goodbye while its equipment loaded.
      if (this.disposed || !this.world.state.companions?.some((c) => c.id === id)) return;
      this.renderers.set(id, new FriendMascotRenderer(this.world, def, id, equipment ?? undefined));
    } catch (error) {
      if (!this.disposed && !isLoadCancelled(error))
        this.world.failWorld('仲間の3D素材を読み込めませんでした。再読み込みしてください。', error);
    } finally {
      this.pending.delete(id);
    }
  }

  /** Bodies in a hand follow the arm posed this frame; the others are drawn before. */
  update(dt: number, inHand: boolean) {
    for (const renderer of this.renderers.values())
      if (held(renderer) === inHand) renderer.update(dt);
  }

  /** The stroked head of a body, for the petting arm. */
  petTarget(id: string, out: THREE.Vector3) {
    const renderer = this.renderers.get(id);
    if (!renderer || renderer instanceof Companion524Renderer) return null;
    return renderer.petTarget(out);
  }

  roots() {
    return [...this.renderers.values()].map((renderer) => renderer.root);
  }

  /** Bodies that can be looked at closely: on the ground and not saying goodbye. */
  viewTargets() {
    const targets: {
      id: string;
      label: string;
      root: THREE.Object3D;
      asset: CompanionRenderer['actor']['asset'];
      scale: number;
      centered: boolean;
    }[] = [];
    for (const [id, renderer] of this.renderers) {
      const c: CompanionSnapshot | undefined = renderer.state;
      if (!c || c.leavingAt || !companionOnGround(c)) continue;
      const is524 = renderer instanceof Companion524Renderer;
      targets.push({
        id,
        label: is524
          ? '524'
          : renderer instanceof RimoNekoRenderer
            ? 'りもねこ'
            : renderer.def.name,
        root: renderer.root,
        asset: renderer.actor.asset,
        scale: is524 ? COMPANION_524.scale : 1,
        centered: is524,
      });
    }
    return targets;
  }

  diagnostics() {
    return [...this.renderers.values()].map((renderer) => renderer.diagnostics());
  }

  dispose() {
    this.disposed = true;
    for (const renderer of this.renderers.values()) renderer.dispose();
    this.renderers.clear();
  }
}
