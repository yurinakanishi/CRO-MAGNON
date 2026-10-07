import { ORB_BOTS } from '../shared/orb-bots.mjs';
import { RIMO_NEKO } from '../shared/rimo-neko.mjs';
import { soundFalloff } from './nature-audio-design.js';
import type { SoundPoint } from './nature-environment.js';

export const FOLEY_VARIANTS: Readonly<Record<string, number>> = {
  'step-grass': 3,
  'step-sand': 3,
  'step-stone': 3,
  'step-snow': 3,
  'step-water': 3,
  attack: 3,
  jump: 2,
  hurt: 2,
  mount: 2,
  throw: 3,
  pet: 2,
};
export const FOLEY_FILES = [
  ...Object.entries(FOLEY_VARIANTS).flatMap(([key, count]) =>
    Array.from({ length: count }, (_, i) => `fx-${key}-${i}`),
  ),
  ...[
    'gather-stone',
    'gather-wood',
    'gather-plant',
    'torch-switch',
    'hiss',
    'recall',
    'confirm',
    'discovery',
  ].map((k) => `fx-${k}`),
];

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
    play: (name: string, volume: number, point?: SoundPoint) => void,
  ) {
    const emit = (name: string, volume = 0.6, point?: SoundPoint, cooldown = 180) => {
      if (now - (this.last.get(name) ?? -Infinity) < cooldown) return;
      this.last.set(name, now);
      play(name, volume, point);
    };
    for (const key of ['attack', 'jump', 'hurt'])
      if (this.fresh(key, `${p[key + 'At']}/${p[key + 'Sequence']}`, p[key + 'At'], now, baseline))
        emit(key);
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
      if (current.torch !== old.torch) emit('torch-switch', 0.5);
      if (current.ride !== old.ride) emit('mount', 0.6);
      if (current.visited > old.visited) emit('discovery', 0.5, undefined, 4000);
    }
    this.previous = current;
    const bots = world.state.orbBots ?? [];
    const companions = [
      world.state.rimoNeko,
      world.state.mae,
      world.state.kohaku,
      world.state.maruimo,
      ...(world.state.friends ?? []),
      world.state.companion524,
      ...bots,
    ].filter(Boolean);
    for (const b of bots) {
      if (b.ownerId !== p.id) continue;
      const recall = `recall:${b.id}`,
        thrown = `throw:${b.id}`;
      if (this.fresh(recall, `${b.recallAt}`, b.recallAt, now, baseline))
        emit('recall', 0.6, undefined, 1500);
      if (
        b.throwAt > 0 &&
        this.fresh(thrown, `${b.throwAt}`, b.throwAt + ORB_BOTS.windupMs, now, baseline)
      )
        emit('throw');
    }
    for (const c of companions) {
      if (c.petPlayerId !== p.id) continue;
      const key = `pet:${c.id}`;
      if (this.fresh(key, `${c.petAt}`, c.petAt, now, baseline)) emit('pet', 0.6, undefined, 500);
    }
    // Keep recent companion tokens across brief removals/ownership changes.
    while (this.seen.size > 64) this.seen.delete(this.seen.keys().next().value!);
    const cat = world.state.rimoNeko;
    if (
      cat?.hitAt > 0 &&
      this.fresh(
        'cat',
        `${cat.hitSequence}/${cat.hitAt}`,
        cat.hitAt + RIMO_NEKO.hitMs,
        now,
        baseline,
      )
    ) {
      const gain = soundFalloff(Math.hypot(p.x - cat.x, p.z - cat.z), 2, 12);
      if (gain > 0) emit('hiss', 0.6 * gain, { x: cat.x, y: 0.3, z: cat.z }, 1200);
    }
  }
}
