/**
 * "How to play" content for the in-game
 * help dialog: one card grid per input device, switched with tabs so the same
 * layout serves keyboard/mouse and the configured controller.
 */
import { controllerLabels } from './controller-labels.js';

export type HelpDevice = 'pc' | 'pad';

export interface HelpCard {
  key: string;
  title: string;
  note: string;
}

export const PC_HELP: readonly HelpCard[] = [
  {
    key: 'L',
    title: '洞窟の松明',
    note: '洞窟に入ると松明を持ちます。Lまたはメニューで持つ／しまうを切り替え。近くの壁画へ歩み寄ると、松明の明かりで絵が浮かび上がります。外に出るとしまいます。',
  },
  {
    key: 'V · C · Z · Q · T',
    title: 'dotsを撫でる・投げる・帰す',
    note: '近くでVを1回押すと、集まったbotたちを一度に撫でます。全員が同時に喜んで仲間になります。歩き出すかQで中断できます。メニューの「botたち」からもまとめて撫でられます。1匹だけならクリック・タップ。Cで1匹ずつ投げ、投げた場所で待つ仲間をQで呼び戻します。Zで投げ始める種類を変更。Tでいちばん近い仲間を元の場所へ帰します。メニューから1匹・全員を帰せます。「みんなを帰してひとりで歩く」では猫と524も帰ります。',
  },
  {
    key: 'V / T',
    title: '524といっしょに',
    note: 'キャンプの524に近づいてVで撫で終えると、時間制限なく仲間になります。再接続しても撫で直す必要はありません。Cでdotsと一緒に順番に投げ、Qで呼び戻せます。Tまたはメニューの「524をキャンプへ帰す」でお別れ。',
  },
  {
    key: 'W A S D',
    title: '移動',
    note: '同じ方向を素早く2回押すと走ります。Shift で走る／歩くを切り替え。',
  },
  {
    key: 'ドラッグ',
    title: '視点',
    note: 'マウスや指でドラッグして周囲を見渡します。ホイールか＋・−でカメラの距離を調整し、「視点を戻す」で元に戻します。',
  },
  {
    key: 'E',
    title: '調べる・採集',
    note: '木や石、焚き火、仲間、肉に近づいて押します。生肉を食べると体力が15回復します。焚き火で3秒焼き、焼き肉を食べると45回復します。',
  },
  {
    key: 'F / 5',
    title: '攻撃',
    note: '相手の方を向いて押します。槍・刀・魔法・大きな手など、攻撃方法はキャラクターによって異なります。',
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
    note: '生きているマンモスの横でRを押すと乗れます。大猿が誘い、魔法使いが応じると、大猿の肩に乗れます。',
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
    note: 'メニューの「ワープする」で拠点・洞窟など6か所へ移動。M の地図は焚き火を押して選び、もう一度押すとワープ。ホイールで拡大、右クリックでピンを仲間に共有。メニューからキャラクター変更。I でもちもの、G で手をふる、H で操作説明。',
  },
];

