import * as THREE from 'three';

export const HUMAN_CLIPS = ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Gather', 'Craft', 'Give', 'Eat', 'Wave'];

// The current server sends a snapshot immediately after every successful action.
// Derive only confirmed inventory changes; failed requests and joins stay idle.
export function confirmedAction(before, after) {
  if (!before || before.id !== after.id) return null;
  const a = before.inventory, b = after.inventory;
  if (!a || !b) return null;
  if (!before.tool && after.tool) return 'Craft';
  const wood = b.wood - a.wood, stone = b.stone - a.stone, berry = b.berry - a.berry;
  if (berry === -1 && after.energy > before.energy) return 'Eat';
  if ((wood < 0 || stone < 0) && berry >= 0) return 'Give';
  if (wood > 0 || stone > 0 || berry > 0) return 'Gather';
  return null;
}

export class CharacterAnimation {
  constructor(root, clips, { speed, runSpeed }) {
    if (!(runSpeed > 0) || !(speed > 0)) throw new Error('Character locomotion speeds must be positive');
    const byName = new Map(clips.map(clip => [clip.name, clip]));
    for (const name of HUMAN_CLIPS) if (!byName.has(name)) throw new Error(`Missing animation: ${name}`);
    this.mixer = new THREE.AnimationMixer(root);
    this.actions = new Map(HUMAN_CLIPS.map(name => [name, this.mixer.clipAction(byName.get(name))]));
    this.root = root;
    this.runRate = speed / runSpeed;
    this.moving = false;
    this.oneShot = false;
    this.retiring = new Map();
    this.onFinished = ({ action }) => { if (action === this.current) this.finished = true; };
    this.mixer.addEventListener('finished', this.onFinished);
    this.change('Idle_Loop', 0);
  }

  change(name, fade = .16) {
    const next = this.actions.get(name);
    if (next === this.current && !this.oneShot) return;
    const previous = this.current;
    this.current = next;
    this.name = name;
    this.oneShot = !name.endsWith('_Loop');
    this.finished = false;
    this.retiring.delete(next);
    next.reset().setEffectiveWeight(1).setEffectiveTimeScale(name === 'Run_Loop' ? this.runRate : 1);
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

  update(dt, moving) {
    this.moving = moving;
    if (moving && this.name !== 'Run_Loop') this.change('Run_Loop');
    else if (!moving && !this.oneShot && this.name !== 'Idle_Loop') this.change('Idle_Loop');
    this.mixer.update(dt);
    for (const [action, remaining] of this.retiring) {
      if (remaining <= dt) { action.stop(); this.retiring.delete(action); }
      else this.retiring.set(action, remaining - dt);
    }
    if (this.finished) this.change(moving ? 'Run_Loop' : 'Idle_Loop');
  }

  dispose() {
    this.mixer.removeEventListener('finished', this.onFinished);
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.retiring.clear();
  }
}
