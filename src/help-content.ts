/**
 * "How to play" content shared by the pre-play guide screen and the in-game
 * help dialog: one card grid per input device, switched with tabs so the same
 * layout serves keyboard/mouse and the DUALSHOCK 4 controller.
 */
export type HelpDevice = 'pc' | 'pad';

export interface HelpCard {
  key: string;
  title: string;
  note: string;
}

export const PC_HELP: readonly HelpCard[] = [
  {
    key: 'W A S D',
    title: '移動',
    note: '同じ方向を素早く2回押すと走ります。「走る」ボタンでも切り替えられます。',
  },
  {
    key: 'ドラッグ',
    title: '視点',
    note: 'マウスや指のドラッグで見渡します。ホイールか＋・−で距離、「視点を戻す」で元に戻す。',
  },
  {
    key: 'E',
    title: '調べる・採集',
    note: '木や石、焚き火、仲間、肉に近づいて押します。焚き火で肉を焼き、3秒後に食べられます。',
  },
  {
    key: 'F / 5',
    title: '攻撃',
    note: '相手を向いて押します。槍・刀・魔法・大きな手はキャラクターで変わります。',
  },
  {
    key: 'Space',
    title: 'ジャンプ',
    note: '歩きながら、走りながらも跳べます。着地してからもう一度。',
  },
  {
    key: '1 · 2 · 3 · 4',
    title: 'アクションを選ぶ',
    note: '採集・道具づくり・資材を届ける・交換。',
  },
  {
    key: 'R',
    title: 'マンモス・肩に乗る',
    note: '生きているマンモスの横で。大猿が誘い、魔法使いが応じると肩に乗れます。',
  },
  {
    key: 'B',
    title: '船',
    note: '木材12個を持って岸で「船をつくる」。B で乗り降り、WASD で操船。',
  },
  {
    key: 'Enter',
    title: '仲間と話す',
    note: 'チャットを開き、Enter で送信。',
  },
  {
    key: 'ESC · M · I · J',
    title: 'メニュー・地図・もちもの・手帳',
    note: 'M の地図で焚き火を選び「ワープ」で移動。Tab を押している間、もちものと行動の欄を表示。G で手をふる。H でこの画面。',
  },
];

export const PAD_HELP: readonly HelpCard[] = [
  { key: '左スティック', title: '移動', note: '浅く倒すと歩き、深く倒すと走ります。' },
  {
    key: '右スティック',
    title: '視点',
    note: 'カメラを回します。L1 / R1 で距離、R3 で元に戻す。',
  },
  {
    key: '×',
    title: '調べる・採集',
    note: '木や石、焚き火、仲間、肉に近づいて押します。メニューでは決定。',
  },
  {
    key: '□ / R2',
    title: '攻撃',
    note: '相手を向いて押します。槍・刀・魔法・大きな手はキャラクターで変わります。',
  },
  {
    key: 'L2',
    title: 'ジャンプ',
    note: '歩きながら、走りながらも跳べます。着地してからもう一度。',
  },
  { key: '△', title: '乗る・降りる', note: 'マンモス、肩乗り、船のそばで。' },
  { key: '○', title: '作業を中止', note: '採集や調理の途中でやめます。' },
  {
    key: '十字キー',
    title: '地図・もちもの・手帳・メニュー',
    note: '↑ 地図 · ← もちもの · → 手帳 · ↓ メニュー。L3 を押している間、もちもの欄を表示。',
  },
  {
    key: 'OPTIONS',
    title: 'メニュー',
    note: '開く／閉じる。項目は十字キーか左スティックで選び、×○□△のどれでも決定。',
  },
  {
    key: 'タッチパッド / SHARE',
    title: '地図',
    note: '地図の一覧を左右で選び、ワープボタンで決定。文字入力はキーボード。',
  },
];

const card = ({ key, title, note }: HelpCard) =>
  `<div class="help-card"><kbd>${key}</kbd><strong>${title}</strong><p>${note}</p></div>`;

/** Tabs plus both device panels; `device` chooses the tab shown first. */
export function helpTabsMarkup(device: HelpDevice, extra: readonly HelpCard[] = []): string {
  const tab = (id: HelpDevice, label: string) =>
    `<button type="button" class="help-tab" role="tab" data-help-tab="${id}" aria-selected="${device === id}" aria-controls="help-panel-${id}">${label}</button>`;
  const panel = (id: HelpDevice, cards: readonly HelpCard[], head = '') =>
    `<div class="help-panel" id="help-panel-${id}" role="tabpanel" data-help-panel="${id}" ${device === id ? '' : 'hidden'}>${head}<div class="help-grid">${[...cards, ...extra].map(card).join('')}</div></div>`;
  return `<div class="help-tabs" role="tablist" aria-label="操作方法の切り替え">${tab('pc', 'PC（キーボード・マウス）')}${tab('pad', 'コントローラー（DUALSHOCK 4）')}</div>${panel('pc', PC_HELP)}${panel(
    'pad',
    PAD_HELP,
    '<p class="gamepad-connection help-status" role="status"></p>',
  )}`;
}

/** Wires the tab buttons inside `root`; the controller can press them like any menu button. */
export function bindHelpTabs(root: ParentNode): void {
  const tabs = [...root.querySelectorAll<HTMLButtonElement>('.help-tab')];
  for (const tab of tabs)
    tab.addEventListener('click', () => {
      const id = tab.dataset.helpTab;
      for (const t of tabs) t.setAttribute('aria-selected', String(t === tab));
      for (const panel of root.querySelectorAll<HTMLElement>('.help-panel'))
        panel.hidden = panel.dataset.helpPanel !== id;
    });
}
