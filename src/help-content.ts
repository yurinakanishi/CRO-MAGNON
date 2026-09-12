/**
 * "How to play" content for the in-game
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
    note: '同じ方向を素早く2回押すと走ります。Shift で走る／歩くを切り替え。',
  },
  {
    key: 'ドラッグ',
    title: '視点',
    note: 'マウスや指のドラッグで見渡します。ホイールか＋・−で距離、「視点を戻す」で元に戻す。',
  },
  {
    key: 'E',
    title: '調べる・採集',
    note: '木や石、焚き火、仲間、肉に近づいて押します。生肉はそのままでHP+15、焚き火で3秒焼くとHP+45。',
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
    note: 'M の地図は焚き火を押して選び、もう一度押すとワープ。ホイールで拡大、右クリックでピンを仲間に共有。メニューからキャラクター変更。I でもちもの、G で手をふる、H で操作説明。',
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
    key: '○',
    title: '調べる・採集',
    note: '木や石、焚き火、仲間、肉に近づいて押します。メニューでは決定。',
  },
  {
    key: '□ / R2',
    title: '攻撃',
    note: '相手を向いて押します。槍・刀・魔法・大きな手はキャラクターで変わります。',
  },
  {
    key: '△（上）',
    title: 'ジャンプ',
    note: '右側4ボタンの上。歩きながら、走りながらも跳べます。着地してからもう一度。',
  },
  {
    key: '×（下）',
    title: '乗る・降りる / 戻る',
    note: '右側4ボタンの下。マンモス、肩乗り、船のそばで乗り降り。メニューや地図では戻る／閉じる。',
  },
  { key: 'L2', title: '作業を中止', note: '採集や調理の途中でやめます。' },
  {
    key: '十字キー',
    title: 'もちもの・手帳・メニュー',
    note: '← もちもの · → 手帳 · ↓ メニュー。食べ物を使うときは、もちものから選びます。地図は SHARE／タッチパッド。',
  },
  {
    key: 'OPTIONS',
    title: 'メニュー（もちもの）',
    note: '開くとすぐ、もちものの左上に合っています。十字キーか左スティックで選び、○ で決定 → 「使う」で回復。× で戻る／閉じる。「探索に戻る」の上でキャラクター変更。',
  },
  {
    key: 'タッチパッド / SHARE',
    title: '地図（もう一度押すと閉じる）',
    note: '左スティックでポインタ、右スティックで拡大。焚き火に合わせて ○ で選び、もう一度 ○ でワープ。□ でピンを共有、R3 で現在地へ、× か OPTIONS で閉じる。',
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
