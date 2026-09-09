import { readSaved, save, savedSession, saveSession } from './session-storage.js';
import {
  loadMultiplayerConfig,
  multiplayerUrl,
  multiplayerSessionKey,
} from './multiplayer-config.js';
import type { ViewState } from './view-state.js';
import { normalizeCharacter, characterModel } from '../shared/characters.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { characterChoicesMarkup, bindCharacterSelection } from './character-selection.js';
import { WorldRenderer } from './world3d.js';

import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '../shared/world.mjs';
import { HUNTING, nearestCookingFire } from '../shared/hunting.mjs';
import { CROP_INVENTORY, ROOT_RECIPES } from '../shared/crops.mjs';
import { installCropFoodUI } from './crop-food-ui.js';
import { canMount, ridingDistance } from '../shared/riding.mjs';
import { GamepadControls, gamepadHelp } from './gamepad-ui.js';
import { combineMovement } from './gamepad-input.js';
import { canStartJump } from '../shared/jumping.mjs';
import { installBoatControls } from './boat-ui.js';
import {
  inventoryCounts,
  selectedCombatTarget,
  huntInteraction,
  attackReady,
} from './hunting-ui.js';
import {
  canStartAttack,
  isAttackShortcut,
  MovementCommands,
  movementKey,
  acceptsGameShortcut,
} from './combat-input.js';
import { inAttackArc } from '../shared/combat.mjs';
import { interactionVisible } from '../shared/interactions.mjs';
import { ENEMY_GROUNDS, SCENERY } from '../shared/scenery-layout.mjs';
import { CASTLE_GATE } from '../shared/castle-layout.mjs';
import { playerDamageEvent } from './enemy-state.js';
import { BIOMES, biomeAt } from '../shared/biomes.mjs';
import { drawWorldMap, mapProjection, setWorldMapMode, setWorldMapSelection } from './world-map.js';
import {
  EXPEDITION_STOPS as EARTH_STOPS,
  EARTH,
  worldToGeo,
  locationName,
} from '../shared/paleo-geography.mjs';
import { ADVENTURE_STOPS, regionAt } from '../shared/adventure-regions.mjs';
import { installAdventureUI, adventureInteraction } from './adventure-ui.js';
import { installFishingUI, fishingInteraction } from './fishing-ui.js';
import { FISHING } from '../shared/fishing-sites.mjs';
import { COASTAL } from '../shared/coastal-sites.mjs';
import { installCoastalUI, coastalInteraction } from './coastal-ui.js';
import { installGulfUI, gulfInteraction } from './gulf-ui.js';
import { installVillageUI, residentInteraction } from './village-ui.js';
import { GULF_ENTRY, inGulf } from '../shared/gulf-region.mjs';
import { ScreenManager, AreaBanner, guideMarkup, keyPrompts } from './screens.js';
const EXPEDITION_STOPS = [...EARTH_STOPS, ...ADVENTURE_STOPS, GULF_ENTRY];
const locationById = (id) =>
  (id === GULF_ENTRY.id ? GULF_ENTRY : null) ??
  EARTH_STOPS.find((stop) => stop.id === id) ??
  ADVENTURE_STOPS.find((s) => s.id === id);

