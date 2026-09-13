import { mapScreen } from './map-screen.js';
import { installMapWarp, updateMapWarp, type MapInput } from './map-warp-ui.js';
import {
  closeCharacterConfirm,
  openCharacterSwitch,
  updateCharacterSwitch,
} from './character-switch-ui.js';
import { carrying, canCarry } from '../shared/carrying.mjs';
import { readSaved, save, savedSession, saveSession } from './session-storage.js';
import {
  loadMultiplayerConfig,
  multiplayerUrl,
  multiplayerSessionKey,
} from './multiplayer-config.js';
import type { ViewState } from './view-state.js';
import { normalizeCharacter, characterModel } from '../shared/characters.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import {
  characterChoicesMarkup,
  bindCharacterSelection,
  parseCharacterValue,
} from './character-selection.js';
import { WorldRenderer } from './world3d.js';

import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '../shared/world.mjs';
import { HUNTING, usableCookingFire } from '../shared/hunting.mjs';
import { CROP_INVENTORY, ROOT_RECIPES } from '../shared/crops.mjs';
import { installCropFoodUI } from './crop-food-ui.js';
import { canMount, ridingDistance } from '../shared/riding.mjs';
import { GamepadControls } from './gamepad-ui.js';
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
import { GATHER_RANGE, interactionVisible } from '../shared/interactions.mjs';
import { ENEMY_GROUNDS, SCENERY } from '../shared/scenery-layout.mjs';
import { CASTLE_GATE } from '../shared/castle-layout.mjs';
import { playerDamageEvent } from './enemy-state.js';
import { biomeAt } from '../shared/biomes.mjs';
import { drawWorldMap, setWorldMapSelection } from './world-map.js';
import { locationName } from '../shared/paleo-geography.mjs';
import { regionAt } from '../shared/adventure-regions.mjs';
import { installAdventureUI, adventureInteraction } from './adventure-ui.js';
import { installFishingUI, fishingInteraction } from './fishing-ui.js';
import { FISHING } from '../shared/fishing-sites.mjs';
import { COASTAL } from '../shared/coastal-sites.mjs';
import { installCoastalUI, coastalInteraction } from './coastal-ui.js';
import { installGulfUI, gulfInteraction } from './gulf-ui.js';
import { installVillageUI, residentInteraction } from './village-ui.js';
import { inGulf } from '../shared/gulf-region.mjs';
import { ScreenManager, AreaBanner, keyPrompts } from './screens.js';
import { helpTabsMarkup, bindHelpTabs } from './help-content.js';
import { titleCreditsMarkup } from './title-credits.js';
import {
  DIFFICULTIES,
  DIFFICULTY_LEVELS,
  normalizeDifficulty,
  type Difficulty,
} from '../shared/difficulty.mjs';

