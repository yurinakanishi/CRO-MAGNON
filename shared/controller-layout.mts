/** Labels follow the physical positions of the browser's standard Gamepad mapping. */
export const CONTROLLER_LAYOUTS = {
  ps4: {
    name: 'PS4 / DUALSHOCK 4',
    bottom: '×',
    right: '○',
    left: '□',
    top: '△',
    leftShoulder: 'L1',
    rightShoulder: 'R1',
    leftTrigger: 'L2',
    rightTrigger: 'R2',
    menu: 'OPTIONS',
    map: 'SHARE / タッチパッド',
    rightStick: 'R3',
  },
  'switch-pro': {
    name: 'Nintendo Switch Pro',
    bottom: 'B',
    right: 'A',
    left: 'Y',
    top: 'X',
    leftShoulder: 'L',
    rightShoulder: 'R',
    leftTrigger: 'ZL',
    rightTrigger: 'ZR',
    menu: '＋',
    map: '−',
    rightStick: '右スティック押し込み',
  },
} as const;

export type ControllerLayout = keyof typeof CONTROLLER_LAYOUTS;

/** Missing settings retain the original PS4 labels; invalid settings must be corrected. */
export function parseControllerLayout(value: unknown): ControllerLayout {
  if (value === undefined) return 'ps4';
  if (value === 'ps4' || value === 'switch-pro') return value;
  throw new Error('コントローラー表記は ps4 または switch-pro にしてください。');
}
