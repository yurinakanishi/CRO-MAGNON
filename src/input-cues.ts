import { controllerLabels, type ControllerKind } from './controller-labels.js';
import { PAD, readStick, STICK, type PadDevice } from './gamepad-input.js';

export type CueAction =
  | 'interact'
  | 'pet'
  | 'ride'
  | 'board'
  | 'attack'
  | 'jump'
  | 'throw'
  | 'recall'
  | 'cancel'
  | 'torch'
  | 'bag'
  | 'inspect'
  | 'zoomIn'
  | 'zoomOut'
  | 'endInspect';
export interface InputCue {
  action: CueAction;
  label: string;
  key: string;
  controls: readonly string[];
}
export interface CueContext {
  automaticCamera?: boolean;
  pet?: string;
  interaction?: string;
  ride?: string;
  board?: string;
  attack?: boolean;
  jump?: boolean;
  throw?: boolean;
  recall?: boolean;
  busy?: boolean;
  torch?: string;
  needsFood?: boolean;
  inspect?: string;
  viewing?: boolean;
}

/** Priority follows the real handlers: the bottom button pets before boarding/riding. */
export function contextCues(context: CueContext, pad: boolean): InputCue[] {
  const cues: InputCue[] = [];
  const add = (action: CueAction, label: string, key: string, ...controls: string[]) =>
    cues.push({ action, label, key, controls });
  if (context.viewing && !context.automaticCamera) {
    add('zoomIn', '近く', '+', 'b5');
    add('zoomOut', '遠く', '−', 'b4');
    add('endInspect', '戻る', 'Esc', 'b11', 'b6');
    return cues;
  }
  if (context.busy) {
    if (pad) add('cancel', 'やめる', '', 'b6');
    return cues;
  }
  if (context.pet) add('pet', context.pet, 'V', 'b0');
  if (context.recall) add('recall', 'みんなを呼ぶ', 'Q', 'b12');
  if (context.inspect && !context.automaticCamera)
    add('inspect', `${context.inspect}を見る`, 'X', 'b5');
  if (context.interaction && context.interaction !== context.pet)
    add('interact', context.interaction, 'E', 'b1');
  if (!pad || !context.pet) {
    if (context.board) add('board', context.board, 'B', 'b0');
    else if (context.ride) add('ride', context.ride, 'R', 'b0');
  }
  if (context.attack) add('attack', '攻撃', 'F', 'b2', 'b7');
  if (context.throw) add('throw', '1匹投げる', 'C', 'b10');
  if (context.needsFood) add('bag', 'もちもの', 'I', 'b14');
  if (context.torch && !pad) add('torch', context.torch, 'L');
  if (context.jump && cues.length < 3) add('jump', 'ジャンプ', 'Space', 'b3');
  return cues.slice(0, 3);
}

export function pressedControls(pad: PadDevice | null): Set<string> {
  const pressed = new Set<string>();
  if (!pad?.connected || pad.mapping !== 'standard') return pressed;
  pad.buttons.forEach((button, index) => {
    if (button.pressed || button.value >= 0.5) pressed.add(`b${index}`);
  });
  if (readStick(pad.axes[0], pad.axes[1]).magnitude) pressed.add('ls');
  if (readStick(pad.axes[2], pad.axes[3], STICK.lookDeadzone).magnitude) pressed.add('rs');
  return pressed;
}

export function controlLabel(control: string): string {
  const p = controllerLabels();
  const labels: Record<string, string> = {
    b0: p.bottom,
    b1: p.right,
    b2: p.left,
    b3: p.top,
    b4: p.leftShoulder,
    b5: p.rightShoulder,
    b6: p.leftTrigger,
    b7: p.rightTrigger,
    b8: p.map.split(' / ')[0],
    b9: p.menu,
    b10: 'L押込',
    b11: 'R押込',
    b12: '↑',
    b13: '↓',
    b14: '←',
    b15: '→',
    b16: '⌂',
    b17: '▭',
  };
  return labels[control] ?? '';
}