const icons = {
  shell:
    '<path d="M12 3C5 3 2 8 3 13l5 7h8l5-7c1-5-2-10-9-10Z"/><path d="m8 20-3-9m7 9V7m4 13 3-9M9 20h6"/>',
  blade: '<path d="m12 2 6 9-2 10H8L6 11l6-9Zm0 0v19m0-10 6 0m-6 4-5-4"/>',
  katana: '<path d="m4 21 4-4m-2-3 4 4M8 15C15 10 20 5 21 2c-4 1-9 6-13 11Z"/>',
  magic:
    '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/><path d="m20 3 1 1M3 20l1 1"/>',
  spear: '<path d="m4 21 12-14m-2 0 6-5-1 8-5-3Z"/>',
  meat: '<path d="M5 6c3-3 9-3 12 0s4 9 0 12-10 3-13-1S2 9 5 6Z"/><path d="M7 8c2-2 6-2 8 0s2 6 0 8-6 2-8 0-2-6 0-8Z"/>',
  flame:
    '<path d="M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7-1 4 2 5 3-5Z"/><path d="M10 17c0-2 2-3 2-5 3 3 4 6 0 7-1 0-2-1-2-2Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  bag: '<path d="M8 7V5a4 4 0 0 1 8 0v2M6 7h12l2 14H4L6 7Z"/><path d="M8 13h8v5H8z"/>',
  people:
    '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3V4Zm9 2v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  wood: '<path d="m4 16 12-12 5 5L9 21 4 16Z"/><ellipse cx="6.5" cy="18.5" rx="3" ry="2.5" transform="rotate(45 6.5 18.5)"/><path d="m11 13 5-5m-3 7 5-5"/>',
  stone:
    '<path d="m3 16 4-10 10-2 5 10-6 7H7l-4-5Z"/><path d="m7 6 5 7 5-9m-5 9 4 8m-4-8-9 3m9-3 10 1"/>',
  berry:
    '<circle cx="8" cy="14" r="4"/><circle cx="16" cy="14" r="4"/><circle cx="12" cy="18" r="4"/><path d="M12 11V5m0 3C5 9 6 2 6 2s7 0 6 6Zm0 0c0-6 7-6 7-6s0 6-7 6"/>',
  axe: '<path d="m5 22 12-17m-5 4 5 4 5-7-7-5-3 8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  sound: '<path d="M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 4 5 9H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  target:
    '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  chat: '<path d="M21 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9Z"/><path d="M7 8h10M7 12h7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  jump: '<path d="M12 17V3m-5 5 5-5 5 5M5 20h14"/>',
  leaf: '<path d="M20 3C4 1 1 13 8 17c7 5 14-4 12-14Z"/><path d="M4 22 16 8"/>',
  link: '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
  exchange: '<path d="M3 7h17l-4-4m4 14H3l4 4M20 7l-4 4M3 17l4-4"/>',
  menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
  wave: '<path d="M5 12V8a2 2 0 0 1 3 0V4a2 2 0 0 1 3 0v7-8a2 2 0 0 1 3 0v8-6a2 2 0 0 1 3 0v8l2-3c2-2 4 0 3 2l-4 8c-4 4-13 1-13-4v-4Z"/>',
};
const icon = (name, cls = '') =>
  `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
const GAME_TITLE = 'CRO-MAGNON';
const $ = (s) => document.querySelector(s);
const query = new URLSearchParams(location.search);
const multiplayer = await loadMultiplayerConfig().catch((error) => {
  $('#app').textContent = error.message;
  throw error;
});
const sessionKey = (room: string) => multiplayerSessionKey(multiplayer, room);
let profile = {
  name:
    multiplayer.guestName || readSaved('cro-name', `旅人${Math.floor(Math.random() * 900 + 100)}`),
  ...normalizeCharacter({
    species: readSaved('cro-species', 'cro'),
    gender: readSaved('cro-gender', 'female'),
  }),
  room:
    (query.get('room') || multiplayer.room || readSaved('cro-room', 'EMBER'))
      .toUpperCase()
      .replace(/[^A-Z0-9_-]/g, '')
      .slice(0, 16) || 'EMBER',
};
let state: ViewState = {
  players: [],
  resources: INITIAL_RESOURCES,
  camp: { ...CAMP },
  npc: { ...NPC },
  day: 1,
};
let selfId = null,
  socket,
  joined = false,
  retry = null,
  manualLeave = false,
  ping = 0;
let connectAttempt = 0,
  retryCount = 0;
let renderUnavailable = false;
let audioContext = null,
  audioTimer = null,
  soundEnabled = false;
const keys = new Set();
const blockedMovementKeys = new Set();
const movementCommands = new MovementCommands();
let gamepadControls: GamepadControls | undefined;
let usingGamepad = false;
let selectedAnimalId = null,
  stateReceivedAt = performance.now(),
  hurtUntil = 0;

const joinFields = () =>
  `<label>あなたの名前<input name="name" maxlength="16" required autocomplete="off" autofocus></label><label>部屋のコード <span>英数字・ハイフン・アンダースコア / 最大16文字</span><input name="room" maxlength="16" pattern="[A-Za-z0-9_\\-]+" required autocomplete="off"></label>${characterChoicesMarkup()}<p class="form-note">人間は槍、クノイチは刀、魔法使いは光の魔法を使います。人間の男女で能力の差はありません。参加中に変更すると、もちものはリセットされます。</p>`;
$('#app').innerHTML = `
  <section class="game-viewport" aria-label="${GAME_TITLE} ゲーム画面">
    <canvas id="world" aria-label="氷河時代の大陸が広がる3Dワールド。WASDまたは左スティックで移動。左スティックを浅く倒すと歩き、深く倒すと走ります。右スティックまたはドラッグでカメラ回転。" tabindex="0"></canvas>
    <div class="tps-reticle" aria-hidden="true"><i></i></div>
    <div class="scene-shade"></div>
    <div id="damage-flash" class="damage-flash" aria-hidden="true" hidden></div>
    <div id="combat-status" class="combat-status" role="status" hidden></div>
    <div id="area-banner" class="area-banner" aria-live="polite" hidden><small></small><strong></strong></div>
    <button id="status-plate" class="status-plate" title="部族の仲間・招待"><span class="portrait cro" id="my-portrait"><i></i></span><span class="status-text"><strong id="profile-name"></strong><small><span id="room-label"></span><i>·</i><b id="online-count">0/5</b><i>·</i><span id="day-label">1日目</span></small><span class="energy-track" aria-hidden="true"><span id="energy-bar"></span></span><em class="energy-label">${icon('leaf')}<span id="energy-label">100 / 100</span></em></span></button>
    <div class="map-hud"><button id="menu-button" class="menu-chip" title="メニュー [ESC]">${icon('menu')}<span>メニュー</span><kbd>ESC</kbd></button><button id="map-button" class="minimap-button" aria-label="世界地図を開く" title="世界地図 [M]"><canvas id="minimap" width="160" height="115"></canvas><span class="map-north">N</span><span class="map-area" id="map-area">はじまりの谷</span><kbd class="map-key">M</kbd></button><div class="connection"><i class="status-dot" id="connection-dot"></i><span id="connection-label">未接続</span><span id="ping-label">— ms</span></div><div class="discovery-card hunting-card" id="discovery-card"><div><small>OPEN MEADOW · みんなで狩る</small><strong id="hunt-target-name">草原のマンモス</strong><progress id="hunt-health" max="100" value="100" aria-label="マンモスの体力"></progress><p id="hunt-target-note">開けた草原でマンモスを探そう。</p></div></div></div>
    <details class="journey" id="journey" open>
      <summary><span class="journey-head"><span class="eyebrow">目標</span><strong>はじめての火を育てる</strong></span><span id="quest-count" class="journey-count">0 / 3</span><span class="journey-chevron">${icon('arrow')}</span></summary>
      <div class="quest-list">
        <div class="quest" id="quest-gather"><span class="quest-check">1</span><div><strong>森の恵みを集める</strong><p>木や石、ベリーを3つ採集</p><div class="progress-track"><span id="gather-progress"></span></div></div></div>
        <div class="quest" id="quest-craft"><span class="quest-check">2</span><div><strong>はじめての道具</strong><p>木材3・石2で石斧をつくる</p></div></div>
        <div class="quest" id="quest-camp"><span class="quest-check">3</span><div><strong>みんなの火を育てる</strong><p>拠点に木材12・石6を届ける</p></div></div>
      </div>
      <div class="camp-row"><span class="camp-icon">${icon('flame')}</span><div><strong id="camp-name">小さな野営地</strong><small id="camp-level">CAMP LEVEL 0</small></div><div class="camp-stats"><span>${icon('wood')} <b id="camp-wood">0</b><em>/ 12</em></span><span>${icon('stone')} <b id="camp-stone">0</b><em>/ 6</em></span></div></div>

    </details>
    <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
    <div class="chat-panel"><button class="chat-heading" id="chat-toggle">${icon('chat')}<strong>焚き火の会話</strong><kbd>Enter</kbd><span class="chat-collapse">−</span></button><div id="chat-content"><div id="chat-messages" class="chat-messages" role="log" aria-live="polite"><p class="chat-system">この谷での物語が、ここから始まります。</p></div><form id="chat-form"><input id="chat-input" maxlength="180" placeholder="仲間に話しかける…" aria-label="チャットメッセージ" autocomplete="off"><button aria-label="メッセージを送信" type="submit">${icon('arrow')}</button></form></div></div>
    <div class="hotbar-wrap"><div class="interaction-hint" id="interaction-hint"><kbd>E</kbd><span>近くのものを調べる</span></div><div class="hotbar"><div class="resource-slots"><button class="resource-slot" data-inventory="wood" aria-label="木材のもちもの"><kbd>木材</kbd><span class="resource-icon wood">${icon('wood')}</span><b id="wood-count">0</b></button><button class="resource-slot" data-inventory="stone" aria-label="石のもちもの"><kbd>石</kbd><span class="resource-icon stone">${icon('stone')}</span><b id="stone-count">0</b></button><button class="resource-slot" id="eat-button" aria-label="ベリーを食べて元気を回復"><kbd>ベリー</kbd><span class="resource-icon berry">${icon('berry')}</span><b id="berry-count">0</b></button></div><div class="hotbar-divider"></div><button class="action-slot selected" data-action="gather" title="採集する [1]"><kbd>1</kbd>${icon('leaf')}<span>採集</span></button><button class="action-slot" data-action="craft" title="木材3・石2で石斧を作る [2]"><kbd>2</kbd>${icon('axe')}<span>つくる</span></button><button class="action-slot" data-action="contribute" title="焚き火の近くで資材を届ける [3]"><kbd>3</kbd>${icon('flame')}<span>届ける</span></button><button class="action-slot" data-action="trade" title="オルの近くで物々交換 [4]"><kbd>4</kbd>${icon('exchange')}<span>交換</span></button><button id="run-button" class="action-slot" aria-label="走行モード" aria-pressed="false" title="走る／歩く（方向キーを素早く2回押しても走る）"><kbd>2回</kbd>${icon('arrow')}<span>走る</span></button></div></div>
    <div id="prompt-bar" class="prompt-bar" aria-label="操作の案内"></div>
    <div id="screens" class="screens">
      <section id="screen-title" class="screen title-screen" hidden>
        <div class="title-content">
          <p class="screen-eyebrow">A PREHISTORIC ONLINE ADVENTURE</p>
          <div class="title-logo"><h1>${GAME_TITLE}</h1><span>氷河時代の大陸で、仲間と火を囲む。</span></div>
          <nav class="title-menu" aria-label="タイトルメニュー">
            <button id="title-continue" class="menu-item" hidden>つづきから<small id="title-continue-room"></small></button>
            <button id="title-start" class="menu-item">はじめる</button>
            <button id="title-howto" class="menu-item">あそびかた</button>
            <button id="title-fullscreen" class="menu-item">全画面表示</button>
          </nav>
          <p class="title-hint"><span><kbd>↑</kbd> <kbd>↓</kbd> 選ぶ</span><span><kbd>Enter</kbd> / <kbd>× ○ □ △</kbd> どれでも決定</span></p>
        </div>
        <div class="title-footer"><span id="title-status">ワールドを準備中…</span><span>MULTIPLAYER · ALPHA 0.1</span></div>
      </section>
      <section id="screen-setup" class="screen setup-screen" hidden>
        <form id="setup-form" class="setup-card"><p class="screen-eyebrow">旅支度</p><h2>あなたの物語を、ここから。</h2><p class="setup-intro">名前とキャラクターを選び、同じ部屋のコードを持つ仲間と暮らそう。</p><p class="form-error" id="setup-error" hidden></p>${joinFields()}<div class="setup-actions"><button type="button" id="setup-back" class="button button-outline">戻る</button><button class="button button-accent" id="setup-submit" type="submit">この谷へ出発する ${icon('arrow')}</button></div></form>
      </section>
      <section id="screen-guide" class="screen guide-screen" hidden></section>
    </div>
  </section>
  <dialog id="modal"><div class="modal-top"><span class="eyebrow">${GAME_TITLE}</span><button id="modal-close" class="button button-outline modal-back" type="button">戻る</button></div><div id="modal-body"></div></dialog>`;

if (matchMedia('(max-width:1000px), (max-height:700px)').matches)
  $('#journey').removeAttribute('open');
const areaBanner = new AreaBanner($('#area-banner'));
let guidePending = false;
const screens = new ScreenManager($('#screens'), (id) => {
  if (id) stopInput();
  else $('#world').focus({ preventScroll: true });
});
$('#journey').removeAttribute('open');

function showRenderError(text) {
  renderUnavailable = true;
  stopInput();
  if ($('#render-error')) return;
  const message = document.createElement('div');
  message.id = 'render-error';
  message.className = 'render-error';
  const heading = document.createElement('strong');
  heading.textContent = '3D画面を表示できません';
  const detail = document.createElement('p');
  detail.textContent = text;
  const button = document.createElement('button');
  button.className = 'button button-accent';
  button.textContent = '再読み込み';
  button.onclick = () => location.reload();
  message.append(heading, detail, button);
  $('.game-viewport').append(message);
}
let runMode = false;
// Double-tapping a direction key (within DOUBLE_TAP_MS) starts a dash that lasts
// until every movement key is released.
const DOUBLE_TAP_MS = 300;
const DIRECTION_KEYS = ['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'];
const lastTapAt = new Map<string, number>();
let dashing = false;
const wantsToRun = () => runMode || dashing;
let lastGait = false;
let renderer;
try {
  renderer = new WorldRenderer($('#world'), {
    onAnimal: interactAnimal,
    onError: showRenderError,
  });
  renderer.prediction.enabled = multiplayer.mode === 'lan';
} catch (error) {
  console.error('3D renderer could not initialize:', error);
  showRenderError(
    'WebGL 2対応ブラウザで開き、ハードウェアアクセラレーションが有効か確認してください。',
  );
  renderer = {
    setState() {},
    setEmote() {},
    focusPlayer() {},
    adjustZoom() {},
    rotateCamera() {},
    destroy() {},
    getMovementDirection() {
      return { dx: 0, dz: 0 };
    },
  };
}
$('.hotbar-wrap').insertAdjacentHTML(
  'afterbegin',
  `<div class="riding-controls" hidden><button id="ride-button" class="hunt-button"><kbd>R</kbd><span>マンモスに乗る</span></button><small id="riding-hint">1頭に1人 · 近づいて R で乗る</small></div>`,
);
$('#ride-button').onclick = ride;
const boatUI = installBoatControls({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  notify,
  renderer,
  openModal,
});
const adventureUI = installAdventureUI({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  notify,
  openModal,
  send,
  stopInput,
});
const fishingUI = installFishingUI({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  openModal,
});
const coastalUI = installCoastalUI({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  openModal,
});
const gulfUI = installGulfUI({
  collision: renderer.collision,
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  notify,
  openModal,
  send,
  stopInput,
});
const cropFoodUI = installCropFoodUI({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  openModal,
  collision: renderer.collision,
});
const villageUI = installVillageUI({
  player,
  state: () => state,
  available: () => joined && !renderUnavailable,
  action,
  openModal,
  collision: renderer.collision,
});
$('.hotbar-wrap').insertAdjacentHTML(
  'afterbegin',
  `<div class="hunt-controls"><button id="attack-button" class="hunt-button attack-button" title="槍で攻撃 [F / 5]">${icon('spear')}<kbd>F</kbd><span>槍で攻撃</span></button><button id="meat-inventory" class="hunt-button meat-counts" title="生肉は焚き火で焼いてから食べられます">${icon('meat')}<span>生 <b id="rawMeat-count">0</b> / 焼 <b id="cookedMeat-count">0</b></span></button><button id="cook-button" class="hunt-button" title="近くの焚き火で肉を焼く">${icon('flame')}<span>焼く</span></button><button id="eat-meat-button" class="hunt-button" title="焼き肉で元気を45回復">食べる</button></div><div id="cooking-status" class="cooking-status" hidden><span id="cooking-label">肉を焼いています…</span><progress id="cooking-progress" max="1" value="0" aria-label="肉を焼く進み具合"></progress><button id="cancel-cook">中止</button></div>`,
);
$('#attack-button').insertAdjacentHTML(
  'afterend',
  `<button id="jump-button" class="hunt-button" title="ジャンプ [Space / L2]" aria-label="ジャンプ">${icon('jump')}<kbd>Space</kbd><span>ジャンプ</span></button>`,
);
$('#chat-content').hidden = true;
$('.chat-collapse').textContent = '+';
renderer.setState(state, selfId);
$('#profile-name').textContent = profile.name;
$('#room-label').textContent = profile.room;

function send(message) {
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}
function stopInput() {
  renderer.prediction?.stop();
  // Also cancels a cast sent just before a menu/blur, before its snapshot arrives.
  if (joined) {
    send({ type: 'action', action: 'cancelFishing' });
    send({ type: 'action', action: 'cancelCoastal' });
  }
  gamepadControls?.suspend();
  for (const key of keys) blockedMovementKeys.add(key);
  keys.clear();
  dashing = false;
  movementCommands.reset();
  send({ type: 'move', dx: 0, dz: 0, running: false });
}
function notify(text, tone = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast ${tone}`;
  const mark = document.createElement('span');
  mark.innerHTML = icon(tone === 'success' ? 'check' : 'leaf');
  const label = document.createElement('span');
  label.textContent = text;
  toast.append(mark, label);
  $('#toast-stack').append(toast);
  setTimeout(() => toast.remove(), 4500);
  if ($('#toast-stack').children.length > 3) $('#toast-stack').firstChild.remove();
}
function addChat(message) {
  const p = document.createElement('p');
  if (message.system) {
    p.className = 'chat-system';
    p.textContent = message.text;
  } else {
    const name = document.createElement('strong');
    name.textContent = `${message.name} `;
    p.append(name, document.createTextNode(message.text));
  }
  const box = $('#chat-messages');
  box.append(p);
  while (box.children.length > 40) box.firstChild.remove();
  box.scrollTop = box.scrollHeight;
}
function connection(connected, label) {
  joined = connected;
  if (!connected) renderer.prediction?.reset();
  $('#connection-dot').classList.toggle('offline', !connected);
  $('#connection-label').textContent =
    multiplayer.mode === 'lan' ? (connected ? 'LAN: Connected' : `LAN: ${label}`) : label;
  $('#connection-label').title = multiplayer.serverUrl || location.origin;
}
async function connect() {
  gamepadControls?.suspend();
  const attempt = ++connectAttempt;
  clearTimeout(retry);
  manualLeave = false;
  selfId = null;
  keys.clear();
  blockedMovementKeys.clear();
  movementCommands.reset();
  lastGait = null;
  connection(false, '接続中…');
  state = { players: [], resources: INITIAL_RESOURCES, camp: { ...CAMP }, npc: { ...NPC }, day: 1 };
  renderer.setState(state, selfId);
  updateHUD();
  try {
    const response = await fetch('/api/status', {
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (attempt !== connectAttempt || manualLeave) return;
    if (response.status !== 404) {
      if (!response.ok)
        throw new Error(
          '現在ゲームに接続できません。無料の利用上限または一時的な停止の可能性があります。時間をおいて再接続してください。',
        );
      const status = await response.json();
      if (!status.ok) throw new Error(status.text || '現在ゲームは停止中です。');
      if (status.room && profile.room !== status.room) {
        profile.room = status.room;
        notify('無料公開版では EMBER の谷に参加します。');
      }
    }
  } catch (error) {
    if (attempt !== connectAttempt) return;
    manualLeave = true;
    connection(false, 'サービス停止中');
    showSetup(
      error.name === 'Error' ? error.message : '通信できません。時間をおいて再接続してください。',
    );
    return;
  }
  if (attempt !== connectAttempt || manualLeave) return;
  const ws = new WebSocket(
    multiplayerUrl(multiplayer, location.origin, {
      ...profile,
      resume: '1',
      session: savedSession(sessionKey(profile.room)),
    }),
  );
  socket = ws;
  ws.addEventListener('message', ({ data }) => {
    if (ws !== socket) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      retryCount = 0;
      selfId = message.id;
      profile = { ...profile, ...message.profile, room: message.room };
      saveSession(sessionKey(profile.room), message.session);
      for (const [key, value] of Object.entries(profile)) save(`cro-${key}`, value);
      $('#profile-name').textContent = profile.name;
      $('#room-label').textContent = profile.room;
      connection(true, 'オンライン');
      renderer.focusPlayer();
      if (guidePending && !message.resumed && readSaved('cro-skip-guide', '') !== '1') showGuide();
      guidePending = false;
      if (message.resumed) notify('接続が戻りました。持ち物と進行を復元しました。', 'success');
    }
    if (message.type === 'state') {
      const previous = player();
      state = { ...state, ...message };
      stateReceivedAt = performance.now();
      if (
        (previous?.mountId ?? previous?.boatId ?? null) !==
        (player()?.mountId ?? player()?.boatId ?? null)
      ) {
        movementCommands.reset();
        lastGait = null;
      }
      if (playerDamageEvent(previous, player())) hurtUntil = performance.now() + 750;
      if (player()?.downedUntil) {
        for (const key of keys) blockedMovementKeys.add(key);
        keys.clear();
        movementCommands.reset();
      }
      renderer.setState(state, selfId);
      updateHUD();
    }
    if (message.type === 'emote') renderer.setEmote(message.id, message.emote);
    if (message.type === 'notice') {
      if (message.popup !== false) notify(message.text, message.tone);
      if (message.tone === 'success') playNote();
    }
    if (message.type === 'chat') addChat(message);
    if (message.type === 'pong') {
      ping = Math.max(0, Date.now() - message.at);
      if (renderer.prediction) renderer.prediction.latencyMs = ping;
      $('#ping-label').textContent = `${ping} ms`;
    }
    if (message.type === 'error') {
      manualLeave = true;
      notify(message.text, 'error');
      connection(false, '参加できません');
      showSetup(message.text);
      if (message.code === 'ROOM_FULL' && savedSession(sessionKey(profile.room))) {
        $('#setup-error').insertAdjacentHTML(
          'afterend',
          '<button id="retry-session" class="button button-outline wide" type="button">保存した持ち物で再接続する</button>',
        );
        $('#retry-session').onclick = () => enterGame();
      }
    }
  });
  ws.addEventListener('close', () => {
    if (ws !== socket) return;
    connection(false, manualLeave ? '未接続' : '再接続中…');
    gamepadControls?.suspend();
    keys.clear();
    movementCommands.reset();
    if (!manualLeave)
      retry = setTimeout(connect, Math.min(60000, 2500 * 2 ** Math.min(retryCount++, 5)));
  });
  ws.addEventListener('error', () => {
    if (ws === socket) connection(false, 'サーバーを確認中…');
  });
}
function player() {
  return state.players.find((p) => p.id === selfId);
}
function distance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}
function nearby(): { action: string; label: string; targetId?: string } | null {
  const me = player();
  if (!me || me.downedUntil || me.mountId) return null;
  const coastal = coastalInteraction(state, me, renderer.collision);
  if (coastal) return coastal;
  const fishing = fishingInteraction(me);
  if (fishing) return fishing;
  if (me.boatId) return null;
  const hunting = huntInteraction(state, me, renderer.collision);
  if (hunting) return hunting;
  const adventure = adventureInteraction(me, renderer.collision);
  if (adventure) return adventure;
  const resident = residentInteraction(state, me, renderer.collision);
  if (resident) return resident;
  const gulf = gulfInteraction(state, me, renderer.collision);
  if (gulf) return gulf;
  const objects: { x: number; z: number; action: string; label: string; range: number }[] =
    state.resources
      .filter((r) => r.amount > 0 && me.inventory[r.type] < 99)
      .map((r) => ({
        ...r,
        action: 'gather',
        targetId: r.id,
        label:
          r.type === 'obsidian'
            ? '黒曜石を採掘する'
            : `${{ wood: '木材', stone: '石', berry: 'ベリー' }[r.type]}を採集する`,
        range: 8,
      }));
  objects.push(
    { ...state.camp, action: 'contribute', label: '焚き火に資材を届ける', range: 10 },
    { ...state.npc, action: 'trade', label: 'オルと物々交換する', range: 10 },
  );
  return objects
    .filter(
      (o) =>
        distance(me, o) <= o.range &&
        (!renderer.collision || interactionVisible(renderer.collision, me, o)),
    )
    .sort((a, b) => distance(me, a) - distance(me, b))[0];
}
function updateHUD() {
  const me = player(),
    inv = inventoryCounts(me?.inventory);
  const gathered = me?.gathered ?? 0;
  for (const key of ['wood', 'stone', 'berry', 'rawMeat', 'cookedMeat'])
    $(`#${key}-count`).textContent = inv[key];
  $('#online-count').textContent =
    `${state.players.length}/${state.playerLimit ?? WORLD.maxPlayers}`;
  $('#camp-wood').textContent = state.camp.wood;
  $('#camp-stone').textContent = state.camp.stone;
  $('#camp-level').textContent = `CAMP LEVEL ${state.camp.level}`;
  $('#camp-name').textContent = state.camp.level ? 'みんなの野営地' : '小さな野営地';
  $('#day-label').textContent = `${state.day || 1}日目`;
  const energy = Math.round(me?.energy ?? 100);
  $('#energy-label').textContent = `${energy} / 100`;
  $('#energy-bar').style.width = `${energy}%`;
  $('#gather-progress').style.width = `${Math.min(gathered / 3, 1) * 100}%`;
  let done = 0;
  for (const [id, complete] of [
    ['gather', gathered >= 3],
    ['craft', !!me?.tool],
    ['camp', state.camp.level > 0],
  ]) {
    $(`#quest-${id}`).classList.toggle('done', complete);
    if (complete) done++;
  }
  $('#quest-count').textContent = `${done} / 3`;
  $('#interaction-hint span').textContent = nearby()?.label || '近くのものを調べる';
  $('#interaction-hint').classList.toggle('available', !!nearby());
  $('#my-portrait').className = `portrait ${profile.species}`;
  $('#status-plate').title = `${characterModel(profile).name} · 部族の仲間と招待`;
  updateHuntingHUD();
  const biome = biomeAt(me?.x ?? 50, me?.z ?? 50);
  const region = regionAt(me?.x ?? 50, me?.z ?? 50);
  const areaName = region?.name ?? locationName(me?.x ?? 50, me?.z ?? 50);
  $('#map-area').textContent = areaName;
  if (me && joined && !screens.active)
    areaBanner.update(
      inGulf(me.x, me.z) ? '三つの岸の湾' : (region?.kind ?? biome.short),
      areaName,
    );
  drawMinimap();
  updateModalHUD();
  adventureUI.update();
  gulfUI.update();
  cropFoodUI.update();
  fishingUI.update();
  coastalUI.update();
  villageUI.update();
  if ($('#modal').open && $('#big-map')) drawMinimap($('#big-map'), true);
}
function updateModalHUD() {
  const me = player(),
    inv = inventoryCounts(me?.inventory);
  const unavailable =
    !joined ||
    renderUnavailable ||
    !me ||
    !!me.downedUntil ||
    !!me.mountId ||
    !!me.boatId ||
    !!me.cookingEndsAt ||
    !!me.fishing ||
    !!me.coastalActivity;
  for (const count of document.querySelectorAll<HTMLElement>('[data-modal-count]'))
    count.textContent = String(inv[count.dataset.modalCount]);
  if ($('#modal-eat')) $('#modal-eat').disabled = unavailable || !inv.berry || me.energy >= 100;
  if ($('#modal-cook'))
    $('#modal-cook').disabled = unavailable || !inv.rawMeat || inv.cookedMeat >= 99;
  if ($('#modal-eat-meat'))
    $('#modal-eat-meat').disabled = unavailable || !inv.cookedMeat || me.energy >= 100;
  if ($('#modal-fishing-kit'))
    $('#modal-fishing-kit').disabled =
      unavailable || !!me?.gulf?.fishingKit || inv.wood < 3 || inv.stone < 1;
  if ($('#modal-cook-fish'))
    $('#modal-cook-fish').disabled = unavailable || !inv.rawFish || inv.cookedFish >= 99;
  if ($('#modal-eat-fish'))
    $('#modal-eat-fish').disabled = unavailable || !inv.cookedFish || me?.energy >= 100;
  if ($('#modal-cook-shellfish'))
    $('#modal-cook-shellfish').disabled =
      unavailable || !inv.rawShellfish || inv.cookedShellfish >= 99;
  if ($('#modal-eat-shellfish'))
    $('#modal-eat-shellfish').disabled =
      unavailable || !inv.cookedShellfish || inv.shells >= 99 || me?.energy >= 100;
  if ($('#modal-boat-craft')) $('#modal-boat-craft').disabled = unavailable || inv.wood < 12;
  if ($('#modal-craft')) {
    $('#modal-craft').disabled = unavailable || me.tool || inv.wood < 3 || inv.stone < 2;
    $('#modal-craft').textContent = me?.tool ? '装備中' : 'つくる';
    $('#modal-axe-label').textContent = me?.tool ? '石斧を装備中' : '石斧をつくる';
  }
  const list = $('#tribe-list');
  if (list) {
    const signature = JSON.stringify(
      state.players.map(({ id, name, species, gender }) => ({ id, name, species, gender })),
    );
    if (list.dataset.signature !== signature) {
      list.dataset.signature = signature;
      list.replaceChildren();
      $('#tribe-summary').textContent = `いま、この谷で暮らしている ${state.players.length} 人。`;
      for (const p of state.players) {
        const row = document.createElement('div');
        row.className = 'tribe-member';
        row.innerHTML = `<span class="portrait ${normalizeCharacter(p).species}"><i></i></span><div><strong></strong><small>${characterModel(p).name}</small></div><span class="member-status"><i class="status-dot"></i> ${p.id === selfId ? 'あなた' : 'オンライン'}</span>`;
        row.querySelector('strong').textContent = p.name;
        list.append(row);
      }
    }
  }
}
function action(type, targetId?, cropId?) {
  if (!joined) return notify('サーバーへの接続を待っています。', 'error');
  if (renderUnavailable) return;
  if (player()?.downedUntil) return;
  if (type === 'cropFoodOpen') {
    cropFoodUI.open();
    return;
  }
  if (type === 'fishingOpen') {
    fishingUI.open();
    return;
  }
  if (type === 'coastalOpen') {
    coastalUI.open();
    return;
  }
  if (type === 'residentOpen') {
    villageUI.open(targetId);
    return;
  }
  if (player()?.boatId && !['boardBoat', 'fish', 'cancelFishing'].includes(type))
    return notify(`乗船中です。岸で ${usingGamepad ? '△' : 'B'} を押して降りてから行おう。`);
  if (player()?.mountId && type !== 'ride')
    return notify(`騎乗中です。攻撃・採集・食事は ${usingGamepad ? '△' : 'R'} で降りてから。`);
  if (
    type === 'gulfOpen' ||
    (inGulf(player()?.x, player()?.z) && ['contribute', 'trade'].includes(type))
  ) {
    gulfUI.open(targetId);
    return;
  }
  send({
    type: 'action',
    action: type,
    ...(targetId ? { targetId } : {}),
    ...(cropId ? { cropId } : {}),
  });
  document
    .querySelectorAll<HTMLElement>('[data-action]')
    .forEach((el) => el.classList.toggle('selected', el.dataset.action === type));
}
function huntTarget() {
  return selectedCombatTarget(state, player(), selectedAnimalId);
}
function attack() {
  action('attack');
}
function jump() {
  const now = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  if (
    !joined ||
    renderUnavailable ||
    screens.active ||
    $('#modal').open ||
    !canStartJump(player(), now)
  )
    return;
  send({ type: 'action', action: 'jump' });
  $('#world').focus({ preventScroll: true });
}
function rideTarget() {
  const me = player();
  if (!me) return null;
  const now = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  const candidates = (state.animals || [])
    .filter((a) => a.phase === 'alive' && a.health > 0 && !a.riderId)
    .sort((a, b) => ridingDistance(me, a) - ridingDistance(me, b));
  return candidates.find((a) => canMount(me, a, renderer.collision, now)) ?? candidates[0] ?? null;
}
function ride() {
  if (!joined || renderUnavailable || player()?.downedUntil) return;
  const me = player(),
    animal = rideTarget();
  if (me?.boatId) return notify(`船から降りるには岸で ${usingGamepad ? '△' : 'B'}。`);
  if (me?.mountId) return action('ride');
  const now = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  if (!canMount(me, animal, renderer.collision, now))
    return notify(
      `マンモスの横まで自分で近づき、乗れる案内が出たら ${usingGamepad ? '△' : 'R'} を押そう。`,
    );
  action('ride', animal.id);
}
function interactAnimal(id) {
  const animal = [
      ...(state.animals || []),
      ...(state.enemies || []).filter((item) => item.hostile === true),
    ].find((item) => item.id === id),
    me = player();
  if (!animal || !me) return;
  if (animal.riderId) return notify('このマンモスには仲間が乗っています。');
  if (me.mountId || me.downedUntil || renderUnavailable) return;
  selectedAnimalId = id;
  updateHuntingHUD();
  if (animal.phase === 'alive') {
    if (attackReady(me, animal)) action('attack', id);
    else notify(`自分で近づき、相手を向いて ${usingGamepad ? '□ / R2' : 'F'} で攻撃しよう。`);
  } else if (animal.phase === 'meat') {
    if (distance(me, animal) <= HUNTING.harvestRange) action('harvest', id);
    else notify('肉のそばまで自分で近づいて採ろう。');
  }
}
function updateHuntingHUD() {
  boatUI.update();
  const attackKey = usingGamepad ? '□ / R2' : 'F';
  const me = player(),
    animal = me?.mountId ? (state.animals || []).find((a) => a.id === me.mountId) : huntTarget(),
    inv = inventoryCounts(me?.inventory),
    serverNow = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  const cooking = !!me?.cookingEndsAt && me.cookingEndsAt > serverNow;
  const fishing = !!me?.fishing;
  const coastal = me?.coastalActivity;
  const mounted = !!me?.mountId,
    rideAnimal = rideTarget(),
    nearRide =
      joined && !renderUnavailable && canMount(me, rideAnimal, renderer.collision, serverNow);
  $('.hotbar-wrap').classList.toggle('riding', mounted);
  const rideButton = $('#ride-button');
  rideButton.disabled =
    !joined || renderUnavailable || !!me?.boatId || !!me?.downedUntil || (!mounted && !nearRide);
  rideButton.classList.toggle('mounted', mounted);
  rideButton.querySelector('span').textContent = mounted ? 'マンモスから降りる' : 'マンモスに乗る';
  $('.riding-controls').hidden = !mounted && !nearRide;
  $('#riding-hint').textContent = mounted
    ? usingGamepad
      ? '左スティックで移動 · △ で降りる'
      : 'WASDで移動 · R で降りる'
    : usingGamepad
      ? '△ を押すとマンモスに乗れます'
      : 'R を押すとマンモスに乗れます';
  if (usingGamepad && me?.boatId)
    $('#boat-hint').textContent = '左スティックで操船 · 深く倒すと速く · 岸で △';
  updatePromptBar();
  Object.assign($('#world').dataset, {
    ridingVersion: String(state.ridingVersion ?? 0),
    mountId: me?.mountId ?? '',
    rideAvailable: String(!!nearRide),
    riders: JSON.stringify(
      (state.animals || []).map((a) => ({ id: a.id, riderId: a.riderId ?? null })),
    ),
  });
  const downed = !!me?.downedUntil,
    protectedNow = !!me?.invulnerableUntil && me.invulnerableUntil > serverNow;
  const enemies = (state.enemies || []).filter((enemy) => enemy.hostile === true),
    nearestEnemy = me ? [...enemies].sort((a, b) => distance(me, a) - distance(me, b))[0] : null;
  const targetInFront = attackReady(me, animal) && inAttackArc(me, animal);
  $('#hunt-target-name').textContent = animal?.hostile
    ? animal.name
    : animal?.phase === 'meat'
      ? 'マンモスの肉'
      : animal?.phase === 'dying'
        ? 'マンモスを倒した'
        : '草原のマンモス';
  $('#discovery-card').classList.toggle('hostile', animal?.hostile === true);
  $('#discovery-card').hidden = !animal || !me || distance(me, animal) > 60;
  $('#discovery-card small').textContent = animal?.hostile
    ? 'HOSTILE · 杖の攻撃に注意'
    : 'OPEN MEADOW · みんなで狩る';
  $('#hunt-health').setAttribute(
    'aria-label',
    `${animal?.hostile ? animal.name : 'マンモス'}の体力`,
  );
  $('#hunt-health').hidden = animal?.phase !== 'alive';
  $('#hunt-health').max = animal?.maxHealth ?? 100;
  $('#hunt-health').value = animal?.health ?? 100;
  $('#hunt-target-note').textContent = !animal
    ? 'Fで前方へ攻撃できます。'
    : animal.phase === 'meat'
      ? `近づいて E · 残り${animal.meatRemaining}個`
      : animal.phase === 'dead'
        ? '呪術師を倒しました。しばらくすると戻ります。'
        : animal.phase === 'dying'
          ? '肉になったら近づいて採ろう。'
          : `${animal.health} / ${animal.maxHealth} · ${Math.round(distance(me, animal))}m · ${targetInFront ? `前方へ ${attackKey} で攻撃` : attackReady(me, animal) ? `相手を向いて ${attackKey}` : `近づいて、相手を向いて ${attackKey}`}`;
  if (mounted) {
    $('#hunt-target-name').textContent = '騎乗中のマンモス';
    $('#hunt-target-note').textContent =
      `開けた場所で ${usingGamepad ? '△' : 'R'} を押すと降りられます。`;
    $('#discovery-card small').textContent = 'MAMMOTH RIDE · 草原の旅';
  } else if (animal?.riderId) {
    $('#hunt-target-note').textContent = '仲間が騎乗中 · このマンモスには攻撃できません。';
  }
  const attackAvailable =
    joined && !renderUnavailable && !me?.boatId && canStartAttack(me, serverNow);
  $('#attack-button').disabled = !attackAvailable;
  $('#jump-button').disabled = !joined || renderUnavailable || !canStartJump(me, serverNow);
  $('#attack-button').classList.toggle('in-range', targetInFront);
  const combat = attackProfile(me ?? profile),
    attackButton = $('#attack-button');
  if (attackButton.dataset.style !== combat.id) {
    attackButton.dataset.style = combat.id;
    attackButton.innerHTML = `${icon(combat.key)}<kbd>${usingGamepad ? '□ / R2' : 'F'}</kbd><span>${combat.label}</span>`;
  }
  attackButton.title = mounted
    ? `${usingGamepad ? '△' : 'R'}で降りてから攻撃できます。`
    : attackAvailable
      ? `前方へ${combat.label} [${usingGamepad ? attackKey : 'F / 5'}]。相手がいなくても発動できます。`
      : '次の攻撃を準備しています。';
  $('#cook-button').disabled =
    !joined || renderUnavailable || downed || mounted || cooking || !inv.rawMeat;
  $('#eat-meat-button').disabled =
    !joined ||
    renderUnavailable ||
    downed ||
    mounted ||
    cooking ||
    !inv.cookedMeat ||
    me?.energy >= 100;
  $('#cooking-status').hidden = !cooking && !fishing && !coastal;
  if (cooking || fishing || coastal) {
    const remaining = Math.max(
      0,
      (coastal ? coastal.endsAt : fishing ? me.fishing.endsAt : me.cookingEndsAt) - serverNow,
    );
    const label = coastal
      ? coastal.kind === 'shells'
        ? '貝を探しています…'
        : '黒曜石を削っています…'
      : fishing
        ? '魚を待っています'
        : ROOT_RECIPES.some((r) => r.kind === me.cookingKind)
          ? `${ROOT_RECIPES.find((r) => r.kind === me.cookingKind).name}を作っています…`
          : me.cookingKind === 'shellfish'
            ? '貝を焼いています…'
            : me.cookingKind === 'fish'
              ? '魚を焼いています'
              : '肉を焼いています';
    $('#cooking-label').textContent = label + ' · ' + (remaining / 1000).toFixed(1) + '秒';
    $('#cooking-progress').value =
      1 -
      remaining /
        (coastal
          ? coastal.kind === 'shells'
            ? COASTAL.gatherMs
            : COASTAL.knapMs
          : fishing
            ? FISHING.durationMs
            : HUNTING.cookDurationMs);
    $('#cooking-progress').setAttribute('aria-label', label + '進み具合');
  }
  Object.assign($('#world').dataset, {
    fishing: me?.fishing?.spotId ?? '',
    coastal: coastal?.kind ?? '',
    weapon: combat.id,
    rawFish: String(inv.rawFish),
    cookedFish: String(inv.cookedFish),
  });
  $('#damage-flash').hidden = performance.now() > hurtUntil && !downed;
  $('#combat-status').hidden = !downed && !protectedNow;
  $('#combat-status').classList.toggle('downed', downed);
  $('#combat-status').textContent = downed
    ? `力尽きました · ${Math.max(0, Math.ceil((me.downedUntil - serverNow) / 1000))}秒後に焚き火で回復\n持ち物は失いません`
    : protectedNow
      ? `焚き火で回復 · 元気 ${me.energy} / 100 · あと${Math.ceil((me.invulnerableUntil - serverNow) / 1000)}秒保護中`
      : '';
  Object.assign($('#world').dataset, {
    combatVersion: String(state.combatVersion ?? 0),
    huntTarget: animal?.id ?? '',
    huntPhase: animal?.phase ?? '',
    huntHealth: String(animal?.health ?? 0),
    huntInRange: String(attackReady(me, animal)),
    attackAvailable: String(attackAvailable),
    attackSequence: String(me?.attackSequence ?? 0),
    attackAt: String(me?.attackAt ?? 0),
    cooking: String(cooking),
    rawMeat: String(inv.rawMeat),
    cookedMeat: String(inv.cookedMeat),
  });
  Object.assign($('#world').dataset, {
    enemyVersion: String(state.enemyVersion ?? 0),
    enemyCount: String(enemies.length),
    enemyName: nearestEnemy?.name ?? '',
    enemyHealth: String(nearestEnemy?.health ?? 0),
    enemyPhase: nearestEnemy?.phase ?? '',
    enemyBehavior: nearestEnemy?.behavior ?? '',
    enemyClip: nearestEnemy?.clip ?? '',
    enemyAttackSequence: String(nearestEnemy?.attackSequence ?? 0),
    enemyHitSequence: String(nearestEnemy?.hitSequence ?? 0),
    hurtSequence: String(me?.hurtSequence ?? 0),
    defeatSequence: String(me?.defeatSequence ?? 0),
    downed: String(downed),
    invulnerable: String(protectedNow),
  });
}
function drawMinimap(canvas = $('#minimap'), big = false) {
  drawWorldMap(canvas, state, selfId, big);
}
function openModal(content) {
  stopInput();
  $('#modal-body').innerHTML = content;
  if (!$('#modal').open) $('#modal').showModal();
}
function applyProfileForm(form: HTMLFormElement) {
  const data = new FormData(form);
  manualLeave = true;
  saveSession(sessionKey(profile.room), null);
  send({ type: 'leave' });
  const previous = socket;
  socket = null;
  previous?.close();
  profile = {
    name: String(data.get('name')).trim() || '旅人',
    room: String(data.get('room')).toUpperCase(),
    ...normalizeCharacter({
      species: String(data.get('species')),
      gender: String(data.get('gender')),
    }),
  };
  saveSession(sessionKey(profile.room), null);
  for (const [k, v] of Object.entries(profile)) save(`cro-${k}`, v);
  history.replaceState({}, '', `?room=${encodeURIComponent(profile.room)}`);
  $('#profile-name').textContent = profile.name;
}
function showTitle() {
  $('#modal').close();
  const resumable = !!savedSession(sessionKey(profile.room));
  $('#title-continue').hidden = !resumable;
  $('#title-continue-room').textContent = `${profile.name} · ${profile.room}`;
  screens.show('title');
}
function showSetup(error = '') {
  $('#modal').close();
  $('#retry-session')?.remove();
  const form = $('#setup-form');
  form.name.value = profile.name;
  form.room.value = profile.room;
  bindCharacterSelection(form, profile);
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error;
  $('#setup-back').textContent = joined ? '探索に戻る' : '戻る';
  screens.show('setup');
}
function showGuide() {
  $('#screen-guide').innerHTML = guideMarkup({ gamepad: usingGamepad, skipChecked: false });
  screens.show('guide');
  $('#guide-start').onclick = finishGuide;
  $('#guide-back').onclick = () => showSetup();
}
function finishGuide() {
  if (screens.active !== 'guide') return;
  save('cro-skip-guide', $('#guide-skip')?.checked ? '1' : '');
  screens.hide();
  areaBanner.reset();
}
function enterGame() {
  $('#retry-session')?.remove();
  guidePending = true;
  screens.hide();
  document.body.classList.add('in-game');
  areaBanner.reset();
  connect();
}
function leaveToTitle() {
  manualLeave = true;
  clearTimeout(retry);
  send({ type: 'leave' });
  saveSession(sessionKey(profile.room), null);
  const previous = socket;
  socket = null;
  previous?.close();
  selfId = null;
  state = { players: [], resources: INITIAL_RESOURCES, camp: { ...CAMP }, npc: { ...NPC }, day: 1 };
  renderer.setState(state, selfId);
  connection(false, '未接続');
  updateHUD();
  document.body.classList.remove('in-game');
  showTitle();
}
async function openInvite() {
  openModal(
    `<span class="modal-illustration">${icon('people')}</span><h2>ひとつの火を、仲間と。</h2><p class="modal-intro">同じ部屋のリンクを仲間に渡して、一緒に谷を探索しよう。</p><div class="invite-code"><small>ROOM CODE</small><strong id="invite-code"></strong><span>現在の部屋の接続上限は ${state.playerLimit ?? WORLD.maxPlayers}人</span></div><label>招待リンク<input id="invite-url" readonly aria-label="招待リンク"></label><button id="copy-invite" class="button button-accent wide">${icon('link')} 招待リンクをコピー</button><p id="invite-note" class="form-note">このPCと同じWi-Fi・LANにいる仲間が参加できます。インターネット越しの参加には、サーバーの公開が必要です。</p><button id="change-room" class="text-button">別の部屋に参加する ${icon('arrow')}</button>`,
  );
  $('#invite-code').textContent = profile.room;
  let base = location.origin;
  try {
    const network =
      multiplayer.mode === 'lan' ? {} : await fetch('/api/network').then((r) => r.json());
    if (
      multiplayer.mode !== 'lan' &&
      ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname) &&
      network.urls?.length
    )
      base = network.urls[0];
  } catch {}
  if (!$('#invite-url')) return;
  if (multiplayer.mode === 'lan')
    $('#invite-note').textContent =
      '展示LAN：相手のPCでも展示フォルダーの start-exhibition-client.bat を起動し、同じ部屋に参加してください。ゲーム本体は各PCのlocalhostから読み込みます。';
  $('#invite-url').value = `${base}/?room=${encodeURIComponent(profile.room)}`;
  $('#copy-invite').onclick = async () => {
    const input = $('#invite-url');
    try {
      await navigator.clipboard.writeText(input.value);
      notify('招待リンクをコピーしました。', 'success');
    } catch {
      input.select();
      notify('リンクを選択しました。Ctrl+C でコピーできます。');
    }
  };
  $('#change-room').onclick = () => showSetup();
}
function openInventory() {
  const me = player(),
    inv = inventoryCounts(me?.inventory);
  openModal(
    `<h2>旅に持っていくもの。</h2><p class="modal-intro">生肉・魚・貝は、各地の焚き火で焼いてから食べよう。黒曜石の原石は石器作業場で刃にできます。</p><div class="inventory-grid">${[
      ['wood', '木材', '採集して、道具や拠点に。'],
      ['stone', '石', '丈夫な道具と火の囲いに。'],
      ['berry', 'ベリー', '食べると元気が回復。'],
      ['rawMeat', '生肉', 'そのままでは食べられません。焚き火で3秒焼こう。'],
      ['cookedMeat', '焼き肉', '1個で元気を45回復します。'],
      ['obsidian', '黒曜石', '湾の西の露頭で採掘。石器作業場で削って刃を作ろう。'],
      ['seed', 'ベリーの種', '共同の畑に植え、水をやって育てよう。'],
      ['water', '水袋', '湾の水場で水6を補給。火根草は水2、ほかの作物は水1。'],
      ['rawFish', '生魚', '湾の魚場で釣る。焚き火で3秒焼こう。'],
      ['cookedFish', '焼き魚', '元気+30。集い場の食料にも持ち寄れます。'],
      ['rawShellfish', '生の貝', '浜の貝場で採集。焚き火で3秒焼こう。'],
      ['cookedShellfish', '焼いた貝', '元気+20。食べると貝殻1個が残ります。'],
      ['shells', '貝殻', '集落へ持ち帰り、みんなで貝塚を築こう。'],
      ['obsidianBlade', '黒曜石の刃', '原石2個から作る。刃1・木材1で木槍の先へ。'],
      ['rootSeed', '火根草の種', '集落の炉でベリー2と種2を交換。畑に植えて水2。'],
      ['herbSeed', '香り草の種', '集落の炉で種を交換。水1で早く育つ。'],
      ['rawRoot', '火根', '火根草の根。炉で焼いてから食べよう。'],
      ['herb', '香草', '火根と一緒に焼くと、回復量が増えます。'],
      ['cookedRoot', '焼き根', '元気+35。宴にも持ち寄れます。'],
      ['herbRoot', '香草焼き根', '元気+50。火根1・香草1で料理。'],
    ]
      .map(
        ([key, label, note]) =>
          `<div class="inventory-card"><span class="resource-icon ${key}">${icon(key.endsWith('Meat') ? 'meat' : key.endsWith('Fish') ? 'wave' : key.toLowerCase().includes('shell') ? 'shell' : key === 'obsidianBlade' ? 'blade' : key === 'obsidian' ? 'stone' : key)}</span><strong>${label}<b>${inv[key]}</b></strong><p>${note}</p>${key === 'berry' ? '<button id="modal-eat" class="button button-outline">食べる</button>' : key === 'rawMeat' ? `<button id="modal-cook" class="button button-outline" ${inv.rawMeat ? '' : 'disabled'}>焚き火で焼く</button>` : key === 'cookedMeat' ? `<button id="modal-eat-meat" class="button button-outline" ${inv.cookedMeat ? '' : 'disabled'}>焼き肉を食べる</button>` : key === 'rawFish' ? '<button id="modal-cook-fish" class="button button-outline">焚き火で焼く</button>' : key === 'cookedFish' ? '<button id="modal-eat-fish" class="button button-outline">魚を食べる</button>' : ''}</div>`,
      )
      .join(
        '',
      )}</div><div class="recipe"><span class="resource-icon stone">${icon('axe')}</span><div><strong>${me?.tool ? '石斧を装備中' : '石斧をつくる'}</strong><p>木材3 + 石2 ・ 採集量が増えます</p></div><button id="modal-craft" class="button button-accent" ${me?.tool ? 'disabled' : ''}>${me?.tool ? '装備中' : 'つくる'}</button></div><p class="form-note">今の武器：${attackProfile(me ?? profile).noun}。人間系は木槍で出発し、黒曜石の刃で強化できます。相手を向いて F。</p>`,
  );
  $('#modal-eat').onclick = () => {
    action('eat');
    $('#modal').close();
  };
  $('#modal-craft').onclick = () => {
    action('craft');
    $('#modal').close();
  };
  $('#modal-cook').onclick = () => {
    $('#modal').close();
    cook();
  };
  $('#modal-eat-meat').onclick = () => {
    action('eatMeat');
    $('#modal').close();
  };
  document
    .querySelectorAll<HTMLElement>('.inventory-card strong b')
    .forEach(
      (count, index) =>
        (count.dataset.modalCount = [
          'wood',
          'stone',
          'berry',
          'rawMeat',
          'cookedMeat',
          'obsidian',
          'seed',
          'water',
          'rawFish',
          'cookedFish',
          'rawShellfish',
          'cookedShellfish',
          'shells',
          'obsidianBlade',
          ...CROP_INVENTORY,
        ][index]),
    );
  $('#modal-cook-fish').onclick = () => {
    $('#modal').close();
    action('cookFish');
  };
  $('#modal-eat-fish').onclick = () => action('eatFish');
  $('#modal-body').insertAdjacentHTML(
    'beforeend',
    '<div class="recipe"><div><strong>湾の釣り道具</strong><p>木材3・石1 · 繰り返し使えます</p></div><button id="modal-fishing-kit" class="button button-accent">道具を作る</button><button id="modal-fishing" class="button button-outline">魚場と釣り方</button></div>',
  );
  $('#modal-fishing-kit').onclick = () => action('craftFishingKit');
  $('#modal-fishing').onclick = () => fishingUI.open();
  $('#modal-body').insertAdjacentHTML(
    'beforeend',
    '<div class="recipe coastal-recipe"><div><strong>貝の食事と黒曜石の道具</strong><p>貝殻を持ち帰って貝塚へ。原石を削って木槍の先へ。</p></div><button id="modal-coastal" class="button button-outline">貝と石器の作り方</button><button id="modal-cook-shellfish" class="button button-outline">貝を焼く</button><button id="modal-eat-shellfish" class="button button-outline">焼いた貝を食べる</button></div>',
  );
  $('#modal-coastal').onclick = () => coastalUI.open();
  $('#modal-cook-shellfish').onclick = () => {
    $('#modal').close();
    action('cookShellfish');
  };
  $('#modal-eat-shellfish').onclick = () => action('eatShellfish');
  $('#modal-body').insertAdjacentHTML(
    'afterbegin',
    '<div class="gulf-actions"><button id="modal-crop-food" class="button button-outline">火根と香草の食事</button><button id="modal-crop-farms" class="button button-outline">共同の畑と種</button></div>',
  );
  $('#modal-crop-food').onclick = () => cropFoodUI.open();
  $('#modal-crop-farms').onclick = () => gulfUI.open();
  $('.recipe strong').id = 'modal-axe-label';
  $('.recipe').insertAdjacentHTML(
    'afterend',
    '<div class="recipe"><span class="resource-icon wood">' +
      icon('wood') +
      '</span><div><strong>丸木舟をつくる</strong><p>木材12 · 海岸で制作 · Bで乗船</p></div><button id="modal-boat-craft" class="button button-accent">船をつくる</button></div>',
  );
  $('#modal-boat-craft').onclick = () => {
    action('craftBoat');
    $('#modal').close();
  };
  updateModalHUD();
}
function openTribe() {
  openModal(
    `<h2>同じ火を囲む仲間。</h2><p class="modal-intro">いま、この谷で暮らしている ${state.players.length} 人。</p><div id="tribe-list" class="tribe-list"></div><button id="tribe-invite" class="button button-accent wide">${icon('plus')} 仲間を招待する</button><p class="form-note">NPCのオルは参加人数に含まれません。ひとりでも採集や拠点づくりを楽しめます。</p>`,
  );
  $('#modal-body .modal-intro').id = 'tribe-summary';
  updateModalHUD();
  $('#tribe-invite').onclick = openInvite;
}
function openJournal() {
  adventureUI.open();
}
function openHelp() {
  openModal(
    `<h2>あそびかた</h2><p class="modal-intro">最初は、近くの木や石を集めてみましょう。目標は画面左の「目標」に表示されます。</p><div class="help-grid"><div><kbd>W A S D</kbd><strong>歩く・走る</strong><p>通常は歩行。方向キーを素早く2回押すと走行（離すまで続く）。「走る」ボタンでも切り替えられます。近くまで自分で移動してから操作しよう。</p></div><div><kbd>E</kbd><strong>近くでアクション</strong><p>採集、焚き火に届ける、オルと交換。</p></div><div><kbd>1 · 2 · 3 · 4</kbd><strong>アクションを選ぶ</strong><p>採集・道具づくり・資材を届ける・交換。</p></div><div><kbd>Enter</kbd><strong>仲間と話す</strong><p>チャットを開き、Enterで送信。</p></div><div><kbd>ESC · M · I · J</kbd><strong>メニュー・地図・もちもの・手帳</strong><p>ESCでメニュー。M で世界地図、I でもちもの、J で探索手帳を直接開けます。G で手をふる。</p></div></div><div class="help-tip">${icon('flame')} まずは木材3と石2で石斧を作ろう。<br>そのあと、仲間と拠点に木材12・石6を届けよう。</div><button id="help-start" class="button button-accent wide">${joined ? '探索に戻る' : '閉じる'} ${icon('arrow')}</button>`,
  );
  $('#modal-body .modal-intro').insertAdjacentHTML('afterend', gamepadHelp);
  $('#modal-body .help-grid').insertAdjacentHTML(
    'beforeend',
    '<div><kbd>Space / L2</kbd><strong>ジャンプ</strong><p>画面の「ジャンプ」でも跳べます。歩行・走行中にも使えます。着地してからもう一度。採集や調理の途中なら作業を中止します。</p></div>',
  );
  $('.help-grid').insertAdjacentHTML(
    'beforeend',
    `<div><kbd>DRAG</kbd><strong>肩越しカメラを回す</strong><p>マウス右・左ドラッグ、または指のドラッグで周囲を見渡せます。WASDはカメラの向きに合わせて動きます。</p></div><div><kbd>SCROLL</kbd><strong>カメラの距離を変える</strong><p>ホイールか＋・−ボタンで調整。「自分の位置へ」で初期のTPS視点に戻せます。</p></div>`,
  );
  $('.help-grid').insertAdjacentHTML(
    'afterbegin',
    `<div><kbd>F / 5</kbd><strong>刀・魔法・槍で攻撃</strong><p>相手を向いて F か攻撃ボタン。クノイチは近くを刀で斬り、魔法使いは両手から光弾を飛ばします。敵がいなくても発動でき、壁は通り抜けません。人間は槍を使います。</p></div><div><kbd>E</kbd><strong>肉を採って、焼いて食べる</strong><p>倒すと肉になります。近づいて E で採り、近くの焚き火で E か「焼く」。3秒待ったら「食べる」で元気を回復。火から離れると調理は中止され、生肉は残ります。</p></div>`,
  );
  $('.help-grid').insertAdjacentHTML(
    'afterbegin',
    `<div><kbd>R</kbd><strong>マンモスに乗る・降りる</strong><p>生きているマンモスの横で R。1頭につき1人乗れます。WASDで移動し、方向キー2回押しか走行ボタンで走ります。攻撃や採集は開けた場所で降りてから。</p></div>`,
  );
  $('#help-start').onclick = () => $('#modal').close();
  $('.help-grid').insertAdjacentHTML(
    'afterbegin',
    `<div><kbd>B</kbd><strong>船を作って海を渡る</strong><p>木材12個を集め、自分で岸まで歩いて「船をつくる」。Bで乗り、WASDで操船。方向キー2回押しで速く進み、岸でBを押すと降ります。1隻1人、部屋で5隻まで共有できます。</p></div>`,
  );
  if (state.enemies?.length)
    $('.help-grid').insertAdjacentHTML(
      'beforeend',
      `<div><kbd>大城の赤い印</kbd><strong>白羽の呪術師</strong><p>始まりの谷の北東にある白羽の大城へ。城門の階段から入り、左右の階段を登ると上階の広間にいます。相手を向いて F で攻撃。力尽きても4秒後に焚き火で回復し、持ち物は残ります。</p></div>`,
    );
}
function updateGamepadHints(active: boolean) {
  usingGamepad = active;
  for (const [selector, label] of [
    ['#interaction-hint kbd', active ? '×' : 'E'],
    ['#attack-button kbd', active ? '□ / R2' : 'F'],
    ['#jump-button kbd', active ? 'L2' : 'Space'],
    ['#ride-button kbd', active ? '△' : 'R'],
    ['#boat-board kbd', active ? '△' : 'B'],
    ['#chat-toggle kbd', active ? '⌨' : 'Enter'],
    ['#menu-button kbd', active ? 'OPTIONS' : 'ESC'],
  ])
    $(selector).textContent = label;
  updatePromptBar();
  updateHuntingHUD();
}
let promptSignature = '';
function updatePromptBar() {
  const me = player();
  const prompts = keyPrompts(usingGamepad, {
    ride: !$('#ride-button').disabled || !!me?.mountId,
    boat: !$('#boat-board').disabled || !!me?.boatId,
  });
  const signature = JSON.stringify(prompts);
  if (signature === promptSignature) return;
  promptSignature = signature;
  $('#prompt-bar').innerHTML = prompts
    .map((p) => `<span><kbd>${p.key}</kbd>${p.label}</span>`)
    .join('');
}

