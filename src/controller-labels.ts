import {
  CONTROLLER_LAYOUTS,
  parseControllerLayout,
  type ControllerLayout,
} from '../shared/controller-layout.mjs';

// Set from this PC's runtime config before rendering any screen. It affects labels only.
let layout: ControllerLayout = 'ps4';

export function setControllerLayout(value: unknown): void {
  layout = parseControllerLayout(value);
}

export function controllerLabels() {
  return CONTROLLER_LAYOUTS[layout];
}

export function controllerMenuHint(): string {
  const pad = controllerLabels();
  return `十字キー・左スティックで選ぶ · ${pad.right} で決定 · ${pad.bottom}（下のボタン）か ${pad.menu} で閉じる`;
}
