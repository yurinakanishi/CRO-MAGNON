import type { CueAction, CueContext } from './input-cues.js';

export interface TouchMovement {
  x: number;
  y: number;
  running: boolean;
}

/** Touch can also reach the hotbar's cooking, boat and carry-refusal buttons, which have no
 * keyboard cue. */
export type TouchCommand = CueAction | 'cook' | 'launch' | 'recover' | 'decline';
export interface TouchItem {
  action: TouchCommand;
  label: string;
}
export interface TouchContext extends CueContext {
  cook?: string;
  launch?: string;
  recover?: string;
  decline?: string;
  /** The attack profile key, shown as the attack button's glyph. */
  weapon?: string;
  /** Share of the attack recharge still to run: 1 just after an attack, 0 when ready. */
  cooldown?: number;
}
export type TouchSkillSlot = 'near' | 'far' | 'high';

/** Radial deadzone and gait hysteresis keep a resting thumb still. */
export function touchStick(
  dx: number,
  dy: number,
  radius: number,
  wasRunning = false,
): TouchMovement {
  const length = Math.hypot(dx, dy);
  if (!Number.isFinite(length) || radius <= 0 || length / radius <= 0.16)
    return { x: 0, y: 0, running: false };
  const magnitude = Math.min(1, (length / radius - 0.16) / 0.84);
  return {
    x: (dx / length) * magnitude,
    y: (dy / length) * magnitude,
    running: length / radius >= (wasRunning ? 0.64 : 0.78),
  };
}

/** Each available action has its own touch target, without a keyboard's three-cue limit. */
export function touchActions(context: CueContext): { action: CueAction; label: string }[] {
  if (context.viewing && !context.automaticCamera)
    return [
      { action: 'zoomIn', label: '近く' },
      { action: 'zoomOut', label: '遠く' },
      { action: 'endInspect', label: '戻る' },
    ];
  if (context.busy) return [{ action: 'cancel', label: 'やめる' }];
  const actions: { action: CueAction; label: string }[] = [];
  const add = (action: CueAction, label?: string) => {
    if (label) actions.push({ action, label });
  };
  add('pet', context.pet);
  if (context.interaction !== context.pet) add('interact', context.interaction);
  add('ride', context.ride);
  add('board', context.board);
  if (context.inspect && !context.automaticCamera) add('inspect', `${context.inspect}を見る`);
  if (context.recall) add('recall', 'みんなを呼ぶ');
  if (context.throw) add('throw', '1匹投げる');
  add('torch', context.torch);
  return actions;
}

const SKILLS: readonly TouchCommand[] = ['throw', 'torch', 'recall'];
const PROMPT_ORDER: readonly TouchCommand[] = [
  'zoomIn',
  'zoomOut',
  'endInspect',
  'cancel',
  'pet',
  'interact',
  'cook',
  'ride',
  'decline',
  'board',
  'recover',
  'launch',
  'inspect',
];

/**
 * The phone layout: up to three things to do here (the first is nearest the thumb), and the
 * abilities that keep their own places around the attack button.
 */
export function touchLayout(context: TouchContext): { prompts: TouchItem[]; skills: TouchItem[] } {
  const items: TouchItem[] = touchActions(context);
  if (!context.busy && !(context.viewing && !context.automaticCamera))
    for (const action of ['cook', 'decline', 'recover', 'launch'] as const) {
      const label = context[action];
      if (label) items.push({ action, label });
    }
  return {
    prompts: items
      .filter((item) => !SKILLS.includes(item.action))
      .sort((a, b) => PROMPT_ORDER.indexOf(a.action) - PROMPT_ORDER.indexOf(b.action))
      .slice(0, 3),
    skills: items.filter((item) => SKILLS.includes(item.action)),
  };
}

/** A place a thumb can learn: calling back sits high, throwing and the torch (a cave allows
 * only the torch) take the place nearest the thumb; anything further waits above. */
export function touchSkillSlots(skills: readonly TouchItem[]): Map<TouchCommand, TouchSkillSlot> {
  const free: TouchSkillSlot[] = ['near', 'far', 'high'],
    slots = new Map<TouchCommand, TouchSkillSlot>();
  for (const { action } of skills) {
    const preferred = free.indexOf(action === 'recall' ? 'far' : 'near');
    const [slot] = free.splice(preferred < 0 ? 0 : preferred, 1);
    if (slot) slots.set(action, slot);
  }
  return slots;
}

const ICONS: Partial<Record<TouchCommand, string>> = {
  pet: 'heart',
  inspect: 'eye',
  board: 'boat',
  launch: 'boat',
  recover: 'boat',
  cook: 'flame',
  decline: 'close',
  recall: 'call',
  throw: 'throw',
  torch: 'torch',
  cancel: 'close',
  zoomIn: 'plus',
  zoomOut: 'minus',
  endInspect: 'back',
  bag: 'bag',
  jump: 'jump',
};

/** One glyph per action; an interaction or a ride reads its target from the label. */
export function touchIcon(action: TouchCommand, label = ''): string {
  if (action === 'interact')
    return /木材|木を/.test(label)
      ? 'wood'
      : /石/.test(label)
        ? 'stone'
        : /ベリー/.test(label)
          ? 'berry'
          : /貝/.test(label)
            ? 'shell'
            : /交換/.test(label)
              ? 'exchange'
              : /肉/.test(label)
                ? 'meat'
                : /火/.test(label)
                  ? 'flame'
                  : 'hand';
  if (action === 'ride') return /マンモス/.test(label) ? 'mammoth' : 'people';
  return ICONS[action] ?? 'hand';
}

const WEAPON_ICONS = ['spear', 'katana', 'magic', 'science', 'unarmed', 'tentacle'];
export const touchWeaponIcon = (weapon = '') => (WEAPON_ICONS.includes(weapon) ? weapon : 'spear');

const wrap = (angle: number) => Math.atan2(Math.sin(angle), Math.cos(angle));

/** Touch orbit takes priority. Follow resumes only during travel, after a quiet interval. */
export class TouchCameraFollow {
  enabled = false;
  private heading: number | null = null;
  private holdUntil = 0;
  movement(dx: number, dz: number) {
    this.heading = Math.hypot(dx, dz) > 0.04 ? Math.atan2(dx, dz) + Math.PI : null;
  }
  hold(now: number) {
    this.holdUntil = now + 2200;
  }
  reset() {
    this.heading = null;
    this.holdUntil = 0;
  }
  step(yaw: number, now: number, dt: number, dragging: boolean) {
    if (!this.enabled || this.heading === null || dragging || now < this.holdUntil) return yaw;
    return wrap(yaw + wrap(this.heading - yaw) * (1 - Math.exp(-Math.min(dt, 0.1) * 2.4)));
  }
}

/** Keep enough horizontal room for the world and actor on a tall, narrow phone. */
export function touchFieldOfView(aspect: number, touch: boolean) {
  return touch && aspect < 1
    ? Math.min(
        88,
        Math.max(57, (2 * Math.atan(Math.tan((44 * Math.PI) / 360) / aspect) * 180) / Math.PI),
      )
    : 57;
}