export function controlAction(control: string): string {
  const actions: Record<string, string> = {
    ls: '歩く・走る',
    rs: '見渡す',
    b0: '',
    b1: '',
    b2: '攻撃',
    b3: 'ジャンプ',
    b4: '遠く',
    b5: '近く',
    b6: 'やめる',
    b7: '攻撃',
    b8: '地図',
    b9: 'メニュー',
    b10: '1匹投げる',
    b11: '視点を戻す',
    b12: 'みんなを呼ぶ',
    b13: 'メニュー',
    b14: 'もちもの',
    b15: '手帳',
    b17: '地図',
  };
  return actions[control] ?? '';
}

/** Separate vector shapes allow exact highlights without blurry sprite overlays. */
export function controllerDiagram(kind: ControllerKind): string {
  const symmetric = kind === 'ps4' || kind === 'generic';
  const button = (id: number, x: number, y: number, radius = 12) =>
    `<g data-pad-control="b${id}" class="pad-part"><circle cx="${x}" cy="${y}" r="${radius}"/><text x="${x}" y="${y + 1}">${controlLabel(`b${id}`)}</text></g>`;
  const shoulder = (id: number, x: number, y: number) =>
    `<g data-pad-control="b${id}" class="pad-part"><rect x="${x}" y="${y}" width="47" height="22" rx="8"/><text x="${x + 23.5}" y="${y + 12}">${controlLabel(`b${id}`)}</text></g>`;
  const stick = (id: string, click: number, x: number, y: number) =>
    `<g data-pad-control="${id}" class="pad-part pad-stick"><circle cx="${x}" cy="${y}" r="23"/><path d="M${x - 12} ${y}h24 M${x} ${y - 12}v24"/><g data-pad-control="b${click}" class="pad-part pad-click"><circle cx="${x}" cy="${y}" r="10"/><text x="${x}" y="${y + 1}">${click === PAD.l3 ? 'L' : 'R'}</text></g></g>`;
  const dpadX = symmetric ? 77 : 113,
    dpadY = symmetric ? 115 : 161;
  const leftX = symmetric ? 115 : 77,
    leftY = symmetric ? 165 : 112;
  const center =
    kind === 'ps4'
      ? `<g data-pad-control="b17" class="pad-part"><rect x="139" y="80" width="62" height="29" rx="7"/><text x="170" y="96">▭</text></g>${button(8, 119, 89, 9)}${button(9, 222, 89, 9)}`
      : `${button(8, 145, 95, 10)}${button(9, 194, 95, 10)}${button(16, 169, 125, 8)}`;
  return `<svg class="controller-diagram" viewBox="0 0 340 238" role="img" aria-label="${controllerLabels().name}。光る位置が今使える操作。"><path class="pad-shell" d="M82 61 Q49 60 40 99 L22 184 Q15 220 39 223 Q55 225 81 195 L111 185 Q170 199 229 185 L259 195 Q285 225 301 223 Q325 220 318 184 L300 99 Q291 60 258 61 Z"/>
    ${shoulder(6, 56, 2)}${shoulder(7, 237, 2)}${shoulder(4, 56, 30)}${shoulder(5, 237, 30)}
    <text class="pad-center-caption" x="137" y="57">地図</text><text class="pad-center-caption" x="205" y="57">メニュー</text>
    ${center}${stick('ls', 10, leftX, leftY)}${stick('rs', 11, 224, 165)}
    ${button(12, dpadX, dpadY - 20, 10)}${button(13, dpadX, dpadY + 20, 10)}${button(14, dpadX - 20, dpadY, 10)}${button(15, dpadX + 20, dpadY, 10)}
    ${button(3, 266, 90)}${button(0, 266, 138)}${button(2, 242, 114)}${button(1, 290, 114)}
    <text class="pad-caption" x="82" y="237">歩く・走る</text><text class="pad-caption" x="250" y="237">見渡す</text>
    <path class="pad-caption-line" d="M82 222 L${leftX} ${leftY + 26} M250 222 L224 191"/>
    </svg>`;
}