const icons = {
  unarmed:
    '<path d="M5 12V8a2 2 0 0 1 4 0V6a2 2 0 0 1 4 0v1a2 2 0 0 1 4 0v2a2 2 0 0 1 4 0v7l-4 5H9l-6-7a2 2 0 0 1 2-2Z"/>',
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
// The exhibition LAN build never asks for a name or room: each PC is a fixed
// player in the fixed exhibition room, and only the character is chosen.
const fixedIdentity = multiplayer.mode === 'lan';
const titleEdition = multiplayer.mode === 'lan' ? 'DUO' : 'XI';
const titleArtPath = `/title/cro-magnon-${titleEdition.toLowerCase()}-transparent.png`;
const cleanRoom = (value: string) =>
  value
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 16);
let profile = {
  name: fixedIdentity
    ? multiplayer.guestName || 'プレイヤー'
    : multiplayer.guestName ||
      readSaved('cro-name', `旅人${Math.floor(Math.random() * 900 + 100)}`),
  ...normalizeCharacter({
    species: readSaved('cro-species', 'cro'),
    gender: readSaved('cro-gender', 'female'),
  }),
  difficulty: normalizeDifficulty(readSaved('cro-difficulty', 'normal')),
  room: fixedIdentity
    ? cleanRoom(multiplayer.room || '') || 'EXHIBITION'
    : cleanRoom(query.get('room') || multiplayer.room || readSaved('cro-room', 'EMBER')) || 'EMBER',
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
let localRoomReset = false,
  roomResetVersion = 0;
let renderUnavailable = false;
let audioContext = null,
  audioTimer = null,
  soundEnabled = false;
const keys = new Set();
const blockedMovementKeys = new Set();
const movementCommands = new MovementCommands();
let gamepadControls: GamepadControls | undefined;
/** The open atlas, so the controller can hand it pointer, zoom and confirm frames. */
let mapInput: MapInput | undefined;
let usingGamepad = false;
let selectedAnimalId = null,
  stateReceivedAt = performance.now(),
  hurtUntil = 0;

const joinFields = () =>
  (fixedIdentity
    ? `<input type="hidden" name="name"><input type="hidden" name="room">`
    : `<div class="setup-identity"><label>あなたの名前<input name="name" maxlength="16" required autocomplete="off" autofocus></label><label>部屋のコード <span>英数字・ハイフン・アンダースコア / 最大16文字</span><input name="room" maxlength="16" pattern="[A-Za-z0-9_\\-]+" required autocomplete="off"></label></div>`) +
  characterChoicesMarkup() +
  difficultyChoicesMarkup();

function difficultyChoicesMarkup() {
  return `<fieldset class="difficulty-options"><legend class="character-legend">難易度を選ぶ</legend><div class="difficulty-choice-grid">${DIFFICULTY_LEVELS.map(
    (id) => {
      const option = DIFFICULTIES[id];
      return `<label class="difficulty-choice"><input type="radio" name="difficulty" value="${id}" required><span><strong>${option.label}</strong><small>${option.description}</small></span></label>`;
    },
  ).join('')}</div><p>難易度は仲間とは別に選べ、あとから設定で変えられます。</p></fieldset>`;
}

function bindDifficultySelection(form: HTMLFormElement) {
  const input = form.querySelector<HTMLInputElement>(
    `input[name="difficulty"][value="${normalizeDifficulty(profile.difficulty)}"]`,
  );
  if (input) input.checked = true;
}
$('#app').innerHTML = `
  <section class="game-viewport" aria-label="${GAME_TITLE} ゲーム画面">
    <canvas id="world" aria-label="氷河時代の大陸が広がる3Dワールド。WASDまたは左スティックで移動。左スティックを浅く倒すと歩き、深く倒すと走ります。右スティックまたはドラッグでカメラ回転。" tabindex="0"></canvas>
    <div class="tps-reticle" aria-hidden="true"><i></i></div>
    <div class="scene-shade"></div>
    <div id="damage-flash" class="damage-flash" aria-hidden="true" hidden></div>
    <div id="combat-status" class="combat-status" role="status" hidden></div>
    <div id="area-banner" class="area-banner" aria-live="polite" hidden><small></small><strong></strong></div>
    <button id="status-plate" class="status-plate" title="部族の仲間・招待"><span class="energy-track" id="energy-track" data-level="ok"><span id="energy-bar" class="energy-fill"></span><em class="energy-label">${icon('leaf')}<b>体力</b><span id="energy-label">100 / 100</span></em></span><span class="status-main"><span class="portrait cro cro-magnon-woman" id="my-portrait"><i></i></span><span class="status-text"><strong id="profile-name"></strong><small><span id="room-label"></span><i>·</i><b id="online-count">0/5</b><i>·</i><span id="day-label">1日目</span></small></span></span></button>
    <div class="map-hud"><button id="map-button" class="minimap-button" aria-label="世界地図を開く" title="世界地図 [M]"><canvas id="minimap" width="160" height="115"></canvas><span class="map-north">N</span><span class="map-area" id="map-area">はじまりの谷</span><kbd class="map-key">M</kbd></button><div class="connection"><i class="status-dot" id="connection-dot"></i><span id="connection-label">未接続</span><span id="ping-label">— ms</span></div></div>
    <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
    <div class="chat-panel"><button class="chat-heading" id="chat-toggle">${icon('chat')}<strong>焚き火の会話</strong><kbd>Enter</kbd><span class="chat-collapse">−</span></button><div id="chat-content"><div id="chat-messages" class="chat-messages" role="log" aria-live="polite"><p class="chat-system">この谷での物語が、ここから始まります。</p></div><form id="chat-form"><input id="chat-input" maxlength="180" placeholder="仲間に話しかける…" aria-label="チャットメッセージ" autocomplete="off"><button aria-label="メッセージを送信" type="submit">${icon('arrow')}</button></form></div></div>
    <div class="hotbar-wrap"><div class="interaction-hint" id="interaction-hint" hidden><kbd>E</kbd><span></span></div></div>
    <div id="prompt-bar" class="prompt-bar" aria-label="操作の案内"></div>
    <div id="screens" class="screens">
      <section id="screen-title" class="screen title-screen" hidden>
        <div class="title-content">
          <div class="title-hero">
          <div class="title-logo" style="--title-art: url('${titleArtPath}')"><h1>${GAME_TITLE}</h1><img class="title-art" src="${titleArtPath}" width="1536" height="1024" alt="CRO-MAGNON ${titleEdition} — 氷河時代の旅人たちとマンモス" fetchpriority="high"></div>
          <div class="title-welcome">
          <nav class="title-menu" aria-label="タイトルメニュー">
            <button id="title-start" class="menu-item">はじめる</button>
            <button id="title-howto" class="menu-item">あそびかた</button>
          </nav>
          </div>
          </div>
          ${titleCreditsMarkup()}
        </div>
        <button id="title-fullscreen" class="title-fullscreen" type="button" aria-label="全画面表示" aria-pressed="false">${icon('expand')}</button>
        <div class="title-footer"><span>v0.1</span></div>
      </section>
      <section id="screen-setup" class="screen setup-screen" hidden>
        <form id="setup-form" class="setup-card"><p class="form-error" id="setup-error" hidden></p>${joinFields()}<div class="setup-actions"><button type="button" id="setup-back" class="button button-outline setup-back">戻る</button><button class="setup-launch" id="setup-submit" type="submit"><span class="setup-launch-text">この谷へ出発する</span>${icon('arrow')}</button></div></form>
      </section>
    </div>
  </section>
  <dialog id="modal"><div class="modal-top"><span class="eyebrow">${GAME_TITLE}</span><button id="modal-close" class="button button-outline modal-back" type="button">戻る</button></div><div id="modal-body"></div></dialog>`;

const areaBanner = new AreaBanner($('#area-banner'));
const screens = new ScreenManager($('#screens'), (id) => {
  if (id) stopInput();
  else $('#world').focus({ preventScroll: true });
});

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
  `<div class="riding-controls" hidden><button id="ride-button" class="hunt-button"><kbd>R</kbd><span>マンモスに乗る</span></button><button id="carry-decline" class="hunt-button" hidden>断る</button><small id="riding-hint">1頭に1人 · 近づいて R で乗る</small></div>`,
);
$('#ride-button').onclick = ride;
$('#carry-decline').onclick = () => action('carryDecline');
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
  `<div class="hunt-controls"><div id="magic-cooldown" class="hunt-button" hidden></div><button id="cook-button" class="hunt-button" hidden>${icon('flame')}<span>肉を焼く</span></button></div><div id="cooking-status" class="cooking-status" hidden><span id="cooking-label">肉を焼いています…</span><progress id="cooking-progress" max="1" value="0" aria-label="肉を焼く進み具合"></progress><button id="cancel-cook">中止</button></div>`,
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
  updateCharacterSwitch(player(), renderer.serverNow(), connected);
  if (!connected) renderer.prediction?.reset();
  $('#connection-dot').classList.toggle('offline', !connected);
  $('#connection-label').textContent =
    multiplayer.mode === 'lan' ? (connected ? 'LAN: Connected' : `LAN: ${label}`) : label;
  $('#connection-label').title = multiplayer.serverUrl || location.origin;
  updateMapWarp(
    player(),
    (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt,
    connected,
  );
}
/** Waits with the usual backoff, then reconnects automatically. */
function scheduleReconnect() {
  clearTimeout(retry);
  retry = setTimeout(() => connect(true), Math.min(60000, 2500 * 2 ** Math.min(retryCount++, 5)));
}
/**
 * `automatic` marks a reconnect after a dropped connection: the last known world stays on
 * screen, and a server that is briefly unreachable (restart, rebuild) keeps the backoff going
 * instead of sending the player back to the setup screen.
 */