function controllerRide() {
  if (player()?.boatId) action('boardBoat');
  else if (player()?.mountId) ride();
  else if (!$('#boat-board').disabled) action('boardBoat');
  else ride();
}

function openPauseMenu() {
  if (screens.active) return;
  const entries: [string, string, string, () => void][] = [
    ['resume', 'compass', '探索に戻る', () => $('#modal').close()],
    ['inventory', 'bag', 'もちもの・道具', openInventory],
    ['map', 'expand', '世界地図', openMap],
    ['journal', 'book', '探索手帳', openJournal],
    ['gulf', 'wave', '三つの国・共同の畑', () => gulfUI.open()],
    ['fishing', 'wave', '魚場と釣り方', () => fishingUI.open()],
    ['coastal', 'stone', '貝塚・黒曜石の道具', () => coastalUI.open()],
    ['residents', 'wave', '集落の人びと・今日の手伝い', () => villageUI.open()],
    ['tribe', 'people', '部族の仲間・招待', openTribe],
    ['help', 'help', 'あそびかた', openHelp],
    ['ride', 'target', '船・マンモスに乗る／降りる', controllerRide],
    ['wave', 'wave', '手をふる', () => action('wave')],
    ['profile', 'people', '部屋・キャラクターを変える', () => showSetup()],
    ['title', 'close', 'タイトルへ戻る', leaveToTitle],
  ];
  openModal(
    `<div class="pause-menu"><p class="screen-eyebrow">PAUSE</p><h2>メニュー</h2><p class="modal-intro">${usingGamepad ? '十字キー・左スティックで上下左右に選ぶ · × ○ □ △ どれでも決定 · 戻るときは画面内の「戻る」を選ぶ' : 'ESC で閉じる · ↑↓←→ で選ぶ · Enter で決定'}</p><div class="controller-menu">${entries
      .map(
        ([id, glyph, label]) =>
          `<button class="button button-outline" data-controller-menu="${id}">${icon(glyph)}<span>${label}</span></button>`,
      )
      .join(
        '',
      )}</div><div class="settings-row"><span class="settings-label">設定</span><button class="button button-outline" data-setting="sound" aria-pressed="${soundEnabled}">${icon(soundEnabled ? 'sound' : 'muted')} 環境音 ${soundEnabled ? 'オン' : 'オフ'}</button><button class="button button-outline" data-setting="fullscreen">${icon('expand')} 全画面表示</button><button class="button button-outline" data-setting="camera">${icon('target')} 視点を戻す</button><button class="button button-outline" data-setting="zoom-out">− 遠く</button><button class="button button-outline" data-setting="zoom-in">+ 近く</button></div>${usingGamepad ? gamepadHelp : ''}</div>`,
  );
  for (const [id, , , handler] of entries) {
    $(`[data-controller-menu="${id}"]`).onclick = () => {
      handler();
    };
  }
  $('[data-setting="sound"]').onclick = toggleSound;
  $('[data-setting="fullscreen"]').onclick = toggleFullscreen;
  $('[data-setting="camera"]').onclick = () => renderer.focusPlayer();
  $('[data-setting="zoom-out"]').onclick = () => renderer.adjustZoom(-0.15);
  $('[data-setting="zoom-in"]').onclick = () => renderer.adjustZoom(0.15);
}