export function padHelp(): readonly HelpCard[] {
  const pad = controllerLabels();
  return [
    {
      key: 'メニュー',
      title: '洞窟の松明',
      note: '洞窟に入ると松明を持ちます。メニューの「松明をしまう／持つ」で切り替え。壁画に近づくと、近くの絵だけが明かりに照らされます。',
    },
    {
      key: '左スティック押し込み · ↑',
      title: 'dotsを撫でる・投げる・帰す',
      note: `近くで${pad.bottom}を1回押すと、集まったbotたちを一度に撫でます。全員が同時に喜んで仲間になります。歩き出すか十字キー↑で中断できます。メニューの「botたち」からもまとめて撫でられます。左スティック押し込みで次の1匹を投げ、十字キー↑で呼び戻します。メニューから1匹・全員を元の場所へ帰せます。「みんなを帰してひとりで歩く」では猫と524も帰ります。`,
    },
    { key: '左スティック', title: '移動', note: '浅く倒すと歩き、深く倒すと走ります。' },
    {
      key: '右スティック',
      title: '視点',
      note: `カメラを回します。${pad.leftShoulder} / ${pad.rightShoulder} でカメラの距離を調整し、${pad.rightStick} で元に戻します。`,
    },
    {
      key: pad.right,
      title: '調べる・採集',
      note: '木や石、焚き火、仲間、肉に近づいて押します。メニューでは決定。',
    },
    {
      key: `${pad.left} / ${pad.rightTrigger}`,
      title: '攻撃',
      note: '相手の方を向いて押します。槍・刀・魔法・大きな手など、攻撃方法はキャラクターによって異なります。',
    },
    {
      key: `${pad.top}（上）`,
      title: 'ジャンプ',
      note: '右側4ボタンの上。歩きながら、走りながらも跳べます。着地してからもう一度。',
    },
    {
      key: `${pad.bottom}（下）`,
      title: '撫でる・乗り降り / 戻る',
      note: `524を撫で終えると、時間制限なく仲間になります。再接続後もそのまま。左スティック押し込みでdotsと一緒に順番に投げ、十字↑で呼び戻せます。${pad.menu}の「524をキャンプへ帰す」でお別れ。マンモス、肩乗り、船のそばでは乗り降り。メニューや地図では戻る／閉じる。`,
    },
    { key: pad.leftTrigger, title: '作業を中止', note: '採集や調理の途中でやめます。' },
    {
      key: '十字キー',
      title: 'もちもの・手帳・メニュー',
      note: `← もちもの · → 手帳 · ↓ メニュー。食べ物を使うときは、もちものから選びます。地図は ${pad.map}。`,
    },
    {
      key: pad.menu,
      title: 'メニュー（もちもの）',
      note: `メニューを開くと、もちもの一覧の左上の項目が選択されています。十字キーか左スティックで選び、${pad.right} で決定 → 「使う」で回復。「ワープする」で拠点・洞窟など6か所へ移動。${pad.bottom} で戻る／閉じる。キャラクターを変更するには、「キャラクターを変える」を選びます。`,
    },
    {
      key: pad.map,
      title: '地図（もう一度押すと閉じる）',
      note: `左スティックでポインタを動かし、右スティックで地図を拡大・縮小します。焚き火に合わせて ${pad.right} で選び、もう一度 ${pad.right} でワープ。${pad.left} でピンを共有、${pad.rightStick} で現在地へ、${pad.bottom} か ${pad.menu} で閉じる。`,
    },
  ];
}

const card = ({ key, title, note }: HelpCard) =>
  `<div class="help-card"><kbd>${key}</kbd><strong>${title}</strong><p>${note}</p></div>`;

/** Tabs plus both device panels; `device` chooses the tab shown first. */
export function helpTabsMarkup(
  device: HelpDevice,
  extra: readonly HelpCard[] = [],
  controllerOnly = false,
): string {
  const selected = controllerOnly ? 'pad' : device;
  const tab = (id: HelpDevice, label: string) =>
    `<button type="button" class="help-tab" role="tab" data-help-tab="${id}" aria-selected="${selected === id}" aria-controls="help-panel-${id}">${label}</button>`;
  const panel = (id: HelpDevice, cards: readonly HelpCard[], head = '') =>
    `<div class="help-panel" id="help-panel-${id}" role="tabpanel" data-help-panel="${id}" ${selected === id ? '' : 'hidden'}>${head}<div class="help-grid">${[...cards, ...extra].map(card).join('')}</div></div>`;
  return `<div class="help-tabs" role="tablist" aria-label="操作方法の切り替え">${controllerOnly ? '' : tab('pc', 'PC（キーボード・マウス）')}${tab('pad', `コントローラー（${controllerLabels().name}）`)}</div>${controllerOnly ? '' : panel('pc', PC_HELP)}${panel(
    'pad',
    padHelp(),
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