async function connect(automatic = false) {
  gamepadControls?.suspend();
  const attempt = ++connectAttempt;
  clearTimeout(retry);
  manualLeave = false;
  keys.clear();
  blockedMovementKeys.clear();
  movementCommands.reset();
  lastGait = null;
  connection(false, automatic ? '再接続中…' : '接続中…');
  if (!automatic) {
    selfId = null;
    state = {
      players: [],
      resources: INITIAL_RESOURCES,
      camp: { ...CAMP },
      npc: { ...NPC },
      day: 1,
    };
    renderer.setState(state, selfId);
    updateHUD();
  }
  try {
    localRoomReset = false;
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
      localRoomReset = status.localRoomReset === true && !multiplayer.serverUrl;
      if (!status.ok) throw new Error(status.text || '現在ゲームは停止中です。');
      if (status.room && profile.room !== status.room) {
        profile.room = status.room;
        notify('無料公開版では EMBER の谷に参加します。');
      }
    }
  } catch (error) {
    if (attempt !== connectAttempt || manualLeave) return;
    // Our own Error messages describe a stopped service; anything else is a failed request.
    const stopped = error.name === 'Error';
    if (automatic && !stopped) {
      scheduleReconnect();
      return;
    }
    manualLeave = true;
    connection(false, 'サービス停止中');
    showSetup(stopped ? error.message : '通信できません。時間をおいて再接続してください。');
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
      persistentSession = message.persistentSession === true;
      resumeStored = saveSession(sessionKey(profile.room), message.session, persistentSession);
      if (persistentSession && !resumeStored)
        notify(
          'このブラウザーに再開情報を保存できません。閉じると同じ人物へ戻れない場合があります。',
          'error',
        );
      for (const [key, value] of Object.entries(profile)) save(`cro-${key}`, value);
      $('#profile-name').textContent = profile.name;
      $('#room-label').textContent = profile.room;
      connection(true, 'オンライン');
      renderer.focusPlayer();
      if (message.resumed) notify('接続が戻りました。持ち物と進行を復元しました。', 'success');
    }
    if (message.type === 'roomReset') {
      restartAfterRoomReset();
      return;
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
      const warped = previous && (previous.warpSequence ?? 0) !== (player()?.warpSequence ?? 0);
      const changedCharacter =
        previous && player() && characterModel(previous).key !== characterModel(player()).key;
      if (changedCharacter) {
        profile = { ...profile, species: player().species, gender: player().gender };
        save('cro-species', profile.species);
        save('cro-gender', profile.gender);
        stopInput();
        if ($('#character-switch-form')) $('#modal').close();
      }
      if (warped) {
        stopInput();
        if ($('#big-map')) $('#modal').close();
      }
      renderer.setState(state, selfId);
      updateCharacterSwitch(player(), renderer.serverNow(), joined);
      if ($('#big-map'))
        updateMapWarp(
          player(),
          (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt,
          joined,
        );
      updateHUD();
    }
    if (message.type === 'saveStatus' && message.enabled === true) {
      const previous = localSaveStatus;
      localSaveStatus = message;
      updateSaveStatus();
      if (message.state === 'error' && previous?.state !== 'error')
        notify('自動保存に失敗しています。最後に成功した保存は残っています。', 'error');
      if (message.recovered && !previous?.recovered)
        notify('予備の保存から再開しました。直前の進行の一部は戻っていない場合があります。');
    }
    if (message.type === 'emote') renderer.setEmote(message.id, message.emote);
    if (message.type === 'notice') {
      if (message.popup !== false) notify(message.text, message.tone);
      if (message.tone === 'success') playNote();
    }
    if (message.type === 'chat') {
      addChat(message);
      if (message.mapPin) notify(`${message.name}：${message.text}`);
    }
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
    if (!manualLeave) scheduleReconnect();
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
      .filter((r) => r.amount > 0 && me.inventory[r.type] < 99 && renderer.resourceVisible?.(r.id))
      .map((r) => ({
        ...r,
        action: 'gather',
        targetId: r.id,
        label:
          r.type === 'obsidian'
            ? '黒曜石を採掘する'
            : `${{ wood: '木材', stone: '石', berry: 'ベリー' }[r.type]}を採集する`,
        range: GATHER_RANGE,
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
  const me = player();
  $('#online-count').textContent =
    `${state.players.length}/${state.playerLimit ?? WORLD.maxPlayers}`;
  $('#day-label').textContent = `${state.day || 1}日目`;
  const energy = Math.round(me?.energy ?? 100);
  $('#energy-label').textContent = `${energy} / 100`;
  $('#energy-bar').style.width = `${energy}%`;
  $('#energy-track').dataset.level = energy <= 25 ? 'critical' : energy <= 50 ? 'low' : 'ok';
  updateObjectives();
  const target = nearby();
  $('#interaction-hint').hidden = !target;
  $('#interaction-hint span').textContent = target?.label ?? '';
  $('#my-portrait').className = `portrait ${profile.species} ${characterModel(profile).key}`;
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
/** The starter objectives live in the pause menu, not on the HUD. */
function questStatus() {
  const me = player(),
    gathered = me?.gathered ?? 0;
  const quests: [string, boolean][] = [
    ['gather', gathered >= 3],
    ['craft', !!me?.tool],
    ['camp', state.camp.level > 0],
  ];
  return { gathered, quests, done: quests.filter(([, complete]) => complete).length };
}
function objectivesMarkup() {
  return `<div class="objectives"><h2>目標</h2><p class="modal-intro">はじめての火を育てる · <span id="quest-count">0 / 3</span></p><div class="quest-list" id="quest-list"><div class="quest" id="quest-gather"><span class="quest-check">1</span><div><strong>森の恵みを集める</strong><p>木や石、ベリーを3つ採集</p><div class="progress-track"><span id="gather-progress"></span></div></div></div><div class="quest" id="quest-craft"><span class="quest-check">2</span><div><strong>はじめての道具</strong><p>木材3・石2で石斧をつくる</p></div></div><div class="quest" id="quest-camp"><span class="quest-check">3</span><div><strong>みんなの火を育てる</strong><p>拠点に木材12・石6を届ける</p></div></div></div><div class="camp-row"><span class="camp-icon">${icon('flame')}</span><div><strong id="camp-name">小さな野営地</strong><small id="camp-level">CAMP LEVEL 0</small></div><div class="camp-stats"><span>${icon('wood')} <b id="camp-wood">0</b><em>/ 12</em></span><span>${icon('stone')} <b id="camp-stone">0</b><em>/ 6</em></span></div></div></div>`;
}
function updateObjectives() {
  if (!$('#quest-list')) return;
  const { gathered, quests, done } = questStatus();
  $('#gather-progress').style.width = `${Math.min(gathered / 3, 1) * 100}%`;
  for (const [id, complete] of quests) $(`#quest-${id}`).classList.toggle('done', complete);
  $('#quest-count').textContent = `${done} / 3`;
  $('#camp-wood').textContent = state.camp.wood;
  $('#camp-stone').textContent = state.camp.stone;
  $('#camp-level').textContent = `CAMP LEVEL ${state.camp.level}`;
  $('#camp-name').textContent = state.camp.level ? 'みんなの野営地' : '小さな野営地';
}
/** True while the player cannot act from a menu: not joined, downed, mounted, or mid-task. */
function modalActionsBlocked() {
  const me = player();
  return (
    !joined ||
    renderUnavailable ||
    !me ||
    !!me.downedUntil ||
    !!me.mountId ||
    !!me.boatId ||
    !!me.cookingEndsAt ||
    !!me.fishing ||
    !!me.coastalActivity ||
    carrying(me) ||
    (me.attackSequence > 0 && renderer.serverNow() - me.attackAt < attackProfile(me).durationMs)
  );
}
function updateModalHUD() {
  const me = player(),
    inv = inventoryCounts(me?.inventory);
  const unavailable = modalActionsBlocked();
  updateInventory();
  if ($('#modal-fishing-kit'))
    $('#modal-fishing-kit').disabled =
      unavailable || !!me?.gulf?.fishingKit || inv.wood < 3 || inv.stone < 1;
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
        row.innerHTML = `<span class="portrait ${normalizeCharacter(p).species} ${characterModel(p).key}"><i></i></span><div><strong></strong><small>${characterModel(p).name}</small></div><span class="member-status"><i class="status-dot"></i> ${p.id === selfId ? 'あなた' : 'オンライン'}</span>`;
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
  if (player()?.boatId && !['boardBoat', 'fish', 'cancelFishing'].includes(type)) return;
  if (player()?.mountId && type !== 'ride') return;
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
function carryTarget() {
  const me = player();
  if (!me || me.species !== 'ape') return null;
  const now = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  return (
    state.players
      .filter((p) => canCarry(me, p, renderer.collision, now))
      .sort((a, b) => distance(me, a) - distance(me, b))[0] ?? null
  );
}
function hasCarryChoice() {
  const me = player();
  return carrying(me) || !!me?.carryOfferFromId || !!me?.carryOfferToId || !!carryTarget();
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
  if (hasCarryChoice()) return action('carry', me?.carryOfferFromId || carryTarget()?.id);
  if (me?.boatId) return;
  if (me?.mountId) return action('ride');
  const now = (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt;
  if (!canMount(me, animal, renderer.collision, now)) return;
  action('ride', animal.id);
}
function interactAnimal(id) {
  const animal = [
      ...(state.animals || []),
      ...(state.enemies || []).filter((item) => item.hostile === true),
    ].find((item) => item.id === id),
    me = player();
  if (!animal || !me) return;
  if (animal.riderId) return;
  if (me.mountId || me.downedUntil || renderUnavailable) return;
  selectedAnimalId = id;
  updateHuntingHUD();
  if (animal.phase === 'alive') {
    if (attackReady(me, animal)) action('attack', id);
  } else if (animal.phase === 'meat') {
    if (distance(me, animal) <= HUNTING.harvestRange) action('harvest', id);
  }
}
function updateHuntingHUD() {
  boatUI.update();
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
  $('.hotbar-wrap').classList.toggle('riding', mounted || carrying(me));
  $('.hotbar-wrap').classList.toggle(
    'shoulder-magic',
    !!me?.carrierId && attackProfile(me).key === 'magic',
  );
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
  const carryChoice = joined && !renderUnavailable && hasCarryChoice();
  if (carryChoice) {
    const partnerId = me.carryOfferFromId || me.carryOfferToId || me.carrierId || me.passengerId;
    const partner = partnerId ? state.players.find((p) => p.id === partnerId) : carryTarget();
    const partnerName = partner?.name ?? '相手';
    $('.riding-controls').hidden = false;
    rideButton.disabled = false;
    rideButton.classList.toggle('mounted', carrying(me));
    rideButton.querySelector('span').textContent = me.carrierId
      ? '肩から降りる'
      : me.passengerId
        ? `${partnerName}を降ろす`
        : me.carryOfferFromId
          ? '肩に乗る'
          : me.carryOfferToId
            ? '誘いを取り消す'
            : `${partnerName}を担ぐ`;
    $('#riding-hint').textContent = me.carrierId
      ? `${partnerName}が移動します · R／×で降りる`
      : me.passengerId
        ? '歩行・走行できます · R／△で降ろす'
        : me.carryOfferFromId
          ? `${partnerName}からの誘い · R／△で肩に乗る`
          : me.carryOfferToId
            ? '相手の返事を待っています · 動くと取消'
            : '相手が「肩に乗る」を押すと担ぎます';
  }
  $('#carry-decline').hidden = !me?.carryOfferFromId;
  Object.assign($('#world').dataset, {
    carrierId: me?.carrierId ?? '',
    passengerId: me?.passengerId ?? '',
  });
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
  const attackAvailable = joined && !renderUnavailable && canStartAttack(me, serverNow);
  const combat = attackProfile(me ?? profile);
  const cooldownLeft =
    me?.attackSequence > 0 ? Math.max(0, combat.cooldownMs - (serverNow - me.attackAt)) : 0;
  const metered = combat.key === 'magic' && cooldownLeft > 0;
  $('#magic-cooldown').hidden = !joined || downed || !metered;
  $('#magic-cooldown').textContent = metered ? `魔法 あと${Math.ceil(cooldownLeft / 1000)}秒` : '';
  const canCook =
    !modalActionsBlocked() &&
    inv.rawMeat > 0 &&
    inv.cookedMeat < HUNTING.inventoryLimit &&
    !!usableCookingFire(state, me, renderer.collision);
  $('#cook-button').hidden = !canCook;
  $('#cook-button').disabled = !canCook;
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
    attackCooldownLeft: String(cooldownLeft),
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
    name: fixedIdentity ? profile.name : String(data.get('name')).trim() || '旅人',
    room: fixedIdentity ? profile.room : String(data.get('room')).toUpperCase(),
    ...parseCharacterValue(data.get('character')),
    difficulty: normalizeDifficulty(data.get('difficulty')),
  };
  saveSession(sessionKey(profile.room), null);
  for (const [k, v] of Object.entries(profile)) save(`cro-${k}`, v);
  history.replaceState({}, '', `?room=${encodeURIComponent(profile.room)}`);
  $('#profile-name').textContent = profile.name;
}
function showTitle() {
  $('#modal').close();
  screens.show('title');
}
function showSetup(error = '') {
  $('#modal').close();
  $('#retry-session')?.remove();
  const form = $('#setup-form');
  form.name.value = profile.name;
  form.room.value = profile.room;
  bindCharacterSelection(form, profile);
  bindDifficultySelection(form);
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error;
  $('#setup-back').textContent = joined ? '探索に戻る' : '戻る';
  screens.show('setup');
}
function enterGame() {
  $('#retry-session')?.remove();
  screens.hide();
  document.body.classList.add('in-game');
  areaBanner.reset();
  connect();
}
function leaveToTitle() {
  manualLeave = true;
  clearTimeout(retry);
  send({ type: 'leave', ...(persistentSession ? { keepSession: true } : {}) });
  if (!persistentSession) saveSession(sessionKey(profile.room), null);
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
/**
 * Bag items in display order. Food comes first so the top-left card, which is
 * focused as soon as the menu opens, is a healing item (2026-09-12).
 */
const INVENTORY_ITEMS: readonly [string, string, string][] = [
  ['berry', 'ベリー', 'HP +25'],
  ['rawMeat', '生肉', `HP +${HUNTING.rawMeatEnergy}`],
  ['cookedMeat', '焼き肉', `HP +${HUNTING.cookedMeatEnergy}`],
  ['cookedFish', '焼き魚', 'HP +30'],
  ['rawFish', '生魚', ''],
  ['cookedShellfish', '焼いた貝', 'HP +20'],
  ['rawShellfish', '生の貝', ''],
  ['cookedRoot', '焼き根', 'HP +35'],
  ['herbRoot', '香草焼き根', 'HP +50'],
  ['rawRoot', '火根', ''],
  ['herb', '香草', ''],
  ['stone', '石', ''],
  ['wood', '木材', ''],
  ['obsidian', '黒曜石', ''],
  ['seed', 'ベリーの種', ''],
  ['water', '水袋', ''],
  ['shells', '貝殻', ''],
  ['obsidianBlade', '黒曜石の刃', ''],
  ['rootSeed', '火根草の種', ''],
  ['herbSeed', '香り草の種', ''],
];
interface ItemUse {
  label: string;
  action: string;
  eats?: boolean;
  cooks?: boolean;
  output?: string;
}
const eatUse = (action: string): ItemUse => ({ label: '使う（食べる）', action, eats: true });
const ITEM_USES: Record<string, ItemUse[]> = {
  berry: [eatUse('eat')],
  rawMeat: [
    eatUse('eatRawMeat'),
    { label: '肉を焼く', action: 'cook', cooks: true, output: 'cookedMeat' },
  ],
  cookedMeat: [eatUse('eatMeat')],
  cookedFish: [eatUse('eatFish')],
  cookedShellfish: [eatUse('eatShellfish')],
  cookedRoot: [eatUse('eatRoot')],
  herbRoot: [eatUse('eatHerbRoot')],
  rawFish: [{ label: '魚を焼く', action: 'cookFish', cooks: true, output: 'cookedFish' }],
  rawShellfish: [
    { label: '貝を焼く', action: 'cookShellfish', cooks: true, output: 'cookedShellfish' },
  ],
};
const itemIcon = (key: string) =>
  key.endsWith('Meat')
    ? 'meat'
    : key.endsWith('Fish')
      ? 'wave'
      : key.toLowerCase().includes('shell')
        ? 'shell'
        : key === 'obsidianBlade'
          ? 'blade'
          : key === 'obsidian'
            ? 'stone'
            : key;
function inventoryEntries() {
  const me = player(),
    inv = inventoryCounts(me?.inventory);
  const items = INVENTORY_ITEMS.filter(([key]) => inv[key] > 0).map(([key, label, note]) => ({
    key,
    label,
    note,
    count: inv[key],
    glyph: itemIcon(key),
  }));
  const weapon = attackProfile(me ?? profile);
  if (me && weapon.modelKey)
    items.push({ key: 'weapon', label: weapon.noun, note: '装備中', count: 1, glyph: weapon.key });
  if (me?.tool) items.push({ key: 'axe', label: '石斧', note: '装備中', count: 1, glyph: 'axe' });
  if (me?.gulf?.fishingKit)
    items.push({ key: 'fishingKit', label: '釣り道具', note: '', count: 1, glyph: 'wave' });
  return items;
}
function inventoryMarkup() {
  const model = characterModel(player() ?? profile);
  return `<header class="inventory-header"><span class="portrait ${model.species} ${model.key}" role="img" aria-label="${model.name}"><i></i></span><div class="inventory-status"><h2>持ち物</h2><div id="inventory-energy-track" class="energy-track" role="progressbar" aria-label="体力" aria-valuemin="0" aria-valuemax="100"><span id="inventory-energy-bar" class="energy-fill"></span><em class="energy-label">${icon('leaf')}<b>体力</b><span id="inventory-energy-label"></span></em></div></div></header><div class="inventory-grid" aria-label="所持品"></div>`;
}
function itemChoices(key: string) {
  const me = player();
  if (!(me?.inventory?.[key] > 0)) return [];
  return (ITEM_USES[key] ?? []).filter(
    (use) => !use.cooks || !!usableCookingFire(state, me, renderer.collision),
  );
}
function itemUseReason(key: string, use: ItemUse) {
  const me = player();
  if (!(me?.inventory?.[key] > 0)) return '持っていません。';
  if (modalActionsBlocked()) return '今は使えません。';
  if (use.eats && me.energy >= 100) return '体力は満タンです。';
  if (use.cooks && !usableCookingFire(state, me, renderer.collision)) return '焚き火の範囲外です。';
  if (use.output && me.inventory[use.output] >= HUNTING.inventoryLimit)
    return '持ち物がいっぱいです。';
  if (key === 'cookedShellfish' && me.inventory.shells >= HUNTING.inventoryLimit)
    return '貝殻の持ち物がいっぱいです。';
  return '';
}
function updateInventory() {
  const grid = document.querySelector<HTMLElement>('.inventory-grid');
  if (!grid) return;
  const energy = Math.round(player()?.energy ?? 100);
  $('#inventory-energy-label').textContent = `${energy} / 100`;
  $('#inventory-energy-bar').style.width = `${energy}%`;
  $('#inventory-energy-track').dataset.level =
    energy <= 25 ? 'critical' : energy <= 50 ? 'low' : 'ok';
  $('#inventory-energy-track').setAttribute('aria-valuenow', String(energy));
  const entries = inventoryEntries(),
    signature = JSON.stringify(entries);
  if (grid.dataset.signature !== signature) {
    const active = document.activeElement as HTMLElement;
    const selected = active?.closest<HTMLElement>('.inventory-card'),
      key = selected?.dataset.item;
    const previousIndex = [...grid.children].indexOf(selected!);
    const restore = grid.contains(active);
    const popupKey = grid.querySelector('.item-actions')?.closest<HTMLElement>('.inventory-card')
      ?.dataset.item;
    grid.dataset.signature = signature;
    grid.innerHTML = entries.length
      ? entries
          .map(
            ({ key, label, note, count, glyph }) =>
              `<div class="inventory-card${ITEM_USES[key] ? ' inventory-usable' : ''}" data-item="${key}" tabindex="0" ${ITEM_USES[key] ? 'role="button"' : ''} aria-label="${label} ${count}個"><span class="resource-icon ${key}">${icon(glyph)}</span><strong>${label}<b data-modal-count="${key}">${count}</b></strong>${note ? `<p>${note}</p>` : ''}</div>`,
          )
          .join('')
      : '<p class="inventory-none" tabindex="0">持ち物はありません。</p>';
    bindInventory();
    if (restore) {
      const next =
        grid.querySelector<HTMLElement>(`[data-item="${key}"]`) ??
        (grid.children[
          Math.min(Math.max(0, previousIndex), grid.children.length - 1)
        ] as HTMLElement);
      next?.focus({ preventScroll: true });
      if (popupKey && popupKey === next?.dataset.item) openItemActions(next);
    }
  }
  const popup = grid.querySelector<HTMLElement>('.item-actions');
  if (popup) {
    const card = popup.closest<HTMLElement>('.inventory-card')!;
    if (popup.dataset.signature !== itemActionsSignature(card.dataset.item!)) openItemActions(card);
  }
}
function closeItemActions(): boolean {
  const popup = document.querySelector<HTMLElement>('.item-actions');
  if (!popup) return false;
  const card = popup.closest<HTMLElement>('.inventory-card');
  popup.remove();
  card?.focus({ preventScroll: true });
  gamepadControls?.suspend();
  return true;
}
function itemActionsSignature(key: string) {
  return JSON.stringify(itemChoices(key).map((use) => [use.action, itemUseReason(key, use)]));
}
function openItemActions(card: HTMLElement) {
  const oldAction = card.querySelector('.item-actions')?.contains(document.activeElement)
    ? (document.activeElement as HTMLElement).dataset.itemAction
    : undefined;
  closeItemActions();
  const key = card.dataset.item!,
    choices = itemChoices(key);
  if (!ITEM_USES[key]) return;
  card.insertAdjacentHTML(
    'beforeend',
    `<div class="item-actions" role="dialog" aria-modal="true" aria-label="${card.querySelector('strong')?.firstChild?.textContent ?? ''}" data-focus-scope>${choices
      .map((use) => {
        const reason = itemUseReason(key, use);
        return `<button type="button" class="button button-accent item-use" data-item-action="${use.action}" ${reason ? 'disabled' : ''}>${use.label}</button>${reason ? `<small>${reason}</small>` : ''}`;
      })
      .join(
        '',
      )}<button type="button" class="button button-outline item-actions-close">閉じる</button></div>`,
  );
  const popup = card.querySelector<HTMLElement>('.item-actions')!;
  popup.dataset.signature = itemActionsSignature(key);
  popup.onclick = (event) => event.stopPropagation();
  for (const button of popup.querySelectorAll<HTMLButtonElement>('[data-item-action]')) {
    button.onclick = () => {
      const use = choices.find((choice) => choice.action === button.dataset.itemAction)!;
      if (itemUseReason(key, use)) {
        openItemActions(card);
        return;
      }
      closeItemActions();
      if (use.cooks) $('#modal').close();
      action(use.action);
    };
  }
  popup.querySelector<HTMLButtonElement>('.item-actions-close')!.onclick = () => closeItemActions();
  const preferred = oldAction
    ? popup.querySelector<HTMLButtonElement>(`[data-item-action="${oldAction}"]:not(:disabled)`)
    : null;
  (preferred ?? popup.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus({
    preventScroll: true,
  });
  gamepadControls?.suspend();
}
function bindInventory() {
  for (const card of document.querySelectorAll<HTMLElement>('.inventory-card.inventory-usable')) {
    card.onclick = () => openItemActions(card);
    card.onkeydown = (event) => {
      if (event.target !== card) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openItemActions(card);
      }
    };
  }
}
function craftingMarkup() {
  const me = player();
  return `<h2>クラフト・ガイド</h2><p class="modal-intro">生肉はそのままでHP+15。焚き火で3秒焼くと、焼き肉（HP+45）になります。</p><div class="gulf-actions"><button id="modal-crop-food" class="button button-outline">火根と香草の食事</button><button id="modal-crop-farms" class="button button-outline">共同の畑と種</button></div><div class="recipe"><span class="resource-icon stone">${icon('axe')}</span><div><strong id="modal-axe-label">${me?.tool ? '石斧を装備中' : '石斧をつくる'}</strong><p>木材3 + 石2 ・ 採集量が増えます</p></div><button id="modal-craft" class="button button-accent" ${me?.tool ? 'disabled' : ''}>${me?.tool ? '装備中' : 'つくる'}</button></div><div class="recipe"><span class="resource-icon wood">${icon('wood')}</span><div><strong>丸木舟をつくる</strong><p>木材12 · 海岸で制作 · Bで乗船</p></div><button id="modal-boat-craft" class="button button-accent">船をつくる</button></div><p class="form-note">今の武器：${attackProfile(me ?? profile).noun}。人間系は木槍で出発し、黒曜石の刃で強化できます。相手を向いて F。</p><div class="recipe"><div><strong>湾の釣り道具</strong><p>木材3・石1 · 繰り返し使えます</p></div><button id="modal-fishing-kit" class="button button-accent">道具を作る</button><button id="modal-fishing" class="button button-outline">魚場と釣り方</button></div><div class="recipe coastal-recipe"><div><strong>貝の食事と黒曜石の道具</strong><p>貝殻を持ち帰って貝塚へ。原石を削って木槍の先へ。</p></div><button id="modal-coastal" class="button button-outline">貝と石器の作り方</button></div>`;
}
function bindCrafting() {
  $('#modal-craft').onclick = () => {
    action('craft');
    $('#modal').close();
  };
  $('#modal-fishing-kit').onclick = () => action('craftFishingKit');
  $('#modal-fishing').onclick = () => fishingUI.open();
  $('#modal-coastal').onclick = () => coastalUI.open();
  $('#modal-crop-food').onclick = () => cropFoodUI.open();
  $('#modal-crop-farms').onclick = () => gulfUI.open();
  $('#modal-boat-craft').onclick = () => {
    action('craftBoat');
    $('#modal').close();
  };
}
/** The bag is the pause menu's first page, so every shortcut lands on the same screen. */
function openInventory() {
  openPauseMenu('inventory');
}
function tribeMarkup() {
  return `<h2>同じ火を囲む仲間。</h2><p class="modal-intro" id="tribe-summary">いま、この谷で暮らしている ${state.players.length} 人。</p><div id="tribe-list" class="tribe-list"></div><button id="tribe-invite" class="button button-accent wide">${icon('plus')} 仲間を招待する</button><p class="form-note">NPCのオルは参加人数に含まれません。ひとりでも採集や拠点づくりを楽しめます。</p>`;
}
function openTribe() {
  openModal(tribeMarkup());
  updateModalHUD();
  $('#tribe-invite').onclick = openInvite;
}
function openJournal() {
  adventureUI.open();
}
/** The PC / controller card tabs, with the enemy card once the sorcerer exists. */
function helpMarkup() {
  const extra = state.enemies?.length
    ? [
        {
          key: '大城の赤い印',
          title: '白羽教団',
          note: '始まりの谷の東南、白羽教団の大聖城には教皇1体、空を飛ぶ司祭長3体、呪術師6体、破砕兵6体、城兵12体が集結しています。教皇と司祭長は武器と赤い魔法の両方を使います。力尽きても4秒後に焚き火で回復し、持ち物は残ります。',
        },
      ]
    : [];
  return helpTabsMarkup(usingGamepad ? 'pad' : 'pc', extra);
}
function openHelp() {
  openModal(
    `<div class="help-dialog"><h2>あそびかた</h2>${helpMarkup()}<button id="help-start" class="button button-accent wide">${joined ? '探索に戻る' : '閉じる'} ${icon('arrow')}</button></div>`,
  );
  bindHelpTabs($('#modal-body'));
  $('#help-start').onclick = () => $('#modal').close();
}
function updateGamepadHints(active: boolean) {
  usingGamepad = active;
  for (const [selector, label] of [
    ['#interaction-hint kbd', active ? '○' : 'E'],
    ['#ride-button kbd', active ? '×' : 'R'],
    ['#boat-board kbd', active ? '×' : 'B'],
    ['#chat-toggle kbd', active ? '⌨' : 'Enter'],
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
    boat: !carrying(me) && (!$('#boat-board').disabled || !!me?.boatId),
    carry: hasCarryChoice(),
    carrying: carrying(me),
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
  else if (player()?.mountId || hasCarryChoice()) ride();
  else if (!$('#boat-board').disabled) action('boardBoat');
  else ride();
}

let persistentSession = false,
  resumeStored = true;
let localSaveStatus: { state: string; savedAt?: number; recovered?: boolean } | null = null;
function updateSaveStatus() {
  const element = $('#local-save-status');
  if (!element) return;
  element.hidden = !persistentSession;
  element.textContent = !resumeStored
    ? 'このブラウザーには再開情報を保存できていません。'
    : localSaveStatus?.state === 'error'
      ? '自動保存に失敗しています。最後に成功した保存は保持しています。'
      : localSaveStatus?.savedAt
        ? `自動保存済み ${new Date(localSaveStatus.savedAt).toLocaleTimeString()} · タイトルへ戻っても続きから再開できます。${localSaveStatus.recovered ? ' 予備の保存から復元しました。' : ''}`
        : '自動保存を準備しています。';
}
let pauseSubTab = 'help';
function difficultySettingsMarkup() {
  const selected = normalizeDifficulty(profile.difficulty);
  return `<div class="settings-item difficulty-setting"><div><strong>難易度</strong><p>自分の被ダメージと、自分を狙う敵の追跡・突進・飛びかかり速度を調整します。</p></div><div class="settings-buttons" role="group" aria-label="難易度">${DIFFICULTY_LEVELS.map((id) => `<button type="button" class="button button-outline" data-difficulty="${id}" aria-pressed="${selected === id}" title="${DIFFICULTIES[id].description}">${DIFFICULTIES[id].label}</button>`).join('')}</div></div>`;
}

function setDifficulty(difficulty: Difficulty) {
  profile.difficulty = normalizeDifficulty(difficulty);
  save('cro-difficulty', profile.difficulty);
  send({ type: 'difficulty', difficulty: profile.difficulty });
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-difficulty]'))
    button.setAttribute('aria-pressed', String(button.dataset.difficulty === profile.difficulty));
  notify(`難易度を「${DIFFICULTIES[profile.difficulty].label}」に変更しました。`, 'success');
}
function openCharacterSwitchMenu() {
  openCharacterSwitch({
    openModal,
    player,
    now: () => renderer.serverNow(),
    connected: () => joined,
    action,
    settle: () => gamepadControls?.suspend(),
  });
}
/**
 * Game-style pause menu: a tab rail on the left, one panel on the right, exits as
 * buttons below the tabs. 2026-09-12: it opens straight on the bag with the first
 * food card focused; the guide, world and companions share one tab with sub-tabs;
 * the character change sits just above "back to exploring".
 */
function localResetMarkup() {
  return localRoomReset
    ? '<div class="settings-item local-reset-setting"><div><strong>部屋の進行をリセット</strong><p>この部屋を最初からやり直します。</p></div><button type="button" class="button button-outline" data-setting="reset-room">リセット</button></div>'
    : '';
}

function restartAfterRoomReset() {
  roomResetVersion++;
  stopInput();
  saveSession(sessionKey(profile.room), null);
  const previous = socket;
  socket = null;
  previous?.close();
  $('#modal').close();
  $('#chat-messages').replaceChildren();
  selectedAnimalId = null;
  enterGame();
  notify('部屋の進行をリセットしました。', 'success');
}

function openRoomReset() {
  if (!localRoomReset || !joined) return;
  openModal(
    '<section id="local-reset-confirm"><h2>部屋の進行をリセットしますか？</h2><p class="modal-intro">この部屋の全員の持ち物・探索・野営地の進行を消して、最初からやり直します。</p><p id="local-reset-error" role="status" class="form-note"></p><div class="gulf-actions"><button id="local-reset-cancel" type="button" class="button button-outline">やめる</button><button id="local-reset-accept" type="button" class="button button-accent">リセットする</button></div></section>',
  );
  $('#local-reset-cancel').onclick = () => openPauseMenu('settings');
  $('#local-reset-cancel').focus();
  $('#local-reset-accept').onclick = async () => {
    const version = roomResetVersion;
    const button = $('#local-reset-accept');
    button.disabled = true;
    button.textContent = 'リセット中…';
    try {
      const response = await fetch('/api/reset-room', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          room: profile.room,
          session: savedSession(sessionKey(profile.room)),
        }),
      });
      if (!response.ok)
        throw new Error(
          'リセットできませんでした。接続と保存状態を確認して、もう一度お試しください。',
        );
      if (version === roomResetVersion) restartAfterRoomReset();
    } catch {
      if (version !== roomResetVersion || !$('#local-reset-error')) return;
      $('#local-reset-error').textContent =
        'リセットできませんでした。接続と保存状態を確認して、もう一度お試しください。';
      button.disabled = false;
      button.textContent = 'リセットする';
      button.focus();
    }
  };
}

function cancelRoomReset() {
  if (!$('#local-reset-confirm')) return false;
  openPauseMenu('settings');
  return true;
}

function openPauseMenu(tab = 'inventory') {
  if (screens.active) return;
  const tabs: [string, string, string][] = [
    ['inventory', 'bag', '持ち物'],
    ['crafting', 'axe', 'クラフト・ガイド'],
    ['info', 'compass', '世界・仲間・操作説明'],
    ['settings', 'sound', '設定'],
  ];
  const subTabs: [string, string][] = [
    ['help', '操作説明'],
    ['world', '世界'],
    ['tribe', '仲間'],
    ['objectives', '目標'],
  ];
  const links: [string, string, string, () => void][] = [
    ['map', 'expand', '世界地図', openMap],
    ['journal', 'book', '探索手帳', openJournal],
    ['gulf', 'wave', '三つの国・共同の畑', () => gulfUI.open()],
    ['fishing', 'wave', '魚場と釣り方', () => fishingUI.open()],
    ['coastal', 'stone', '貝塚・黒曜石の道具', () => coastalUI.open()],
    ['residents', 'wave', '集落の人びと・今日の手伝い', () => villageUI.open()],
    ['ride', 'target', '船・マンモス・肩に乗る／降りる', controllerRide],
    ['wave', 'wave', '手をふる', () => action('wave')],
  ];
  const exits: [string, string, string, () => void][] = [
    ['character', 'people', 'キャラクターを変える', openCharacterSwitchMenu],
    ['resume', 'compass', '探索に戻る', () => $('#modal').close()],
    ...(!fixedIdentity
      ? [
          ['profile', 'people', '部屋を変える（参加し直す）', () => showSetup()] as [
            string,
            string,
            string,
            () => void,
          ],
        ]
      : []),
    ['title', 'close', 'タイトルへ戻る', leaveToTitle],
  ];
  let pauseTab = tabs.some(([id]) => id === tab) ? tab : 'inventory';
  if (!subTabs.some(([id]) => id === pauseSubTab)) pauseSubTab = 'help';
  const menuButton = ([id, glyph, label]: readonly [string, string, string, ...unknown[]]) =>
    `<button class="button button-outline" data-controller-menu="${id}">${icon(glyph)}<span>${label}</span></button>`;
  const panel = (id: string, body: string) =>
    `<section class="pause-panel" data-pause-panel="${id}" role="tabpanel" id="pause-panel-${id}" ${pauseTab === id ? '' : 'hidden'}>${body}</section>`;
  const subPanel = (id: string, body: string) =>
    `<section class="pause-subpanel" data-pause-subpanel="${id}" role="tabpanel" id="pause-subpanel-${id}" ${pauseSubTab === id ? '' : 'hidden'}>${body}</section>`;
  openModal(
    `<div class="pause-menu"><aside class="pause-rail"><nav class="pause-tabs" role="tablist" aria-label="メニューの項目">${tabs
      .map(
        ([id, glyph, label]) =>
          `<button type="button" class="pause-tab" role="tab" data-pause-tab="${id}" data-controller-menu="${id}" aria-selected="${pauseTab === id}" aria-controls="pause-panel-${id}">${icon(glyph)}<span>${label}</span></button>`,
      )
      .join(
        '',
      )}</nav><div class="pause-exits">${exits.map(menuButton).join('')}</div></aside><div class="pause-panels">${panel(
      'inventory',
      inventoryMarkup(),
    )}${panel('crafting', craftingMarkup())}${panel(
      'info',
      `<div class="help-tabs sub-tabs" role="tablist" aria-label="世界・仲間・操作説明の切り替え">${subTabs
        .map(
          ([id, label]) =>
            `<button type="button" class="help-tab sub-tab" role="tab" data-pause-subtab="${id}" data-controller-menu="sub-${id}" aria-selected="${pauseSubTab === id}" aria-controls="pause-subpanel-${id}">${label}</button>`,
        )
        .join('')}</div>${subPanel('help', `<h2>操作説明</h2>${helpMarkup()}`)}${subPanel(
        'world',
        `<h2>世界</h2><p class="modal-intro">地図・記録・各地の暮らしと、いまできる行動。</p><div class="controller-menu">${links.map(menuButton).join('')}</div>`,
      )}${subPanel('tribe', tribeMarkup())}${subPanel('objectives', objectivesMarkup())}`,
    )}${panel(
      'settings',
      `<h2>設定</h2><p class="modal-intro">難易度・音・画面・視点の調整。</p><div class="settings-list">${difficultySettingsMarkup()}<div class="settings-item"><div><strong>環境音</strong><p>谷の音を鳴らします。</p></div><button class="button button-outline" data-setting="sound" aria-pressed="${soundEnabled}">${icon(soundEnabled ? 'sound' : 'muted')} ${soundEnabled ? 'オン' : 'オフ'}</button></div><div class="settings-item"><div><strong>全画面表示</strong><p>ブラウザーの枠を隠して表示します。</p></div><button class="button button-outline" data-setting="fullscreen">${icon('expand')} 切り替え</button></div><div class="settings-item"><div><strong>視点</strong><p>カメラの距離を変え、キャラクターの後ろへ戻します。</p></div><div class="settings-buttons"><button class="button button-outline" data-setting="zoom-out">− 遠く</button><button class="button button-outline" data-setting="zoom-in">+ 近く</button><button class="button button-outline" data-setting="camera">${icon('target')} 視点を戻す</button></div></div><div class="settings-item"><div><strong>コントローラー</strong><p class="gamepad-connection" role="status">${usingGamepad ? '' : '未使用 · コントローラーをつないでボタンを押すと切り替わります。'}</p></div></div></div><p id="local-save-status" class="form-note" role="status" hidden></p>${localResetMarkup()}`,
    )}<p class="pause-hint">${usingGamepad ? '十字キー・左スティックで選ぶ · ○ で決定 · ×（下のボタン）か OPTIONS で閉じる' : 'ESC で閉じる · ↑↓←→ で選ぶ · Enter で決定'}</p></div></div>`,
  );
  const root = $('#modal-body') as HTMLElement;
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('.pause-tab')];
  const showTab = (id: string) => {
    pauseTab = id;
    closeItemActions();
    for (const tab of tabButtons)
      tab.setAttribute('aria-selected', String(tab.dataset.pauseTab === id));
    for (const section of root.querySelectorAll<HTMLElement>('.pause-panel'))
      section.hidden = section.dataset.pausePanel !== id;
    root.querySelector<HTMLElement>(`[data-pause-tab="${id}"]`)?.focus({ preventScroll: true });
  };
  for (const tab of tabButtons) tab.onclick = () => showTab(tab.dataset.pauseTab!);
  const subTabButtons = [...root.querySelectorAll<HTMLButtonElement>('.sub-tab')];
  const showSubTab = (id: string) => {
    pauseSubTab = id;
    for (const tab of subTabButtons)
      tab.setAttribute('aria-selected', String(tab.dataset.pauseSubtab === id));
    for (const section of root.querySelectorAll<HTMLElement>('.pause-subpanel'))
      section.hidden = section.dataset.pauseSubpanel !== id;
  };
  for (const tab of subTabButtons) tab.onclick = () => showSubTab(tab.dataset.pauseSubtab!);
  for (const [id, , , handler] of [...links, ...exits])
    $(`[data-controller-menu="${id}"]`).onclick = () => handler();
  updateObjectives();
  bindCrafting();
  updateModalHUD();
  bindHelpTabs($('[data-pause-subpanel="help"]'));
  updateSaveStatus();
  $('#tribe-invite').onclick = openInvite;
  $('[data-setting="sound"]').onclick = toggleSound;
  $('[data-setting="fullscreen"]').onclick = toggleFullscreen;
  $('[data-setting="camera"]').onclick = () => renderer.focusPlayer();
  $('[data-setting="zoom-out"]').onclick = () => renderer.adjustZoom(-0.15);
  $('[data-setting="zoom-in"]').onclick = () => renderer.adjustZoom(0.15);
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-difficulty]'))
    button.onclick = () => setDifficulty(normalizeDifficulty(button.dataset.difficulty));
  if ($('[data-setting="reset-room"]')) $('[data-setting="reset-room"]').onclick = openRoomReset;
  // The bag opens ready to use: the first (top-left) food card holds focus.
  if (pauseTab === 'inventory')
    root
      .querySelector<HTMLElement>('.inventory-card, .inventory-none')
      ?.focus({ preventScroll: true });
}

/** Opens the world map, or closes it when it is already open (button, M, SHARE/touchpad). */
function openMap() {
  if ($('#modal').open && $('#big-map')) {
    $('#modal').close();
    mapInput = undefined;
    return;
  }
  setWorldMapSelection(null);
  openModal(mapScreen(icon));
  mapInput = installMapWarp({
    player,
    pins: () => state.mapPins ?? [],
    pinEnabled: () => Array.isArray(state.mapPins),
    send,
    action,
    icon,
    connected: () => joined,
    redraw: () => {
      const map = $('#big-map');
      if (map) drawMinimap(map, true);
    },
    now: () => (state.serverTime ?? Date.now()) + performance.now() - stateReceivedAt,
  });
}
function cook() {
  const me = player();
  if (!me || modalActionsBlocked() || !me.inventory.rawMeat) return;
  if (usableCookingFire(state, me, renderer.collision)) action('cook');
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
      button.innerHTML = `${icon(soundEnabled ? 'sound' : 'muted')} ${soundEnabled ? 'オン' : 'オフ'}`;
      button.setAttribute('aria-pressed', String(soundEnabled));
    }
  } catch {
    notify('このブラウザでは環境音を再生できません。');
  }
}