function openMap() {
  setWorldMapMode(inGulf(player()?.x, player()?.z) ? 'gulf' : 'earth');
  setWorldMapSelection(null);
  openModal(
    `<h2>大陸と、三つの岸を旅する。</h2><p class="modal-intro">8,192 × 4,096 mの世界。大陸と、1,480 × 1,340 mの創作の湾へ。地図で場所と距離を確認し、自分で歩いたり、船を漕いで探索しよう。</p><div class="earth-map-toolbar"><button class="button button-outline" id="map-overview" aria-pressed="true">世界全図</button><button class="button button-outline" id="map-gulf" aria-pressed="false">三つの岸の全図</button><button class="button button-outline" id="map-local" aria-pressed="false">現在地の周辺</button><span>北が上 · 人物の大きさはそのまま</span></div><canvas id="big-map" width="960" height="480" class="big-map earth-map" aria-label="氷河時代を参考にした大陸と、創作地域の三つの岸の湾の地図"></canvas><div class="earth-map-legend">${BIOMES.map((b) => `<span><i style="background:${b.color}"></i>${b.short}</span>`).join('')}<span><i style="background:#285566"></i>海</span></div><div class="earth-travel"><label for="map-location">野営地を選ぶ</label><select id="map-location">${EXPEDITION_STOPS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select><p id="map-selection" aria-live="polite"></p><small>地図の選択では移動しません。地図を閉じ、自分で移動しよう。</small></div><div class="map-locations"><button class="button button-outline" id="map-camp">${icon('flame')} はじまりの焚き火</button><button class="button button-outline" id="map-hunt-north">${icon('spear')} 北西の狩場</button><button class="button button-outline" id="map-hunt-south">${icon('spear')} 南西の狩場</button><button class="button button-outline" id="map-npc">${icon('people')} オルの集落</button></div><details class="earth-map-sources"><summary>この世界の時代と地図について</summary><p>ネアンデルタール人の生存期間内である約5万年前が基準です。NOAA ETOPO1の地形を海面 −68.3 mで区切り、正距円筒図法で縮小しています。細い海峡・小島、氷床と気候の範囲は簡略化しています。元の大陸の位置を保ち、西へ広げた三つの岸の湾は創作地域で、国・農耕・異なる時代の人々の共存はファンタジーです。野営地は探索用の配置です。</p><a href="https://www.ncei.noaa.gov/products/etopo-global-relief-model" target="_blank" rel="noreferrer">地形資料：NOAA</a> · <a href="https://cp.copernicus.org/articles/12/1079/2016/" target="_blank" rel="noreferrer">海面資料：Spratt & Lisiecki (2016)</a></details>`,
  );
  let selected = EXPEDITION_STOPS[0];
  const selectTarget = (target) => {
    selected = target;
    setWorldMapSelection(target);
    const geo = worldToGeo(target.x, target.z);
    const location = inGulf(target.x, target.z)
      ? '三つの岸 · 創作地域'
      : target.x < EARTH.minX ||
          target.x > EARTH.maxX ||
          target.z < EARTH.minZ ||
          target.z > EARTH.maxZ
        ? '外海'
        : `${Math.abs(geo.latitude).toFixed(1)}°${geo.latitude >= 0 ? 'N' : 'S'} ${Math.abs(geo.longitude).toFixed(1)}°${geo.longitude >= 0 ? 'E' : 'W'}`;
    $('#map-selection').textContent =
      `${target.name ?? biomeAt(target.x, target.z).short} · ${Math.round(distance(player() ?? CAMP, target))} m先 · ${location}`;
    drawMinimap($('#big-map'), true);
  };
  $('#map-location').onchange = (event) => selectTarget(locationById(event.target.value));
  for (const [id, mode] of [
    ['map-overview', 'earth'],
    ['map-local', 'local'],
    ['map-gulf', 'gulf'],
  ])
    $('#' + id).onclick = () => {
      setWorldMapMode(mode);
      $('#map-overview').setAttribute('aria-pressed', String(mode === 'earth'));
      $('#map-local').setAttribute('aria-pressed', String(mode === 'local'));
      $('#map-gulf').setAttribute('aria-pressed', String(mode === 'gulf'));
      drawMinimap($('#big-map'), true);
    };
  $('#map-overview').setAttribute('aria-pressed', String(!inGulf(player()?.x, player()?.z)));
  $('#map-gulf').setAttribute('aria-pressed', String(inGulf(player()?.x, player()?.z)));
  drawMinimap($('#big-map'), true);
  $('#map-camp').onclick = () => selectTarget({ x: 49, z: 52.4, name: '野営地の焚き火' });
  $('#map-npc').onclick = () => selectTarget({ ...NPC, name: 'オルの集落' });
  if (state.enemies?.some((enemy) => enemy.hostile === true)) {
    $('.map-locations').insertAdjacentHTML(
      'beforeend',
      `<button class="button button-outline enemy-map-button" id="map-enemy">${icon('spear')} 大城の広間の白羽の呪術師</button>`,
    );
    $('#map-enemy').onclick = () => selectTarget({ ...ENEMY_GROUNDS[0], name: '白羽の呪術師' });
  }
  $('.map-locations').insertAdjacentHTML(
    'beforeend',
    `<button class="button button-outline" id="map-castle">白羽の大城の城門</button>`,
  );
  $('#map-castle').onclick = () => selectTarget(CASTLE_GATE);
  for (const direction of ['north', 'south'])
    $(`#map-hunt-${direction}`).onclick = () => {
      const clearing = SCENERY.animals[direction === 'north' ? 0 : 1],
        animal = state.animals?.find((item) => item.id === clearing.id);
      selectTarget({ ...(animal ?? clearing), name: '狩場の草原' });
    };
  $('#big-map').onclick = (event) => {
    const canvas = event.currentTarget,
      rect = canvas.getBoundingClientRect(),
      projection = mapProjection(canvas, true, player()),
      px = ((event.clientX - rect.left) * canvas.width) / rect.width,
      py = ((event.clientY - rect.top) * canvas.height) / rect.height;
    const stop = EXPEDITION_STOPS.find((s) => {
      const p = projection.point(s.x, s.z);
      return Math.hypot(p[0] - px, p[1] - py) < 12;
    });
    if (stop) {
      $('#map-location').value = stop.id;
      selectTarget(stop);
      return;
    }
    const target = projection.world(px, py);
    selectTarget(target);
  };
  selectTarget(selected);
}
function cook() {
  const me = player();
  if (!me) return;
  const fire = nearestCookingFire(state, me);
  if (distance(me, fire) > HUNTING.cookRange) {
    notify('焚き火のそばまで自分で近づくと、調理できます。');
  } else action('cook');
}
function playNote() {
  if (!soundEnabled || !audioContext) return;
  const osc = audioContext.createOscillator(),
    gain = audioContext.createGain();
  osc.type = 'sine';
  osc.frequency.value = [220, 293.66, 329.63, 440, 587.33][Math.floor(Math.random() * 5)];
  gain.gain.setValueAtTime(0, audioContext.currentTime);
  gain.gain.linearRampToValueAtTime(0.035, audioContext.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.001, audioContext.currentTime + 2);
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.start();
  osc.stop(audioContext.currentTime + 2);
}
async function toggleSound() {
  try {
    audioContext ||= new (window.AudioContext || window.webkitAudioContext)();
    await audioContext.resume();
    soundEnabled = !soundEnabled;
    clearInterval(audioTimer);
    if (soundEnabled) {
      playNote();
      audioTimer = setInterval(playNote, 3200);
    }
    const button = $('[data-setting="sound"]');
    if (button) {
      button.innerHTML = `${icon(soundEnabled ? 'sound' : 'muted')} 環境音 ${soundEnabled ? 'オン' : 'オフ'}`;
      button.setAttribute('aria-pressed', String(soundEnabled));
    }
  } catch {
    notify('このブラウザでは環境音を再生できません。');
  }
}

