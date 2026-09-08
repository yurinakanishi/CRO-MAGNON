import * as THREE from 'three';

export const HUMAN_CLIPS = [
  'Idle_Loop',
  'Walk_Loop',
  'Run_Loop',
  'Gather',
  'Craft',
  'Give',
  'Eat',
  'Wave',
  'Attack',
];

// The current server sends a snapshot immediately after every successful action.
// Derive only confirmed inventory changes; failed requests and joins stay idle.
export function confirmedAction(before, after) {
  if (!before || before.id !== after.id) return null;
  if ((after.attackSequence ?? 0) > (before.attackSequence ?? 0)) return 'Attack';
  if (after.cookingEndsAt && after.cookingEndsAt !== before.cookingEndsAt) return 'Craft';
  if (
    after.coastalActivity &&
    after.coastalActivity.startedAt !== before.coastalActivity?.startedAt
  )
    return after.coastalActivity.kind === 'shells' ? 'Gather' : 'Craft';
  if (after.spearHead === 'obsidian' && before.spearHead !== 'obsidian') return 'Craft';
  const a = before.inventory,
    b = after.inventory;
  if (!a || !b) return null;
  if (!before.tool && after.tool) return 'Craft';
  if ((b.obsidianBlade ?? 0) > (a.obsidianBlade ?? 0)) return 'Craft';
  if ((b.shells ?? 0) < (a.shells ?? 0)) return 'Give';
  if (
    ['cookedFish', 'cookedShellfish'].some((k) => (b[k] ?? 0) < (a[k] ?? 0)) &&
    after.energy > before.energy
  )
    return 'Eat';
  if (['rawFish', 'rawShellfish', 'obsidian'].some((k) => (b[k] ?? 0) > (a[k] ?? 0)))
    return 'Gather';
  const wood = b.wood - a.wood,
    stone = b.stone - a.stone,
    berry = b.berry - a.berry;
  const rawMeat = (b.rawMeat ?? 0) - (a.rawMeat ?? 0),
    cookedMeat = (b.cookedMeat ?? 0) - (a.cookedMeat ?? 0);
  if (cookedMeat < 0 && after.energy > before.energy) return 'Eat';
  if (rawMeat > 0) return 'Gather';
  if (berry === -1 && after.energy > before.energy) return 'Eat';
  if ((wood < 0 || stone < 0) && berry >= 0) return 'Give';
  if (wood > 0 || stone > 0 || berry > 0) return 'Gather';
  return null;
}

export class CharacterAnimation {
  declare mixer: THREE.AnimationMixer<THREE.AnimationMixerEventMap>;
  declare actions: Map<string, THREE.AnimationAction>;
  declare root: any;
  declare clipSpeeds: {
    Walk_Loop: any;
    Run_Loop: any;
  };
  declare speed: number;
  declare moving: boolean;
  declare oneShot: boolean;
  declare retiring: Map<any, any>;
  declare onFinished: ({ action }: { action: any }) => void;
  declare finished: boolean;
  declare current: any;
  declare name: any;

  constructor(root, clips, { walkSpeed, runSpeed }) {
    if (!(runSpeed > 0) || !(walkSpeed > 0))
      throw new Error('Character clip speeds must be positive');
    const byName = new Map<string, THREE.AnimationClip>(clips.map((clip) => [clip.name, clip]));
    for (const name of HUMAN_CLIPS)
      if (!byName.has(name)) throw new Error(`Missing animation: ${name}`);
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map(
      HUMAN_CLIPS.map((name) => [name, this.mixer.clipAction(byName.get(name))]),
    );
    this.root = root;
    this.clipSpeeds = { Walk_Loop: walkSpeed, Run_Loop: runSpeed };
    this.speed = 0;
    this.moving = false;
    this.oneShot = false;
    this.retiring = new Map();
    this.onFinished = ({ action }) => {
      if (action === this.current) this.finished = true;
    };
    this.mixer.addEventListener('finished', this.onFinished);
    this.change('Idle_Loop', 0);
  }

  change(name, fade = 0.16) {
    const next = this.actions.get(name);
    if (next === this.current && !this.oneShot) return;
    const previous = this.current;
    this.current = next;
    this.name = name;
    this.oneShot = !name.endsWith('_Loop');
    this.finished = false;
    this.retiring.delete(next);
    next
      .reset()
      .setEffectiveWeight(1)
      .setEffectiveTimeScale(this.clipSpeeds[name] ? this.speed / this.clipSpeeds[name] : 1);
    next.setLoop(this.oneShot ? THREE.LoopOnce : THREE.LoopRepeat, this.oneShot ? 1 : Infinity);
    next.clampWhenFinished = this.oneShot;
    next.play();
    if (previous && previous !== next && fade > 0) {
      next.crossFadeFrom(previous, fade, false);
      this.retiring.set(previous, fade);
    }
  }

  play(name) {
    if (this.moving || !this.actions.has(name) || name.endsWith('_Loop')) return false;
    this.change(name);
    return true;
  }

  // The attack starts only from an authoritative sequence. Seeking accounts for
  // loading or network latency instead of replaying an old strike after joining.
  playAttack(elapsedSeconds = 0) {
    const duration = this.actions.get('Attack').getClip().duration;
    if (elapsedSeconds >= duration) return false;
    this.change('Attack', 0.06);
    this.current.time = Math.max(0, elapsedSeconds);
    this.mixer.update(0);
    return true;
  }

  update(dt, speed = 0, running = false) {
    this.speed = Number.isFinite(speed) ? Math.max(0, speed) : 0;
    this.moving = this.speed > 0.025;
    const locomotion = this.moving ? (running ? 'Run_Loop' : 'Walk_Loop') : 'Idle_Loop';
    if (this.moving && this.name !== locomotion && this.name !== 'Attack') this.change(locomotion);
    else if (!this.moving && !this.oneShot && this.name !== 'Idle_Loop') this.change('Idle_Loop');
    if (this.clipSpeeds[this.name])
      this.current.setEffectiveTimeScale(this.speed / this.clipSpeeds[this.name]);
    this.mixer.update(dt);
    for (const [action, remaining] of this.retiring) {
      if (remaining <= dt) {
        action.stop();
        this.retiring.delete(action);
      } else this.retiring.set(action, remaining - dt);
    }
    if (this.finished) this.change(locomotion);
  }

  dispose() {
    this.mixer.removeEventListener('finished', this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.retiring.clear();
  }
}