$('#status-plate').onclick = openTribe;
$('#map-button').onclick = openMap;
$('#cook-button').onclick = cook;
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
async function toggleFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else await document.documentElement.requestFullscreen();
  } catch {
    notify('この画面では全画面表示を利用できません。');
  }
}
$('#title-start').onclick = () =>
  savedSession(sessionKey(profile.room)) ? enterGame() : showSetup();
$('#title-howto').onclick = openHelp;
$('#title-fullscreen').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', () => {
  const active = !!document.fullscreenElement;
  $('#title-fullscreen').setAttribute('aria-pressed', String(active));
  $('#title-fullscreen').setAttribute('aria-label', active ? '全画面表示を終了' : '全画面表示');
});
$('#setup-back').onclick = () => (joined ? screens.hide() : showTitle());
$('#setup-form').onsubmit = (e) => {
  e.preventDefault();
  applyProfileForm(e.currentTarget);
  enterGame();
};
$('#modal-close').onclick = () => {
  if (!cancelRoomReset()) $('#modal').close();
};
$('#modal').addEventListener('cancel', (event) => {
  if (cancelRoomReset() || closeCharacterConfirm()) event.preventDefault();
});
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
  // The map key is a toggle: M with the atlas open closes it (2026-09-12).
  if (
    $('#modal').open &&
    $('#big-map') &&
    acceptsGameShortcut(e) &&
    !(e.target as Element)?.closest<HTMLElement>('input,textarea,select,[contenteditable]') &&
    movementKey(e) === 'm'
  ) {
    e.preventDefault();
    openMap();
    return;
  }
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
  // 2026-09-12: the held-Tab item bar and its run button are gone; Shift toggles walk / run.
  if (k === 'shift') {
    e.preventDefault();
    runMode = !runMode;
    return;
  }
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
    else if (screens.active === 'setup') $('#setup-back').click();
  },
  cancelMenu: () => {
    if (cancelRoomReset()) return;
    if (closeCharacterConfirm()) {
      gamepadControls?.suspend();
      return;
    }
    if (closeItemActions()) return;
    if ($('#modal').open) $('#modal').close();
    else if (screens.active === 'setup') $('#setup-back').click();
  },
  canPlay: () =>
    joined && !renderUnavailable && !screens.active && !!player() && !player()?.downedUntil,
  onStop: stopInput,
  onActivity: updateGamepadHints,
  onMapInput: (frame, dt) =>
    frame.actions.includes('map') ? openMap() : mapInput?.input(frame, dt),
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
if (query.get('autostart') === '1') {
  // QA scripts and local shortcuts skip the title and setup screens.
  enterGame();
} else showTitle();
