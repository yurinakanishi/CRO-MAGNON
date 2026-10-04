import {
  CONTROLLER_LAYOUTS,
  parseControllerLayout,
  type ControllerLayout,
} from '../shared/controller-layout.mjs';

// Set from this PC's runtime config before rendering any screen. It affects labels only.
let layout: ControllerLayout = 'ps4';
export type ControllerKind = ControllerLayout | 'xbox' | 'generic';
let connectedLayout: ControllerKind | null = null;

const extraLabels = {
  xbox: {
    name: 'Xbox',
    bottom: 'A',
    right: 'B',
    left: 'X',
    top: 'Y',
    leftShoulder: 'LB',
    rightShoulder: 'RB',
    leftTrigger: 'LT',
    rightTrigger: 'RT',
    menu: '≡',
    map: '▣',
    rightStick: 'RS',
  },
  generic: {
    name: 'コントローラー',
    bottom: '下',
    right: '右',
    left: '左',
    top: '上',
    leftShoulder: 'L',
    rightShoulder: 'R',
    leftTrigger: 'LT',
    rightTrigger: 'RT',
    menu: '≡',
    map: '▣',
    rightStick: 'RS',
  },
} as const;

/** Device names change labels only; actions always follow the browser standard mapping. */
export function detectControllerLayout(id: string): ControllerKind {
  if (/nintendo|switch|pro controller|joy-con|057e/i.test(id)) return 'switch-pro';
  if (/xbox|xinput|045e/i.test(id)) return 'xbox';
  if (/dualsense|dualshock|playstation|ps[45]|054c|^wireless controller(?:\s*\(|$)/i.test(id))
    return 'ps4';
  return 'generic';
}

export function setConnectedController(id: string | null, configured = false): boolean {
  const next = id === null ? null : configured ? layout : detectControllerLayout(id);
  if (connectedLayout === next) return false;
  connectedLayout = next;
  return true;
}

export function controllerKind(): ControllerKind {
  return connectedLayout ?? layout;
}

export function setControllerLayout(value: unknown): void {
  layout = parseControllerLayout(value);
}

export function controllerLabels() {
  const kind = controllerKind();
  return kind === 'xbox' || kind === 'generic' ? extraLabels[kind] : CONTROLLER_LAYOUTS[kind];
}

export function controllerMenuHint(): string {
  const pad = controllerLabels();
  return `十字キー・左スティックで選ぶ · ${pad.right} で決定 · ${pad.bottom}（下のボタン）か ${pad.menu} で閉じる`;
}
