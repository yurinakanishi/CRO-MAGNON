// Browser standard mapping: DualShock 4 uses the same indices over USB/Bluetooth.
// Unmapped devices are reported instead of guessing which button is an action.
export const PAD = {
  cross: 0,
  circle: 1,
  square: 2,
  triangle: 3,
  l1: 4,
  r1: 5,
  l2: 6,
  r2: 7,
  share: 8,
  options: 9,
  l3: 10,
  r3: 11,
  up: 12,
  down: 13,
  left: 14,
  right: 15,
  touchpad: 17,
} as const;

export const STICK = { deadzone: 0.16, lookDeadzone: 0.18, runEnter: 0.78, runExit: 0.68 };
export type InputMode = 'game' | 'menu' | 'blocked';
export type Direction = 'up' | 'down' | 'left' | 'right';
export type PadAction =
  | 'confirm'
  | 'cancel'
  | 'attack'
  | 'jump'
  | 'ride'
  | 'map'
  | 'menu'
  | 'inventory'
  | 'journal'
  | 'center'
  | 'zoomIn'
  | 'zoomOut';
export type PadDevice = Pick<
  Gamepad,
  'index' | 'id' | 'connected' | 'mapping' | 'axes' | 'buttons'
>;
export interface PadMovement {
  x: number;
  y: number;
  running: boolean;
}
export interface PadFrame {
  status: 'connected' | 'disconnected' | 'unsupported';
  index: number | null;
  move: PadMovement;
  look: { x: number; y: number };
  actions: PadAction[];
  navigation: Direction | null;
  /** L3 held during play: the item and action bar stays visible while true. */
  hotbar: boolean;
  active: boolean;
}

const gameBindings: [number, PadAction][] = [
  [PAD.cross, 'jump'],
  [PAD.circle, 'confirm'],
  [PAD.square, 'attack'],
  [PAD.r2, 'attack'],
  [PAD.l2, 'cancel'],
  [PAD.triangle, 'ride'],
  [PAD.share, 'map'],
  [PAD.touchpad, 'map'],
  [PAD.options, 'menu'],
  [PAD.r3, 'center'],
  [PAD.l1, 'zoomOut'],
  [PAD.r1, 'zoomIn'],
];
const menuBindings: [number, PadAction][] = [
  [PAD.cross, 'confirm'],
  [PAD.circle, 'confirm'],
  [PAD.square, 'confirm'],
  [PAD.triangle, 'confirm'],
  [PAD.options, 'menu'],
];
const directions: Direction[] = ['up', 'down', 'left', 'right'];
const usedButtons = [
  ...new Set([...gameBindings.map(([index]) => index), ...directions.map((d) => PAD[d]), PAD.l3]),
];
const finiteAxis = (value: number | undefined) =>
  Number.isFinite(value) ? Math.max(-1, Math.min(1, value!)) : 0;

/** Radial deadzone preserves analog strength and limits diagonals to unit length. */
export function readStick(x: number | undefined, y: number | undefined, deadzone = STICK.deadzone) {
  x = finiteAxis(x);
  y = finiteAxis(y);
  const length = Math.hypot(x, y),
    magnitude = Math.min(1, length);
  if (magnitude <= deadzone) return { x: 0, y: 0, magnitude: 0 };
  const scale = (magnitude - deadzone) / (1 - deadzone) / length;
  return { x: x * scale, y: y * scale, magnitude };
}

export class GamepadInput {
  private identity = '';
  private index: number | null = null;
  private mode: InputMode = 'blocked';
  private armed = false;
  private previous = new Set<number>();
  private running = false;
  private repeatDirection: Direction | null = null;
  private repeatAt = 0;

  /** A new context must see neutral controls before accepting input again. */
  suspend() {
    this.armed = false;
    this.running = false;
    this.previous.clear();
    this.repeatDirection = null;
  }

  sample(devices: readonly (PadDevice | null)[], mode: InputMode, now: number): PadFrame {
    const connected = devices.filter((p): p is PadDevice => !!p?.connected);
    const supported = connected.filter(
      (p) => p.mapping === 'standard' && p.axes.length >= 4 && p.buttons.length >= 16,
    );
    const pad = supported.find((p) => p.index === this.index) ?? supported[0];
    const identity = pad ? `${pad.index}:${pad.id}` : '';
    if (identity !== this.identity || mode !== this.mode) this.suspend();
    this.identity = identity;
    this.index = pad?.index ?? null;
    this.mode = mode;
    const frame: PadFrame = {
      status: pad ? 'connected' : connected.length ? 'unsupported' : 'disconnected',
      index: this.index,
      move: { x: 0, y: 0, running: false },
      look: { x: 0, y: 0 },
      actions: [],
      navigation: null,
      hotbar: false,
      active: false,
    };
    if (!pad) return frame;
    const left = readStick(pad.axes[0], pad.axes[1]);
    const right = readStick(pad.axes[2], pad.axes[3], STICK.lookDeadzone);
    const held = new Set(
      usedButtons.filter((index) => {
        const button = pad.buttons[index];
        return button?.pressed || (Number.isFinite(button?.value) && button.value >= 0.5);
      }),
    );
    if (mode === 'blocked') this.suspend();
    if (!this.armed) {
      this.armed = mode !== 'blocked' && !left.magnitude && !right.magnitude && !held.size;
      this.previous = held;
      return frame;
    }
    const pressed = (index: number) => held.has(index) && !this.previous.has(index);
    frame.active = !!(left.magnitude || right.magnitude || held.size);
    for (const [index, action] of mode === 'menu' ? menuBindings : gameBindings) {
      if (pressed(index) && !frame.actions.includes(action)) frame.actions.push(action);
    }
    if (mode === 'game') {
      this.running = left.magnitude >= (this.running ? STICK.runExit : STICK.runEnter);
      frame.move = { x: left.x, y: left.y, running: this.running };
      frame.look = { x: right.x, y: right.y };
      frame.hotbar = held.has(PAD.l3);
      for (const [dir, action] of [
        ['up', 'map'],
        ['down', 'menu'],
        ['left', 'inventory'],
        ['right', 'journal'],
      ] as const) {
        if (pressed(PAD[dir])) frame.actions.push(action);
      }
    } else {
      frame.look = { x: right.x, y: right.y };
      let direction = directions.find((d) => held.has(PAD[d])) ?? null;
      if (!direction && left.magnitude >= 0.55) {
        direction =
          Math.abs(left.x) > Math.abs(left.y)
            ? left.x < 0
              ? 'left'
              : 'right'
            : left.y < 0
              ? 'up'
              : 'down';
      }
      if (direction && (direction !== this.repeatDirection || now >= this.repeatAt)) {
        frame.navigation = direction;
        this.repeatAt = now + (direction === this.repeatDirection ? 150 : 380);
      }
      this.repeatDirection = direction;
    }
    this.previous = held;
    return frame;
  }
}

/** Keyboard movement wins when both devices are used; run toggles never affect the stick. */
export function combineMovement(x: number, y: number, running: boolean, pad: PadMovement) {
  return x || y || !(pad.x || pad.y) ? { x, y, running } : { ...pad };
}