document
  .querySelectorAll<HTMLElement>('[data-action]')
  .forEach((b) => (b.onclick = () => action(b.dataset.action)));
document
  .querySelectorAll<HTMLElement>('[data-inventory]')
  .forEach((b) => (b.onclick = openInventory));
$('#status-plate').onclick = openTribe;
$('#menu-button').onclick = openPauseMenu;
$('#map-button').onclick = openMap;
$('#attack-button').onclick = attack;
$('#jump-button').onclick = jump;
$('#meat-inventory').onclick = openInventory;
$('#cook-button').onclick = cook;
$('#eat-meat-button').onclick = () => action('eatMeat');
$('#cancel-cook').onclick = () =>
  action(
    player()?.coastalActivity
      ? 'cancelCoastal'
      : player()?.fishing
        ? 'cancelFishing'
        : 'cancelCook',
  );
$('#interaction-hint').setAttribute('role', 'button');
$('#interaction-hint').tabIndex = 0;
$('#interaction-hint').onclick = () => {
  const next = nearby();
  action(next?.action || 'gather', next?.targetId);
};
$('#interaction-hint').onkeydown = (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    e.stopPropagation();
    $('#interaction-hint').click();
  }
};
$('#eat-button').onclick = () => action('eat');
$('#run-button').onclick = () => {
  runMode = !runMode;
  $('#run-button').setAttribute('aria-pressed', String(runMode));
  $('#run-button span').textContent = runMode ? '歩く' : '走る';
};
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notify('この画面では全画面表示を利用できません。');
  }
}
$('#title-start').onclick = () => showSetup();
$('#title-continue').onclick = () => enterGame();
$('#title-howto').onclick = openHelp;
$('#title-fullscreen').onclick = toggleFullscreen;
$('#setup-back').onclick = () => (joined ? screens.hide() : showTitle());
$('#setup-form').onsubmit = (e) => {
  e.preventDefault();
  applyProfileForm(e.currentTarget);
  enterGame();
};
$('#modal-close').onclick = () => $('#modal').close();
$('#modal').addEventListener('click', (e) => {
  if (e.target === $('#modal')) {
    const r = e.target.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
      e.target.close();
  }
});
function setChatOpen(open) {
  $('#chat-content').hidden = !open;
  $('.chat-collapse').textContent = open ? '−' : '+';
  $('#chat-toggle').setAttribute('aria-expanded', String(open));
  if (open) stopInput();
  else $('#chat-input').blur();
}
$('#chat-toggle').setAttribute('aria-label', 'チャットを開く／閉じる');
$('#chat-toggle').setAttribute('aria-expanded', String(!$('#chat-content').hidden));
$('#chat-toggle').onclick = () => setChatOpen($('#chat-content').hidden);
$('#chat-form').onsubmit = (e) => {
  e.preventDefault();
  const text = $('#chat-input').value.trim();
  if (!text) return;
  if (!joined) return notify('チャットの送信には接続が必要です。', 'error');
  send({ type: 'chat', text });
  $('#chat-input').value = '';
  $('#chat-input').blur();
};
$('#chat-input').addEventListener('focus', stopInput);
document.addEventListener('keydown', (e) => {
  if (
    (e.target as Element)?.closest<HTMLElement>('input,textarea,select,[contenteditable]') ||
    !acceptsGameShortcut(e) ||
    $('#modal').open ||
    screens.active ||
    renderUnavailable
  )
    return;
  if (e.key === 'Escape' && joined) {
    e.preventDefault();
    openPauseMenu();
    return;
  }
  if (
    ['Enter', ' '].includes(e.key) &&
    (e.target as Element)?.closest<HTMLElement>('button,a,[role="button"]')
  )
    return;
  const k = movementKey(e);
  if (DIRECTION_KEYS.includes(k)) {
    e.preventDefault();
    if (player()?.downedUntil) blockedMovementKeys.add(k);
    else if (!blockedMovementKeys.has(k)) {
      if (!e.repeat) {
        const now = performance.now();
        if (now - (lastTapAt.get(k) ?? -Infinity) < DOUBLE_TAP_MS) dashing = true;
        lastTapAt.set(k, now);
      }
      keys.add(k);
    }
    return;
  }
  if (e.code === 'Space' || e.key === ' ') {
    e.preventDefault();
    if (!e.repeat) jump();
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyB' || k === 'b') {
    e.preventDefault();
    action('boardBoat');
  }
  if ((e.code === 'KeyR' || k === 'r') && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    ride();
  }
  if (k === 'e') {
    e.preventDefault();
    const next = nearby();
    action(next?.action || 'gather', next?.targetId);
  }
  if (isAttackShortcut(e)) {
    e.preventDefault();
    attack();
  }
  if (['1', '2', '3', '4'].includes(k))
    action(['gather', 'craft', 'contribute', 'trade'][Number(k) - 1]);
  if (k === 'enter') {
    e.preventDefault();
    setChatOpen(true);
    $('#chat-input').focus();
  }
  if (k === '?' || k === 'h') openHelp();
  if (k === 'm') openMap();
  if (k === 'i') openInventory();
  if (k === 'j') openJournal();
  if (k === 'g') action('wave');
});
document.addEventListener('keyup', (e) => {
  const key = movementKey(e);
  keys.delete(key);
  blockedMovementKeys.delete(key);
  if (!DIRECTION_KEYS.some((k) => keys.has(k))) dashing = false;
});
window.addEventListener('blur', stopInput);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopInput();
});
gamepadControls = new GamepadControls({
  dialog: $('#modal'),
  canvas: $('#world'),
  menu: () => ($('#modal').open ? $('#modal') : screens.activeElement()),
  closeMenu: () => {
    if ($('#modal').open) $('#modal').close();
    else if (screens.active === 'guide') finishGuide();
    else if (screens.active === 'setup') $('#setup-back').click();
  },
  canPlay: () =>
    joined && !renderUnavailable && !screens.active && !!player() && !player()?.downedUntil,
  onStop: stopInput,
  onActivity: updateGamepadHints,
  onLook: (x, y, dt) => renderer.rotateCamera(x * dt * 2.4, y * dt * 1.5),
  onAction: (command) => {
    switch (command) {
      case 'confirm':
        $('#interaction-hint').click();
        break;
      case 'attack':
        if (
          canStartAttack(
            player(),
            (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt,
          )
        )
          attack();
        break;
      case 'ride':
        controllerRide();
        break;
      case 'jump':
        jump();
        break;
      case 'cancel':
        stopInput();
        if (player()?.cookingEndsAt) action('cancelCook');
        break;
      case 'map':
        openMap();
        break;
      case 'menu':
        openPauseMenu();
        break;
      case 'inventory':
        openInventory();
        break;
      case 'journal':
        openJournal();
        break;
      case 'center':
        renderer.focusPlayer();
        break;
      case 'zoomIn':
        renderer.adjustZoom(0.15);
        break;
      case 'zoomOut':
        renderer.adjustZoom(-0.15);
        break;
    }
  },
});
let lastMoveSent = 0;
function updateMovementInput() {
  if (player()?.downedUntil || !joined || renderUnavailable) {
    keys.clear();
    movementCommands.reset();
    return;
  }
  let sx = 0,
    sy = 0;
  const canMove =
    !document.hidden &&
    document.hasFocus() &&
    !$('#modal').open &&
    !screens.active &&
    !document.activeElement?.closest('input,textarea,select,[contenteditable]');
  if (canMove) {
    if (keys.has('w') || keys.has('arrowup')) sy--;
    if (keys.has('s') || keys.has('arrowdown')) sy++;
    if (keys.has('a') || keys.has('arrowleft')) sx--;
    if (keys.has('d') || keys.has('arrowright')) sx++;
  }
  const motion = combineMovement(
    sx,
    sy,
    wantsToRun(),
    canMove ? gamepadControls.movement : { x: 0, y: 0, running: false },
  );
  const running = motion.running;
  if (running !== lastGait) {
    send({ type: 'gait', running });
    lastGait = running;
  }
  const { dx, dz } = renderer.getMovementDirection(motion.x, motion.y),
    changed = movementCommands.direction !== `${dx},${dz}`,
    command = movementCommands.next({ dx, dz, running });
  const now = performance.now();
  if (renderer.prediction?.enabled) renderer.prediction.setInput(dx, dz, running, now);
  if (command && (multiplayer.mode !== 'lan' || changed || now - lastMoveSent >= 70)) {
    send(command);
    lastMoveSent = now;
  }
}
if (multiplayer.mode === 'lan') {
  const localInputFrame = () => {
    updateMovementInput();
    requestAnimationFrame(localInputFrame);
  };
  requestAnimationFrame(localInputFrame);
} else setInterval(updateMovementInput, 70);
setInterval(() => send({ type: 'ping', at: Date.now() }), 3000);
setInterval(updateHuntingHUD, 100);
const hudObserver = new ResizeObserver((entries) => {
  for (const entry of entries)
    $('.game-viewport').style.setProperty(
      '--hud-height',
      `${entry.target.getBoundingClientRect().height}px`,
    );
});
hudObserver.observe($('.hotbar-wrap'));
window.addEventListener('beforeunload', () => {
  manualLeave = true;
  socket?.close();
  hudObserver.disconnect();
  gamepadControls.destroy();
  screens.destroy();
  renderer.destroy();
});
// The title screen slowly pans the camera around the world until play begins.
let titleClock = 0;
function titleIdle(now: number) {
  if (screens.active === 'title')
    renderer.rotateCamera(Math.min(0.05, (now - titleClock) / 1000) * 0.05, 0);
  titleClock = now;
  requestAnimationFrame(titleIdle);
}
requestAnimationFrame(titleIdle);
renderer.assetsPromise
  ?.then(() => ($('#title-status').textContent = '準備完了'))
  .catch(() => ($('#title-status').textContent = '3D画面を表示できません'));
if (query.get('autostart') === '1') {
  // QA scripts and local shortcuts skip the title, setup and guide screens.
  enterGame();
  guidePending = false;
} else showTitle();
