import { ORB_BOTS } from '../shared/orb-bots.mjs';
import { RIMO_NEKO } from '../shared/rimo-neko.mjs';
import type { SoundPoint } from './nature-environment.js';

export const FOLEY_VARIANTS: Readonly<Record<string, number>> = {
  'step-grass': 6,
  'step-sand': 6,
  'step-stone': 6,
  'step-snow': 6,
  'step-water': 6,
  attack: 3,
  jump: 3,
  hurt: 3,
  mount: 2,
  throw: 3,
  pet: 2,
  'gather-stone': 2,
  'gather-wood': 2,
  'gather-plant': 2,
};
export const FOLEY_FILES = [
  ...Object.entries(FOLEY_VARIANTS).flatMap(([key, count]) =>
    Array.from({ length: count }, (_, i) => `fx-${key}-${i}`),
  ),
  ...['torch-switch', 'hiss', 'recall', 'confirm', 'discovery'].map((k) => `fx-${k}`),
];
/** A hissing cat further away than this is masked by wind and footsteps. */
export const HISS_RANGE = 14;
/** The blow on another player is heard at close quarters, as by its attacker. */
export const KNOCKBACK_SOUND_RANGE = 4;

/** Only fresh authoritative transitions. Snapshots are copied because render state can mutate. */
export class FoleyEvents {
  private seen = new Map<string, string>();
  private last = new Map<string, number>();
  private previous: any = null;
  reset() {
    this.seen.clear();
    this.last.clear();
    this.previous = null;
  }
  private fresh(key: string, token: string, at: number, now: number, baseline: boolean) {
    if (baseline) {
      this.seen.set(key, token);
      return false;
    }
    if (now < at) return false;
    const old = this.seen.get(key);
    this.seen.set(key, token);
    return old !== token && at > 0 && now - at <= 600;
  }
  update(
    world: any,
    p: any,
    now: number,
    baseline: boolean,
    play: (name: string, point?: SoundPoint) => void,
  ) {
    // Loudness is not decided here: src/nature-audio-levels.ts holds each action's real level.
    const emit = (name: string, point?: SoundPoint, cooldown = 180) => {
      if (now - (this.last.get(name) ?? -Infinity) < cooldown) return;
      this.last.set(name, now);
      play(name, point);
    };
    for (const key of ['attack', 'jump', 'hurt'])
      if (this.fresh(key, `${p[key + 'At']}/${p[key + 'Sequence']}`, p[key + 'At'], now, baseline))
        emit(key);
    // A blow between players sounds on the struck body: ours, or one close beside us.
    for (const other of world.state?.players ?? []) {
      if (other.id !== p.id && Math.hypot(other.x - p.x, other.z - p.z) > KNOCKBACK_SOUND_RANGE)
        continue;
      const token = `${other.knockbackAt}/${other.knockbackSequence}`;
      if (this.fresh(`knockback:${other.id}`, token, other.knockbackAt ?? 0, now, baseline))
        emit('hurt');
    }
    const visited = Object.values(p.adventure?.regions ?? {}).reduce<number>(
      (n, r: any) => n + (r.visited?.length ?? 0),
      0,
    );
    const current = {
      gathered: p.gathered,
      torch: !!p.caveTorchOff,
      ride: `${p.mountId ?? ''}/${p.boatId ?? ''}/${p.carrierId ?? ''}/${p.passengerId ?? ''}`,
      visited,
      inventory: { ...p.inventory },
    };
    const old = this.previous;
    if (old && !baseline) {
      if (current.gathered > old.gathered) {
        const material = ['stone', 'obsidian'].some(
          (k) => (p.inventory?.[k] ?? 0) > (old.inventory[k] ?? 0),
        )
          ? 'stone'
          : (p.inventory?.wood ?? 0) > (old.inventory.wood ?? 0)
            ? 'wood'
            : 'plant';
        emit('gather-' + material);
      }
      if (current.torch !== old.torch) emit('torch-switch');
      if (current.ride !== old.ride) emit('mount');
      if (current.visited > old.visited) emit('discovery', undefined, 4000);
    }
    this.previous = current;
    const bots = world.state.orbBots ?? [];
    const companions = [...(world.state.companions ?? []), ...bots];
    for (const b of bots) {
      if (b.ownerId !== p.id) continue;
      const recall = `recall:${b.id}`,
        thrown = `throw:${b.id}`;
      if (this.fresh(recall, `${b.recallAt}`, b.recallAt, now, baseline))
        emit('recall', undefined, 1500);
      if (
        b.throwAt > 0 &&
        this.fresh(thrown, `${b.throwAt}`, b.throwAt + ORB_BOTS.windupMs, now, baseline)
      )
        emit('throw');
    }
    for (const c of companions) {
      if (c.petPlayerId !== p.id) continue;
      const key = `pet:${c.id}`;
      if (this.fresh(key, `${c.petAt}`, c.petAt, now, baseline)) emit('pet', undefined, 500);
    }
    // Keep recent companion tokens across brief removals/ownership changes.
    while (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value!);
    // Every player's own cat hisses when struck, wherever it is in hearing.
    for (const cat of world.state.companions ?? []) {
      if (cat.key !== 'rimo-neko' || !(cat.hitAt > 0)) continue;
      if (
        this.fresh(
          `hiss:${cat.id}`,
          `${cat.hitSequence}/${cat.hitAt}`,
          cat.hitAt + RIMO_NEKO.hitMs,
          now,
          baseline,
        ) &&
        Math.hypot(p.x - cat.x, p.z - cat.z) <= HISS_RANGE
      )
        emit('hiss', { x: cat.x, y: (p.y ?? 0) + 0.3, z: cat.z }, 1200);
    }
  }
}
