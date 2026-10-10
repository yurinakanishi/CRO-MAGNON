import {
  controllerLabels,
  setControllerLayout,
  setConnectedController,
} from './controller-labels.js';
import { InputCues } from './input-cues-ui.js';
import type { CueContext } from './input-cues.js';
import type { ContextEvent } from './context-recovery.js';
import { TouchControls, touchDevice, type TouchAction } from './touch-controls.js';
import { movementFromCamera } from '../shared/terrain.mjs';
import { audioSettingsMarkup } from './nature-audio-settings.js';
import { mapScreen } from './map-screen.js';
import { installMapWarp, updateMapWarp, type MapInput } from './map-warp-ui.js';
import {
  bindCharacterSwitch,
  characterSwitchMarkup,
  closeCharacterConfirm,
  openCharacterSwitch,
  updateCharacterSwitch,
} from './character-switch-ui.js';
import {
  bindExhibitionWarp,
  exhibitionWarpMarkup,
  updateExhibitionWarp,
} from './exhibition-warp-ui.js';
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
import { LoadingCave } from './loading-cave.js';

import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '../shared/world.mjs';
import { EXHIBITION_PLAYER_LIMIT } from '../shared/room-rules.mjs';
import { spawnSite } from '../shared/spawn-sites.mjs';
import { HUNTING, usableCookingFire } from '../shared/hunting.mjs';
import { CROP_INVENTORY, ROOT_RECIPES } from '../shared/crops.mjs';
import { installCropFoodUI } from './crop-food-ui.js';
import { canMount, ridingDistance } from '../shared/riding.mjs';
import { GamepadControls } from './gamepad-ui.js';
import type { MotionControls } from './motion-controls.js';
import { createHandControls } from './hand-controls.js';
import {
  AssistedNavigation,
  StableAssistTarget,
  ASSISTED_CONTROLS_KEY,
  readAssistedControls,
} from './assisted-controls.js';
import { withinAttackReach } from '../shared/combat.mjs';
import { OrbBotUI } from './orb-bot-ui.js';
import { bindMascotMenu, mascotMenuMarkup, updateMascotMenu } from './mascot-menu.js';
import {
  BOT_DESIGNS,
  nearOrbBot,
  nearbyOrbBotsForPetting,
  nearbyOrbBotsForWhistle,
  canWhistleCompanion,
  pettingOrbBot,
  canHandleBot,
  canThrowBot,
  nextOrbBot,
} from '../shared/orb-bots.mjs';
import { interactionTarget } from './interaction-target.js';
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
  attackBlockReason,
  isAttackShortcut,
  MovementCommands,
  movementKey,
  acceptsGameShortcut,
} from './combat-input.js';
import { GATHER_RANGE, interactionVisible } from '../shared/interactions.mjs';
import { campContribution } from '../shared/camp-contribution.mjs';
import { caveFireInteraction } from '../shared/cave-fire.mjs';
import { caveTorchAvailable, caveTorchLit } from '../shared/cave-light.mjs';
import { nearRimoNeko } from '../shared/rimo-neko.mjs';
import { nearMae } from '../shared/mae.mjs';
import { nearKohaku } from '../shared/kohaku.mjs';
import { nearMaruimo } from '../shared/maruimo-mascot.mjs';
import { friendDefinition, nearFriend, pettingFriend } from '../shared/friend-mascots.mjs';
import type { FriendMascotSnapshot } from '../shared/friend-mascot-types.mjs';
import { nearCompanion524 } from '../shared/companion-524.mjs';
import { ENEMY_GROUNDS, SCENERY } from '../shared/scenery-layout.mjs';
import { CASTLE_GATE } from '../shared/castle-layout.mjs';
import { playerDamageEvent } from './enemy-state.js';
import { biomeAt } from '../shared/biomes.mjs';
import { drawWorldMap, setWorldMapSelection } from './world-map.js';
import { setAttr, setData, setFlag, setText } from './hud-dom.js';
import { locationName } from '../shared/paleo-geography.mjs';
import { regionAt } from '../shared/adventure-regions.mjs';
import { adventureInteraction } from './adventure-interaction.js';
import { ChatUI } from './chat-ui.js';
import { installFishingUI, fishingInteraction } from './fishing-ui.js';
import { FISHING, FISHING_SITES } from '../shared/fishing-sites.mjs';
import { COASTAL } from '../shared/coastal-sites.mjs';
import { installCoastalUI, coastalInteraction } from './coastal-ui.js';
import { installGulfUI, gulfInteraction } from './gulf-ui.js';
import { installVillageUI, residentInteraction } from './village-ui.js';
import { inGulf } from '../shared/gulf-region.mjs';
import { ScreenManager, AreaBanner, keyPrompts } from './screens.js';
import { contributorsDialogMarkup } from './title-credits.js';
import { BUILD_PROFILE } from './build-profile.js';
import { FIXED_DIFFICULTY } from '../shared/difficulty.mjs';
import { bindSetupFlow, closeSetupFlow, setupFlowBack, setupFlowOpen } from './setup-flow.js';
import { icon } from './icons.js';
import { installInventoryCrafting } from './inventory-crafting-ui.js';
import {
  GAME_TITLE,
  modalMarkup,
  takeTitleShell,
  titleScreenMarkup,
  titleShellConfig,
  titleShellShown,
  type TitleHandoff,
} from './title-shell.js';
import { startupMarks } from './startup-marks.js';

const $ = (s) => document.querySelector(s);
const query = new URLSearchParams(location.search);
// The title shell's one configuration request, when the page started from it.
const multiplayer = await (titleShellConfig() ?? loadMultiplayerConfig()).catch((error) => {
  // A shown title shell reports the failure itself and stays usable.
  if (!titleShellShown()) $('#app').textContent = error.message;
  throw error;
});
setControllerLayout(multiplayer.controllerLayout);
const sessionKey = (room: string) => multiplayerSessionKey(multiplayer, room);
// The exhibition LAN build never asks for a name or room: each PC is a fixed
// player in the fixed exhibition room, and only the character is chosen.
const fixedIdentity = multiplayer.mode === 'lan';
// Online starts use the loading cave; exhibition starts retain their existing flow.
const onlineTitle = !fixedIdentity && BUILD_PROFILE.environment !== 'exhibition';
const hudPlayerLimit = () =>
  fixedIdentity ? EXHIBITION_PLAYER_LIMIT : (state.playerLimit ?? WORLD.maxPlayers);
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
  difficulty: FIXED_DIFFICULTY,
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
const keys = new Set();
const blockedMovementKeys = new Set();
const movementCommands = new MovementCommands();
let gamepadControls: GamepadControls | undefined;
let motionControls: MotionControls | undefined;
let touchControls: TouchControls | undefined;
let touchYaw = 0;
const touchMode = () => touchControls?.enabled ?? touchDevice();
let easyControls = readAssistedControls();
const assistedNavigation = new AssistedNavigation();
const attackAssist = new StableAssistTarget<any>();
const petAssist = new StableAssistTarget<any>();
const interactionAssist = new StableAssistTarget<any>();
let assistedSource = '';
let assistedDirection = '0,0';
const assistedControls = () => easyControls || !!motionControls?.ownsInput;
let inputCues: InputCues | undefined;
/** The open atlas, so the controller can hand it pointer, zoom and confirm frames. */
let mapInput: MapInput | undefined;
let usingGamepad = false;
const controllerHints = () => fixedIdentity || usingGamepad;
document.body.classList.toggle('exhibition-mode', fixedIdentity);
document.body.classList.toggle('touch-mode', touchMode());
let selectedAnimalId = null,
  stateReceivedAt = performance.now(),
  hurtUntil = 0;

const joinFields = () =>
  (fixedIdentity
    ? `<input type="hidden" name="name"><input type="hidden" name="room">`
    : `<div class="setup-identity"><label>あなたの名前<input name="name" maxlength="16" required autocomplete="off" autofocus></label><label>部屋のコード<span>英数字・ハイフン・アンダースコア / 最大16文字</span><input name="room" maxlength="16" pattern="[A-Za-z0-9_\\-]+" required autocomplete="off"></label></div>`) +
  characterChoicesMarkup();
// The title shell's title and dialog stay the same nodes: the title artwork is not
// requested again and an open contributors dialog stays open (TitleHandoff).
const titleHandoff = takeTitleShell();
const viewportMarkup = `
  <section class="game-viewport" aria-label="${GAME_TITLE} ゲーム画面">
    <canvas id="world" aria-label="${fixedIdentity ? '氷河時代の大陸が広がる3Dワールド。左スティックを浅く倒すと歩き、深く倒すと走ります。右スティックでカメラ回転。' : '氷河時代の大陸が広がる3Dワールド。WASDまたは左スティックで移動。左スティックを浅く倒すと歩き、深く倒すと走ります。右スティックまたはドラッグでカメラ回転。'}" tabindex="0"></canvas>
    <div class="tps-reticle" aria-hidden="true"><i></i></div>
    <div class="scene-shade"></div>
    <div id="damage-flash" class="damage-flash" aria-hidden="true" hidden></div>
    <div id="combat-status" class="combat-status" role="status" hidden></div>
    <div id="area-banner" class="area-banner" aria-live="polite" hidden><small></small><strong></strong></div>
    <button id="status-plate" class="status-plate" title="部族の仲間・招待"><span class="energy-track" id="energy-track" data-level="ok"><span id="energy-bar" class="energy-fill"></span><em class="energy-label">${icon('leaf')}<b>体力</b><span id="energy-label">100 / 100</span></em></span><span class="status-main"><span class="portrait cro cro-magnon-woman" id="my-portrait"><i></i></span><span class="status-text"><strong id="profile-name"></strong><small><span id="room-label"></span><i>·</i><b id="online-count">0/${hudPlayerLimit()}</b><i>·</i><span id="day-label">1日目</span></small></span></span></button>
    <div class="map-hud"><button id="map-button" class="minimap-button" aria-label="世界地図を開く" title="世界地図 [${fixedIdentity ? controllerLabels().map : 'M'}]"><canvas id="minimap" width="160" height="115"></canvas><span class="map-north">N</span><span class="map-area" id="map-area">はじまりの谷</span>${fixedIdentity ? '' : '<kbd class="map-key">M</kbd>'}</button><div class="connection"><i class="status-dot" id="connection-dot"></i><span id="connection-label">未接続</span><span id="ping-label">— ms</span></div></div>
    <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
    ${fixedIdentity ? '' : `<div class="chat-panel"><button class="chat-heading" id="chat-toggle">${icon('chat')}<strong>焚き火の会話</strong><kbd>Enter</kbd><span class="chat-collapse">−</span></button><div id="chat-content"><div id="chat-messages" class="chat-messages" role="log" aria-live="polite"><p class="chat-system">この谷での物語が、ここから始まります。</p></div><form id="chat-form"><input id="chat-input" maxlength="180" placeholder="仲間に話しかける…" aria-label="チャットメッセージ" autocomplete="off"><button aria-label="メッセージを送信" type="submit">${icon('arrow')}</button></form></div></div>`}
    <div class="hotbar-wrap"><div id="companion524-controls"><button type="button" class="hunt-button" id="pet-rimo-button" hidden><kbd>V</kbd><span>りもねこを撫でる</span></button><button type="button" class="hunt-button" id="dismiss-rimo-button" hidden><kbd>T</kbd><span>りもねこをキャンプへ帰す</span></button></div><div class="interaction-hint" id="interaction-hint" hidden><kbd>E</kbd><span></span></div></div>
    <div id="prompt-bar" class="prompt-bar" aria-label="操作の案内"></div>
    <div id="screens" class="screens">
      ${titleHandoff ? '' : titleScreenMarkup()}
      <section id="screen-setup" class="screen setup-screen" hidden>
        <form id="setup-form" class="setup-card"><header class="setup-heading"><span class="setup-eyebrow">${GAME_TITLE}</span><h2>旅人を選ぶ</h2></header><p class="form-error" id="setup-error" hidden></p>${joinFields()}<div class="setup-actions"><button type="button" id="setup-back" class="button button-outline setup-back">戻る</button></div></form>
      </section>
    </div>
  </section>`;
if (titleHandoff) {
  // The detached title joins the game's screens; the dialog stays where it is.
  titleHandoff.viewport.insertAdjacentHTML('beforebegin', viewportMarkup);
  titleHandoff.viewport.remove();
  $('#screens').prepend(titleHandoff.title);
} else $('#app').innerHTML = `${viewportMarkup}\n  ${modalMarkup()}`;

const areaBanner = new AreaBanner($('#area-banner'));
const orbBotUI = new OrbBotUI({
  bots: () => state.orbBots ?? [],
  player,
  now: () => renderer?.serverNow() ?? Date.now(),
  available: () => joined && !renderUnavailable && !screens.active,
  action,
});
const screens = new ScreenManager($('#screens'), (id) => {
  inputCues?.hide();
  if (id) motionControls?.stop();
  if (id) stopInput();
  else $('#world').focus({ preventScroll: true });
});
inputCues = new InputCues($('.game-viewport'), performCue);
const chatUI = fixedIdentity
  ? null
  : new ChatUI($('.chat-panel'), {
      touch: touchMode,
      stop: stopInput,
      resume: () => $('#world').focus({ preventScroll: true }),
      submit: (text) => {
        if (!joined) {
          notify('チャットの送信には接続が必要です。', 'error');
          return false;
        }
        send({ type: 'chat', text });
        return true;
      },
    });
function performCue(command: TouchAction) {
  if (
    !joined ||
    renderUnavailable ||
    screens.active ||
    $('#modal').open ||
    (player()?.downedUntil && !['menu', 'map', 'chat', 'mascots', 'bag'].includes(command))
  )
    return;
  if (assistedControls() && ['inspect', 'zoomIn', 'zoomOut', 'endInspect'].includes(command))
    return;
  switch (command) {
    case 'menu':
      openPauseMenu();
      break;
    case 'map':
      openMap();
      break;
    case 'chat':
      chatUI?.setOpen(true);
      break;
    case 'mascots':
      openPauseMenu('mascots');
      break;
    case 'center':
      if (!assistedControls()) renderer.focusPlayer(player()?.facing + Math.PI);
      break;
    case 'inspect':
      renderer.viewCompanion();
      break;
    case 'zoomIn':
      renderer.adjustZoom(0.15);
      break;
    case 'zoomOut':
      renderer.adjustZoom(-0.15);
      break;
    case 'endInspect':
      renderer.endCompanionView();
      break;
    case 'interact': {
      const target = nearby();
      if (target) action(target.action, target.targetId);
      break;
    }
    case 'pet':
      petNearbyCompanion();
      break;
    case 'ride':
      ride();
      break;
    case 'board':
      action('boardBoat');
      break;
    case 'attack':
      attack();
      break;
    case 'jump':
      jump();
      break;
    case 'throw':
      orbBotUI.use();
      break;
    case 'recall':
      orbBotUI.recall();
      break;
    case 'cancel':
      stopInput();
      if (player()?.cookingEndsAt) action('cancelCook');
      break;
    case 'torch':
      action('toggleCaveTorch');
      break;
    case 'bag':
      openInventory();
      break;
  }
  if (!$('#modal').open && !chatUI?.open) $('#world').focus({ preventScroll: true });
}

function showRenderError(text) {
  renderUnavailable = true;
  // A fatal failure replaces any pending recovery from a lost context.
  graphicsLost = false;
  $('#context-recovery')?.remove();
  if (loadingCave) closeLoadingCave();
  renderer?.audio.setActive(false);
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
// Room tuning from the server's welcome: the exhibition floor always runs, faster.
let tuning = { alwaysRun: false, speedScale: 1 };
// The sight chosen in the setup flow; only a room with spawnChoice honours it.
let spawnChoice = spawnSite(readSaved('cro-spawn', 'camp')).id;
let contributorsCavePending = false;
let contributorsCaveArriving = false;
// Play is offered only once the local character is drawn in a ready world
// (latched per join; a character switch later does not withdraw it).
let arrived = false;
function playReady() {
  if (!arrived && joined && !loadingCave && renderer.selfRenderReady?.()) {
    arrived = true;
    controlsOffered();
  }
  return arrived && !graphicsLost;
}
/** Startup timing only: the visitor's first movement and gather after controls,
 * each as the command sent and as the authoritative state showing its effect
 * (the own position moved / the gathered count rose). Never synthesized. */
let firstActions: {
  marks: number;
  x: number;
  z: number;
  gathered: number;
  moveSent: boolean;
  gatherSent: boolean;
} | null = null;
function controlsOffered() {
  startupMarks.mark('controls');
  const me = player();
  firstActions = me
    ? {
        marks: startupMarks.current,
        x: me.x,
        z: me.z,
        gathered: me.gathered ?? 0,
        moveSent: false,
        gatherSent: false,
      }
    : null;
}
function firstCommand(message) {
  if (!firstActions) return;
  if (!firstActions.moveSent && message.type === 'move' && (message.dx || message.dz)) {
    firstActions.moveSent = true;
    startupMarks.mark('first-move-sent', firstActions.marks);
  }
  if (!firstActions.gatherSent && message.type === 'action' && message.action === 'gather') {
    firstActions.gatherSent = true;
    startupMarks.mark('first-gather-sent', firstActions.marks);
  }
}
function firstEffects() {
  const me = player();
  if (!firstActions || !me) return;
  if (firstActions.moveSent && Math.hypot(me.x - firstActions.x, me.z - firstActions.z) >= 0.05)
    startupMarks.mark('first-move-confirmed', firstActions.marks);
  if (firstActions.gatherSent && (me.gathered ?? 0) > firstActions.gathered)
    startupMarks.mark('first-gather-confirmed', firstActions.marks);
  if (startupMarks.has('first-move-confirmed') && startupMarks.has('first-gather-confirmed'))
    firstActions = null;
}
// A lost WebGL context pauses play without leaving the session (WorldRenderer
// keeps its one animation loop, the models and their sources). Held input is
// released and sound pauses; restoration resumes the current view, and a bounded
// visible wait offers a reload. A real asset failure stays fatal (showRenderError).
let graphicsLost = false;
function graphicsContextChanged(event: ContextEvent) {
  if (renderUnavailable) return;
  if (event === 'lost') {
    graphicsLost = true;
    stopInput();
    loadingCave?.releaseInput();
    renderer.audio.setActive(false);
    showContextRecovery(false);
  } else if (event === 'stalled') showContextRecovery(true);
  else {
    graphicsLost = false;
    $('#context-recovery')?.remove();
    renderer.audio.setActive(joined);
    // A controller button held through the loss must be released before it acts.
    gamepadControls?.suspend();
  }
}
function showContextRecovery(stalled: boolean) {
  let panel = $('#context-recovery');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'context-recovery';
    panel.className = 'context-recovery';
    panel.setAttribute('role', 'status');
    panel.innerHTML =
      '<strong>画面を復元しています</strong><p></p><button type="button" class="button button-accent" hidden>再読み込み</button>';
    panel.querySelector('button').onclick = () => location.reload();
    $('.game-viewport').append(panel);
  }
  panel.querySelector('p').textContent = stalled
    ? '画面が戻りません。再読み込みしてください。'
    : '描画が一時的に止まりました。旅の進行はそのままです。';
  panel.querySelector('button').hidden = !stalled;
}
const wantsToRun = () => runMode || dashing || tuning.alwaysRun;
let lastGait = false;
let renderer;
let loadingCave: LoadingCave | null = null;
try {
  renderer = new WorldRenderer($('#world'), {
    deferWorld: onlineTitle && query.get('autostart') !== '1',
    onAnimal: interactAnimal,
    onError: showRenderError,
    onGraphicsContext: graphicsContextChanged,
    onInspect: () => {
      touchControls?.stop();
      // Looking at a companion only stops walking, never its pet/joy animation.
      for (const key of keys) blockedMovementKeys.add(key);
      keys.clear();
      dashing = false;
      renderer.prediction?.stop();
      movementCommands.reset();
      send({ type: 'move', dx: 0, dz: 0, running: false });
    },
  });
  renderer.prediction.enabled = multiplayer.mode === 'lan';
  // The full-screen atlas hides the world completely; its pan and zoom need the frame time.
  renderer.occluded = () => $('#modal').open && !!$('#big-map');
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
    viewCompanion() {
      return false;
    },
    endCompanionView() {
      return false;
    },
    companionViewChoice() {
      return undefined;
    },
    rotateCamera() {},
    destroy() {},
    getMovementDirection() {
      return { dx: 0, dz: 0 };
    },
  };
}
$('.hotbar-wrap').insertAdjacentHTML(
  'afterbegin',
  `<div class="riding-controls" hidden><button id="ride-button" class="hunt-button"><kbd>R</kbd><span>マンモスに乗る</span></button><button id="carry-decline" class="hunt-button" hidden>断る</button><small id="riding-hint" hidden></small></div>`,
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
const inventoryCrafting = installInventoryCrafting({
  player,
  world: () => ({ ...state, collision: renderer.collision }),
  now: () => renderer.serverNow(),
  connected: () => joined && !renderUnavailable,
  request: (id: string) => send({ type: 'action', action: 'inventoryCraft', targetId: id }),
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
  `<div class="hunt-controls"><div id="magic-cooldown" class="hunt-button" hidden><span>魔法を再び使えるまで</span><progress id="magic-cooldown-progress" max="1" value="0" aria-label="魔法の再使用待ち"></progress></div><button id="cook-button" class="hunt-button" hidden>${icon('flame')}<span>肉を焼く</span></button></div><div id="cooking-status" class="cooking-status" hidden><span id="cooking-label">肉を焼いています…</span><progress id="cooking-progress" max="1" value="0" aria-label="肉を焼く進み具合"></progress><button id="cancel-cook">中止</button></div>`,
);
renderer.setState(state, selfId);
$('#profile-name').textContent = profile.name;
$('#room-label').textContent = profile.room;

function send(message) {
  if (socket?.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
  if (firstActions) firstCommand(message);
}
function stopInput() {
  touchControls?.hide();
  renderer?.endCompanionView();
  motionControls?.input.pause();
  clearMovementInput();
}
function clearMovementInput() {
  touchControls?.stop();
  renderer.setTouchMovement?.(0, 0);
  renderer.prediction?.stop();
  assistedNavigation.pause();
  attackAssist.reset();
  petAssist.reset();
  interactionAssist.reset();
  renderer.setAssistMarker('attack', null);
  renderer.setAssistMarker('interact', null);
  assistedDirection = '0,0';
  // Also cancels a cast sent just before a menu/blur, before its snapshot arrives.
  if (joined) {
    send({ type: 'action', action: 'cancelBotThrows' });
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
  if (tone === 'success') renderer?.audio.confirm();
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
  if (fixedIdentity) return;
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
  if (!connected) chatUI?.setOpen(false);
  if (!connected)
    motionControls?.pause('通信が切れました。再接続後、操作する手を確認して自動再開します。');
  joined = connected;
  renderer.audio.setActive(connected);
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
  const marks = startupMarks.current;
  clearTimeout(retry);
  manualLeave = false;
  keys.clear();
  blockedMovementKeys.clear();
  movementCommands.reset();
  lastGait = null;
  connection(false, automatic ? '再接続中…' : '接続中…');
  if (!automatic) {
    arrived = false;
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
  startupMarks.mark('status', marks);
  const ws = new WebSocket(
    multiplayerUrl(multiplayer, location.origin, {
      ...profile,
      resume: '1',
      session: savedSession(sessionKey(profile.room)),
      ...(startAtCamp ? { startAtCamp: '1', spawn: spawnChoice } : {}),
    }),
  );
  socket = ws;
  ws.addEventListener('open', () => {
    if (ws === socket) startupMarks.mark('socket-open', marks);
  });
  ws.addEventListener('message', ({ data }) => {
    if (ws !== socket) return;
    let message;
    try {
      message = JSON.parse(data);
    } catch {
      return;
    }
    if (message.type === 'welcome') {
      startupMarks.mark('welcome', marks);
      retryCount = 0;
      selfId = message.id;
      profile = {
        ...profile,
        ...message.profile,
        room: message.room,
        difficulty: FIXED_DIFFICULTY,
      };
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
      tuning = { alwaysRun: false, speedScale: 1, ...message.rules };
      renderer.prediction.speedScale = tuning.speedScale;
      connection(true, 'オンライン');
      // Arrive looking at the chosen sight, not at the default camp view.
      const site = spawnSite(spawnChoice);
      renderer.focusPlayer(
        startAtCamp && message.rules?.spawnChoice
          ? Math.atan2(site.x - site.look.x, site.z - site.look.z)
          : undefined,
      );
      if (message.resumed && !startAtCamp)
        notify('接続が戻りました。持ち物と進行を復元しました。', 'success');
      startAtCamp = false;
    }
    if (message.type === 'roomReset') {
      restartAfterRoomReset();
      return;
    }
    if (message.type === 'state') {
      startupMarks.mark('first-state', marks);
      const previous = player();
      state = { ...state, ...message };
      stateReceivedAt = performance.now();
      if (firstActions) firstEffects();
      if (
        (previous?.mountId ?? previous?.boatId ?? null) !==
        (player()?.mountId ?? player()?.boatId ?? null)
      ) {
        motionControls?.pause('乗り物が変わりました。操作する手を戻すと自動再開します。');
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
        if ($('#big-map') || $('#exhibition-warp')) $('#modal').close();
      }
      renderer.setState(state, selfId);
      if (warped && contributorsCaveArriving) {
        contributorsCaveArriving = false;
        renderer.focusPlayer(player().facing + Math.PI);
      }
      if (contributorsCavePending && joined && player()) {
        contributorsCavePending = false;
        contributorsCaveArriving = true;
        action('warp', 'spawn-cave');
      }
      if (warped && $('#exhibition-warp')) renderer.focusPlayer(player().facing + Math.PI);
      updateCharacterSwitch(player(), renderer.serverNow(), joined);
      updateExhibitionWarp(player(), renderer.serverNow(), joined);
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
    }
    if (message.type === 'inventoryCraftResult') inventoryCrafting.result(message);
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
      contributorsCaveArriving = false;
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
    touchControls?.stop();
    renderer.setTouchMovement?.(0, 0);
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
  const assisting = assistedControls();
  // Existing range checks remain in each interaction; add the same view/front gate.
  const collision = assisting
    ? {
        segmentFree: (a, b, ...args) =>
          renderer.collision.segmentFree(a, b, ...args) && assistScore(b) !== null,
      }
    : renderer.collision;
  // Petting has its own input; companions must not consume the interact target.
  const coastal = coastalInteraction(state, me, collision);
  if (coastal) return coastal;
  const fishing = fishingInteraction(me);
  if (
    fishing &&
    (!assisting ||
      !fishing.targetId ||
      assistScore(FISHING_SITES.find((s) => s.id === fishing.targetId)) !== null)
  )
    return fishing;
  if (me.boatId) return null;
  const hunting = huntInteraction(state, me, collision);
  if (hunting) return hunting;
  const caveFire = caveFireInteraction(state, me, collision);
  if (caveFire) return caveFire;
  const adventure = adventureInteraction(me, collision);
  if (adventure) return adventure;
  const resident = residentInteraction(state, me, collision);
  if (resident) return resident;
  const gulf = gulfInteraction(state, me, collision);
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
  if (campContribution(state.camp, me, renderer.serverNow()))
    objects.push({
      ...state.camp,
      action: 'contribute',
      label: '焚き火に資材を届ける',
      range: GATHER_RANGE,
    });
  if (!fixedIdentity)
    objects.push({ ...state.npc, action: 'trade', label: 'オルと物々交換する', range: 10 });
  const available = objects
    .filter(
      (o) => distance(me, o) <= o.range && (!collision || interactionVisible(collision, me, o)),
    )
    .sort((a, b) => distance(me, a) - distance(me, b));
  if (assisting) {
    const chosen = interactionAssist.choose(
      available.map((o) => ({
        id: `${o.action}:${o.x}:${o.z}`,
        score: assistScore(o) ?? Infinity,
        value: o,
      })),
      performance.now(),
    );
    renderer.setAssistMarker('interact', chosen, chosen?.action === 'gather' ? '採集' : '調べる');
    return chosen;
  }
  return available[0];
}
function updateHUD() {
  const me = player();
  // Setting the minimap canvas font brings style up to date: drawn before the HUD writes
  // below, it no longer recalculates style in the middle of them.
  drawMinimap();
  setText($('#online-count'), `${state.players.length}/${hudPlayerLimit()}`);
  // Each exhibition visit is day one; the world's simulation clock keeps running.
  setText($('#day-label'), `${fixedIdentity ? 1 : state.day || 1}日目`);
  const energy = Math.round(me?.energy ?? 100),
    energyBar = $('#energy-bar');
  setText($('#energy-label'), `${energy} / 100`);
  if (energyBar.style.width !== `${energy}%`) energyBar.style.width = `${energy}%`;
  setData($('#energy-track'), { level: energy <= 25 ? 'critical' : energy <= 50 ? 'low' : 'ok' });
  const target = nearby();
  setFlag($('#interaction-hint'), 'hidden', !target);
  setText($('#interaction-hint span'), target?.label ?? '');
  setAttr($('#my-portrait'), 'class', `portrait ${profile.species} ${characterModel(profile).key}`);
  setAttr($('#status-plate'), 'title', `${characterModel(profile).name} · 部族の仲間と招待`);
  updateHuntingHUD();
  const biome = biomeAt(me?.x ?? 50, me?.z ?? 50);
  const region = regionAt(me?.x ?? 50, me?.z ?? 50);
  const areaName = region?.name ?? locationName(me?.x ?? 50, me?.z ?? 50);
  setText($('#map-area'), areaName);
  if (me && joined && !screens.active)
    areaBanner.update(
      inGulf(me.x, me.z) ? '三つの岸の湾' : (region?.kind ?? biome.short),
      areaName,
    );
  updateModalHUD();
  gulfUI.update();
  cropFoodUI.update();
  fishingUI.update();
  coastalUI.update();
  villageUI.update();
  if ($('#modal').open && $('#big-map')) drawMinimap($('#big-map'), true);
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
  updateInventory();
  inventoryCrafting.update();
  updateMascotMenu($('#modal-body'), state, selfId);
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
  if (type === 'attack' && !canStartAttack(player(), renderer.serverNow())) return;
  if (type === 'throwBot' && !canThrowBot(player(), renderer.serverNow())) return;
  renderer.endCompanionView();
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
  if (
    player()?.boatId &&
    ![
      'boardBoat',
      'fish',
      'cancelFishing',
      'recallBots',
      'selectMascot',
      'deselectMascot',
    ].includes(type)
  )
    return;
  if (player()?.mountId && !['ride', 'recallBots', 'selectMascot', 'deselectMascot'].includes(type))
    return;
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
  action('attack', assistedControls() ? assistedAttackTarget()?.id : undefined);
}
/** Only on-screen, reachable targets in the steering direction are assisted. */
function assistScore(point) {
  const me = player();
  if (
    !me ||
    !point ||
    !Number.isFinite(point.x) ||
    !Number.isFinite(point.z) ||
    !joined ||
    renderUnavailable ||
    $('#modal').open ||
    screens.active ||
    document.hidden ||
    !document.hasFocus() ||
    me.downedUntil ||
    renderer.viewingCompanion ||
    (motionControls?.ownsInput && motionControls.input.state !== 'ACTIVE')
  )
    return null;
  const dx = point.x - me.x,
    dz = point.z - me.z,
    range = Math.hypot(dx, dz);
  const front =
    dx * Math.sin(assistedNavigation.heading) + dz * Math.cos(assistedNavigation.heading);
  if (range > 0.1 && front / range < 0.35) return null;
  if (!interactionVisible(renderer.collision, me, point)) return null;
  const height = renderer.collision.surfaceHeight;
  if (
    height &&
    Math.abs(height.call(renderer.collision, me) - height.call(renderer.collision, point)) > 1.4
  )
    return null;
  const screen = renderer.assistScreenPoint(point);
  return screen ? Math.abs(screen.x) * 2 + Math.abs(screen.y) * 0.35 + range * 0.15 : null;
}
function assistedAttackTarget() {
  const me = player();
  if (
    !assistedControls() ||
    !me ||
    !joined ||
    renderUnavailable ||
    $('#modal').open ||
    screens.active ||
    document.hidden ||
    !document.hasFocus() ||
    renderer.viewingCompanion ||
    (motionControls?.ownsInput && motionControls.input.state !== 'ACTIVE') ||
    !canStartAttack(me, renderer.serverNow())
  ) {
    attackAssist.reset();
    renderer.setAssistMarker('attack', null);
    return null;
  }
  const candidates = (state.enemies ?? []).flatMap((enemy) => {
    if (
      !enemy.hostile ||
      enemy.phase !== 'alive' ||
      enemy.behavior === 'step' ||
      !withinAttackReach(me, enemy)
    )
      return [];
    const point = { ...enemy, height: Math.min(2.2, Math.max(0.65, enemy.radius)) };
    const score = assistScore(point);
    return score === null ? [] : [{ id: enemy.id, score, value: point }];
  });
  const target = attackAssist.choose(candidates, performance.now());
  renderer.setAssistMarker('attack', target, '攻撃');
  return target;
}
function canPetRimo() {
  return (
    joined &&
    !renderUnavailable &&
    !state.rimoNeko?.petPlayerId &&
    state.mae?.petPlayerId !== selfId &&
    state.kohaku?.petPlayerId !== selfId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearRimoNeko(player(), state.rimoNeko, renderer.collision, renderer.serverNow())
  );
}
function petRimo() {
  if (canPetRimo()) action('petRimo');
}
function dismissRimo() {
  if (state.rimoNeko?.followPlayerId === selfId) action('dismissRimo');
}
function canPetMae() {
  return (
    joined &&
    !renderUnavailable &&
    !state.mae?.petPlayerId &&
    state.kohaku?.petPlayerId !== selfId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.rimoNeko?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearMae(player(), state.mae, renderer.collision, renderer.serverNow())
  );
}
function petMae() {
  if (canPetMae()) action('petMae');
}
function canPetKohaku() {
  return (
    joined &&
    !renderUnavailable &&
    !state.kohaku?.petPlayerId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.rimoNeko?.petPlayerId !== selfId &&
    state.mae?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearKohaku(player(), state.kohaku, renderer.collision, renderer.serverNow())
  );
}
function petKohaku() {
  if (canPetKohaku()) action('petKohaku');
}
function canPetMaruimo() {
  return (
    joined &&
    !renderUnavailable &&
    !state.maruimo?.petPlayerId &&
    !(
      state.maruimo?.followPlayerId &&
      state.maruimo.followPlayerId !== selfId &&
      state.players.some((p) => p.id === state.maruimo?.followPlayerId)
    ) &&
    state.kohaku?.petPlayerId !== selfId &&
    state.rimoNeko?.petPlayerId !== selfId &&
    state.mae?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearMaruimo(player(), state.maruimo, renderer.collision, renderer.serverNow())
  );
}
function petMaruimo() {
  if (canPetMaruimo()) action('petMaruimo');
}
function canPetFriend(friend: FriendMascotSnapshot | undefined) {
  return (
    !!friend &&
    joined &&
    !renderUnavailable &&
    !friend.petPlayerId &&
    !(
      friend.followPlayerId &&
      friend.followPlayerId !== selfId &&
      state.players.some((p) => p.id === friend.followPlayerId)
    ) &&
    !pettingFriend(state.friends, selfId) &&
    state.kohaku?.petPlayerId !== selfId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.rimoNeko?.petPlayerId !== selfId &&
    state.mae?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearFriend(player(), friend, renderer.collision, renderer.serverNow())
  );
}
function petFriend(friend: FriendMascotSnapshot | undefined) {
  if (canPetFriend(friend)) action('petFriend', friend!.key);
}
function nearbyBotsForPetting() {
  if (
    !joined ||
    renderUnavailable ||
    state.mae?.petPlayerId === selfId ||
    state.kohaku?.petPlayerId === selfId ||
    state.maruimo?.petPlayerId === selfId ||
    state.rimoNeko?.petPlayerId === selfId ||
    state.companion524?.petPlayerId === selfId ||
    !!pettingFriend(state.friends, selfId)
  )
    return [];
  return nearbyOrbBotsForPetting(
    state.orbBots ?? [],
    player(),
    renderer.collision,
    renderer.serverNow(),
    new Set(state.players.map((p) => p.id)),
  );
}
function preferredPet() {
  const me = player();
  if (!me || !joined || renderUnavailable) return null;
  const candidates: {
    point: { x: number; z: number };
    choice: 'rimo' | '524' | { action: string; label: string; targetId?: string };
  }[] = [];
  if (canPetRimo()) candidates.push({ point: state.rimoNeko!, choice: 'rimo' });
  if (canPetKohaku())
    candidates.push({
      point: state.kohaku!,
      choice: { action: 'petKohaku', label: 'こはくちゃんを撫でる' },
    });
  if (canPetMaruimo())
    candidates.push({
      point: state.maruimo!,
      choice: { action: 'petMaruimo', label: 'まるぃもを撫でる' },
    });
  if (canPetMae())
    candidates.push({ point: state.mae!, choice: { action: 'petMae', label: 'maeを撫でる' } });
  for (const friend of state.friends ?? [])
    if (canPetFriend(friend))
      candidates.push({
        point: friend,
        choice: {
          action: 'petFriend',
          targetId: friend.key,
          label: `${friendDefinition(friend.key)?.name ?? '仲間'}を撫でる`,
        },
      });
  if (canPet524()) candidates.push({ point: state.companion524!, choice: '524' });
  const group = nearbyBotsForPetting();
  if (group.length > 0)
    candidates.push({
      point: assistedControls()
        ? [...group].sort((a, b) => (assistScore(a) ?? Infinity) - (assistScore(b) ?? Infinity))[0]
        : group[0],
      choice: { action: 'petBots', label: `近くのbotたちをまとめて撫でる（${group.length}匹）` },
    });
  if (
    state.rimoNeko?.petPlayerId !== selfId &&
    state.mae?.petPlayerId !== selfId &&
    state.kohaku?.petPlayerId !== selfId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.companion524?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId)
  ) {
    for (const b of state.orbBots ?? []) {
      if (
        group.some((candidate) => candidate.id === b.id) ||
        b.ownerId === selfId ||
        b.busy ||
        !nearOrbBot(me, b, renderer.collision, renderer.serverNow())
      )
        continue;
      candidates.push({
        point: b,
        choice: { action: 'petBot', targetId: b.id, label: `${BOT_DESIGNS[b.kind].name}を撫でる` },
      });
    }
  }
  if (assistedControls()) {
    const selected = petAssist.choose(
      candidates.flatMap((candidate) => {
        const score = assistScore(candidate.point);
        const choice = candidate.choice;
        const id =
          typeof choice === 'string' ? choice : `${choice.action}:${choice.targetId ?? ''}`;
        return score === null ? [] : [{ id, score, value: candidate }];
      }),
      performance.now(),
    );
    renderer.setAssistMarker('interact', selected?.point ?? null, '撫でる');
    return selected?.choice ?? null;
  }
  return (
    candidates.sort((a, b) => distance(me, a.point) - distance(me, b.point))[0]?.choice ?? null
  );
}
function petNearbyCompanion() {
  const choice = preferredPet();
  if (choice === 'rimo') petRimo();
  else if (choice === '524') pet524();
  else if (choice) action(choice.action, choice.targetId);
}
function dismissNearbyCompanion() {
  const me = player();
  if (!me) return;
  const candidates: { point: { x: number; z: number }; action: string; target?: string }[] = (
    state.orbBots ?? []
  )
    .filter((b) => b.ownerId === selfId)
    .map((b) => ({ point: b, action: 'dismissBot', target: b.kind }));
  if (state.rimoNeko?.followPlayerId === selfId)
    candidates.push({ point: state.rimoNeko, action: 'dismissRimo' });
  if (state.kohaku?.followPlayerId === selfId)
    candidates.push({ point: state.kohaku, action: 'dismissKohaku' });
  if (state.maruimo?.followPlayerId === selfId)
    candidates.push({ point: state.maruimo, action: 'dismissMaruimo' });
  if (state.mae?.followPlayerId === selfId)
    candidates.push({ point: state.mae, action: 'dismissMae' });
  for (const friend of state.friends ?? [])
    if (friend.followPlayerId === selfId)
      candidates.push({ point: friend, action: 'dismissFriend', target: friend.key });
  if (state.companion524?.followPlayerId === selfId && !candidates.some((c) => c.target === '524'))
    candidates.push({ point: state.companion524, action: 'dismiss524' });
  const nearest = candidates.sort((a, b) => distance(me, a.point) - distance(me, b.point))[0];
  if (nearest) action(nearest.action, nearest.target);
}
function canPet524() {
  return (
    joined &&
    !renderUnavailable &&
    !state.companion524?.petPlayerId &&
    state.mae?.petPlayerId !== selfId &&
    state.kohaku?.petPlayerId !== selfId &&
    state.maruimo?.petPlayerId !== selfId &&
    state.rimoNeko?.petPlayerId !== selfId &&
    !pettingFriend(state.friends, selfId) &&
    !pettingOrbBot(state.orbBots, selfId) &&
    nearCompanion524(player(), state.companion524, renderer.collision, renderer.serverNow())
  );
}
function pet524() {
  if (canPet524()) action('pet524');
}
function dismiss524() {
  if (state.companion524?.followPlayerId === selfId) action('dismiss524');
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
  if (id === state.kohaku?.id) {
    petKohaku();
    return;
  }
  if (id === state.maruimo?.id) {
    petMaruimo();
    return;
  }
  const friend = state.friends?.find((f) => f.id === id);
  if (friend) {
    petFriend(friend);
    return;
  }
  if (id === state.mae?.id) {
    petMae();
    return;
  }
  const bot = state.orbBots?.find((b) => b.id === id && b.kind !== '524');
  if (bot) {
    if (!bot.busy && nearOrbBot(player(), bot, renderer.collision, renderer.serverNow()))
      action('petBot', id);
    return;
  }
  if (id === state.companion524?.id || id === state.rimoNeko?.id) {
    if (canStartAttack(player(), renderer.serverNow())) action('attack', id);
    return;
  }
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
  orbBotUI.update();
  boatUI.update();
  const petChoice = preferredPet();
  setFlag($('#pet-rimo-button'), 'hidden', petChoice !== 'rimo');
  setText(
    $('#pet-rimo-button kbd'),
    motionControls?.ownsInput ? '横なで' : controllerHints() ? controllerLabels().bottom : 'V',
  );
  setFlag(
    $('#dismiss-rimo-button'),
    'hidden',
    !joined || state.rimoNeko?.followPlayerId !== selfId,
  );
  setText($('#dismiss-rimo-button kbd'), controllerHints() ? 'メニュー' : 'T');
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
  // The ride controls are written once, in their final state; a carry choice takes them over.
  let rideDisabled =
      !joined || renderUnavailable || !!me?.boatId || !!me?.downedUntil || (!mounted && !nearRide),
    rideMounted = mounted,
    rideLabel = mounted ? 'マンモスから降りる' : 'マンモスに乗る',
    ridingHidden = !mounted && !nearRide;
  // The button already names its key and action; the hint only adds what it cannot say.
  let ridingHint = mounted
    ? touchMode()
      ? '移動パッドで移動'
      : controllerHints()
        ? '左スティックで移動'
        : 'WASDで移動'
    : '';
  const carryChoice = joined && !renderUnavailable && hasCarryChoice();
  if (carryChoice) {
    const partnerId = me.carryOfferFromId || me.carryOfferToId || me.carrierId || me.passengerId;
    const partner = partnerId ? state.players.find((p) => p.id === partnerId) : carryTarget();
    const partnerName = partner?.name ?? '相手';
    ridingHidden = false;
    rideDisabled = false;
    rideMounted = carrying(me);
    rideLabel = me.carrierId
      ? '肩から降りる'
      : me.passengerId
        ? `${partnerName}を降ろす`
        : me.carryOfferFromId
          ? '肩に乗る'
          : me.carryOfferToId
            ? '誘いを取り消す'
            : `${partnerName}を担ぐ`;
    ridingHint = me.carrierId
      ? `${partnerName}が移動します`
      : me.passengerId
        ? '歩行・走行できます'
        : me.carryOfferFromId
          ? `${partnerName}からの誘い`
          : me.carryOfferToId
            ? '相手の返事を待っています · 動くと取消'
            : '相手が「肩に乗る」を押すと担ぎます';
  }
  setFlag(rideButton, 'disabled', rideDisabled);
  rideButton.classList.toggle('mounted', rideMounted);
  setText(rideButton.querySelector('span'), rideLabel);
  setFlag($('.riding-controls'), 'hidden', ridingHidden);
  setText($('#riding-hint'), ridingHint);
  setFlag($('#riding-hint'), 'hidden', !ridingHint);
  setFlag($('#carry-decline'), 'hidden', !me?.carryOfferFromId);
  setData($('#world'), {
    carrierId: me?.carrierId ?? '',
    passengerId: me?.passengerId ?? '',
  });
  if (controllerHints() && me?.boatId)
    setText($('#boat-hint'), '左スティックで操船 · 深く倒すと速く');
  setData($('#world'), {
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
  const ownBots = (state.orbBots ?? []).filter((bot) => bot.ownerId === selfId);
  const presentOwners = new Set((state.players ?? []).map((p) => p.id));
  const petLabel =
    petChoice === 'rimo'
      ? 'りもねこを撫でる'
      : petChoice === '524'
        ? '524を撫でる'
        : petChoice?.action === 'petBots'
          ? 'botたちを撫でる'
          : petChoice?.label;
  const closeAction = nearby();
  const busy = cooking || fishing || !!coastal;
  const cueContext: CueContext = {
    inspect: renderer.companionViewChoice()?.label,
    viewing: renderer.viewingCompanion,
    automaticCamera: assistedControls(),
    pet: petLabel,
    interaction: closeAction?.action.startsWith('pet') ? undefined : closeAction?.label,
    ride: !rideButton.disabled ? rideButton.querySelector('span').textContent : undefined,
    board: !$('#boat-board').disabled ? $('#boat-board span').textContent : undefined,
    attack:
      attackAvailable &&
      !![...(state.animals ?? []), ...enemies].find(
        (target) => target.phase === 'alive' && !target.riderId && me && distance(me, target) < 14,
      ),
    jump: canStartJump(me, serverNow),
    throw: canThrowBot(me, serverNow) && !!nextOrbBot(state.orbBots ?? [], me, orbBotUI.selected),
    recall:
      canHandleBot(me, serverNow) &&
      (ownBots.some((bot) => ['waiting', 'airborne', 'landing'].includes(bot.mode)) ||
        nearbyOrbBotsForWhistle(
          state.orbBots ?? [],
          me,
          renderer.collision,
          serverNow,
          presentOwners,
        ).length > 0 ||
        canWhistleCompanion(
          me,
          state.rimoNeko,
          'rimo-neko',
          renderer.collision,
          serverNow,
          presentOwners,
        ) ||
        canWhistleCompanion(
          me,
          state.companion524,
          '524',
          renderer.collision,
          serverNow,
          presentOwners,
        )),
    busy,
    torch: caveTorchAvailable(me) ? (caveTorchLit(me) ? '松明を消す' : '松明を灯す') : undefined,
    needsFood: !!me && me.energy < 75,
  };
  const playVisible =
    joined &&
    playReady() &&
    !!me &&
    !renderUnavailable &&
    !screens.active &&
    !$('#modal').open &&
    !downed &&
    !document.hidden &&
    document.hasFocus() &&
    !motionControls?.ownsInput &&
    !document.activeElement?.closest('input,textarea,select,[contenteditable]');
  inputCues?.update(cueContext, playVisible && !touchMode());
  touchControls?.update(
    downed ? { automaticCamera: assistedControls() } : { ...cueContext, attack: attackAvailable },
    touchPlayable('menu'),
  );
  const combat = attackProfile(me ?? profile);
  const cooldownLeft =
    me?.attackSequence > 0 ? Math.max(0, combat.cooldownMs - (serverNow - me.attackAt)) : 0;
  const metered = !!combat.projectileSpeed && cooldownLeft > 0;
  const magicCooldown = $('#magic-cooldown'),
    magicCooldownProgress = $('#magic-cooldown-progress');
  setFlag(magicCooldown, 'hidden', !joined || downed || !metered);
  setText(
    magicCooldown.querySelector('span')!,
    combat.key === 'science' ? '科学パルスを充填中' : '魔法を再び使えるまで',
  );
  setAttr(
    magicCooldownProgress,
    'aria-label',
    combat.key === 'science' ? '科学パルスの再使用待ち' : '魔法の再使用待ち',
  );
  magicCooldownProgress.max = Math.max(1, combat.cooldownMs);
  magicCooldownProgress.value = metered ? cooldownLeft : 0;
  setAttr(magicCooldownProgress, 'aria-valuetext', metered ? '再使用待ち' : '使用可能');
  const canCook =
    !modalActionsBlocked() &&
    inv.rawMeat > 0 &&
    inv.cookedMeat < HUNTING.inventoryLimit &&
    !!usableCookingFire(state, me, renderer.collision);
  setFlag($('#cook-button'), 'hidden', !canCook);
  setFlag($('#cook-button'), 'disabled', !canCook);
  setFlag($('#cooking-status'), 'hidden', !cooking && !fishing && !coastal);
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
    setText($('#cooking-label'), label + ' · ' + (remaining / 1000).toFixed(1) + '秒');
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
    setAttr($('#cooking-progress'), 'aria-label', label + '進み具合');
  }
  setData($('#world'), {
    fishing: me?.fishing?.spotId ?? '',
    coastal: coastal?.kind ?? '',
    weapon: combat.id,
    rawFish: String(inv.rawFish),
    cookedFish: String(inv.cookedFish),
  });
  setFlag($('#damage-flash'), 'hidden', performance.now() > hurtUntil && !downed);
  setFlag($('#combat-status'), 'hidden', !downed && !protectedNow);
  $('#combat-status').classList.toggle('downed', downed);
  setText(
    $('#combat-status'),
    downed
      ? `力尽きました · ${Math.max(0, Math.ceil((me.downedUntil - serverNow) / 1000))}秒後に焚き火で回復\n持ち物は失いません`
      : protectedNow
        ? `焚き火で回復 · 元気 ${me.energy} / 100 · あと${Math.ceil((me.invulnerableUntil - serverNow) / 1000)}秒保護中`
        : '',
  );
  setData($('#world'), {
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
  setData($('#world'), {
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
  chatUI?.setOpen(false);
  inputCues?.hide();
  stopInput();
  $('#modal-body').innerHTML = content;
  if (!$('#modal').open) $('#modal').showModal();
}
function applyProfileForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const room = fixedIdentity ? profile.room : String(data.get('room')).toUpperCase();
  // A title start changes the traveller and spawn, but keeps their possessions.
  // Joining a different room while playing retains the explicit fresh-join path.
  startAtCamp = !joined;
  const keepSession = startAtCamp && room === profile.room;
  manualLeave = true;
  if (!keepSession) saveSession(sessionKey(profile.room), null);
  send({ type: 'leave', ...(keepSession ? { keepSession: true } : {}) });
  const previous = socket;
  socket = null;
  previous?.close();
  profile = {
    name: fixedIdentity ? profile.name : String(data.get('name')).trim() || '旅人',
    room,
    ...parseCharacterValue(data.get('character')),
    difficulty: FIXED_DIFFICULTY,
  };
  spawnChoice = spawnSite(data.get('spawn')).id;
  save('cro-spawn', spawnChoice);
  if (!keepSession) saveSession(sessionKey(profile.room), null);
  for (const [k, v] of Object.entries(profile)) save(`cro-${k}`, v);
  history.replaceState({}, '', `?room=${encodeURIComponent(profile.room)}`);
  $('#profile-name').textContent = profile.name;
}
function showTitle() {
  renderer.releaseArrivalLoads?.();
  contributorsCavePending = false;
  contributorsCaveArriving = false;
  chatUI?.setOpen(false);
  motionControls?.stop();
  $('#modal').close();
  screens.show('title');
}
function showSetup(error = '') {
  renderer.releaseArrivalLoads?.();
  contributorsCavePending = false;
  contributorsCaveArriving = false;
  // A join refused while the gallery waited for the arrival returns to setup.
  if (loadingCave) closeLoadingCave();
  chatUI?.setOpen(false);
  $('#modal').close();
  $('#retry-session')?.remove();
  const form = $('#setup-form');
  form.name.value = profile.name;
  form.room.value = profile.room;
  bindCharacterSelection(form, profile);
  closeSetupFlow();
  $('#setup-error').hidden = !error;
  $('#setup-error').textContent = error;
  $('#setup-back').textContent = joined ? '探索に戻る' : '戻る';
  screens.show('setup');
}
function closeLoadingCave() {
  loadingCave?.dispose();
  loadingCave = null;
  renderer.loadingCave = null;
  clearMovementInput();
  gamepadControls?.suspend();
}
function enterGame(skipGallery = false) {
  if (renderUnavailable || loadingCave) return;
  renderer.prioritizeArrivalLoads?.();
  // Each start is one measured attempt; the previous attempt's marks are cleared.
  const marks = startupMarks.begin();
  startupMarks.mark('confirm', marks);
  firstActions = null;
  // A title start arrives at the camp, or at the chosen sight where the room
  // allows one: the world prepares that arrival first.
  if (startAtCamp) renderer.anticipateArrival?.(spawnSite(spawnChoice));
  const character = characterModel(profile).key;
  if (onlineTitle && !skipGallery && !joined && renderer.loadProgress.phase !== 'ready') {
    screens.hide();
    stopInput();
    let entering = false;
    const cave = new LoadingCave(
      renderer,
      () => {
        // The press is the first gesture for audio. The gallery stays on screen
        // until the visitor's character stands in the world, so play is never
        // offered without its body; unrelated actors do not delay it.
        entering = true;
        startupMarks.mark('proceed', marks);
        void renderer.audio.start();
        cave.enterWorld();
        connect();
        void arriveFromGallery(cave);
      },
      () => {
        closeLoadingCave();
        // Leaving while entering also leaves the room being joined.
        if (entering) leaveToTitle();
        else showTitle();
      },
      { character },
    );
    loadingCave = renderer.loadingCave = cave;
    void (async () => {
      try {
        // The gallery shows the selected character, loading its verified template
        // once; the world's local player reuses it. Entry is offered once the
        // arrival's critical set and the character's held props are ready too.
        await cave.load();
        if (loadingCave !== cave) return;
        await Promise.all([renderer.startWorld(), renderer.prepareSelf(profile)]);
        if (loadingCave === cave) cave.markWorldReady();
      } catch (error) {
        if (loadingCave !== cave) return;
        closeLoadingCave();
        renderer.failWorld('洞窟または世界を読み込めませんでした。再読み込みしてください。', error);
      }
    })();
    return;
  }
  void renderer.startWorld?.();
  // Start the local character's template and held props now; its actor reuses
  // them, and the world reports a genuine failure when the actor needs them.
  renderer.prepareSelf?.(profile).catch(() => {});
  beginGame();
}
function beginGame() {
  void renderer.audio.start();
  showPlay();
  connect();
}
/** The game's screen. Its controls still wait for playReady(). */
function showPlay() {
  $('#retry-session')?.remove();
  screens.hide();
  document.body.classList.add('in-game');
  areaBanner.reset();
}
/** Replace the gallery with the game once the visitor's character stands in the
 * world (WorldRenderer.arrival): their body and floor, never unrelated actors. */
async function arriveFromGallery(cave: LoadingCave) {
  const marks = startupMarks.current;
  try {
    await renderer.arrival(() => loadingCave === cave && !manualLeave);
  } catch {
    // The visitor left, the join was refused or the world stopped: that path took over.
    return;
  }
  if (loadingCave !== cave) return;
  startupMarks.mark('arrival-ready', marks);
  closeLoadingCave();
  showPlay();
}
function leaveToTitle() {
  motionControls?.stop();
  manualLeave = true;
  clearTimeout(retry);
  send({ type: 'leave', keepSession: true });
  const previous = socket;
  socket = null;
  previous?.close();
  selfId = null;
  arrived = false;
  state = { players: [], resources: INITIAL_RESOURCES, camp: { ...CAMP }, npc: { ...NPC }, day: 1 };
  renderer.setState(state, selfId);
  connection(false, '未接続');
  updateHUD();
  document.body.classList.remove('in-game');
  showTitle();
}
async function openInvite() {
  openModal(
    `<span class="modal-illustration">${icon('people')}</span><h2>ひとつの火を、仲間と。</h2><p class="modal-intro">同じ部屋のリンクを仲間に渡して、一緒に谷を探索しよう。</p><div class="invite-code"><small>ROOM CODE</small><strong id="invite-code"></strong><span>現在の部屋の接続上限は ${hudPlayerLimit()}人</span></div><label>招待リンク<input id="invite-url" readonly aria-label="招待リンク"></label><button id="copy-invite" class="button button-accent wide">${icon('link')} 招待リンクをコピー</button><p id="invite-note" class="form-note">このPCと同じWi-Fi・LANにいる仲間が参加できます。インターネット越しの参加には、サーバーの公開が必要です。</p><button id="change-room" class="text-button">別の部屋に参加する ${icon('arrow')}</button>`,
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
  ['boat', '丸木舟', '水辺で出して乗れる'],
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
  boat: [{ label: '船を出す', action: 'launchBoat' }],
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
  return `<header class="inventory-header"><span class="portrait ${model.species} ${model.key}" role="img" aria-label="${model.name}"><i></i></span><div class="inventory-status"><h2>持ち物</h2><div id="inventory-energy-track" class="energy-track" role="progressbar" aria-label="体力" aria-valuemin="0" aria-valuemax="100"><span id="inventory-energy-bar" class="energy-fill"></span><em class="energy-label">${icon('leaf')}<b>体力</b><span id="inventory-energy-label"></span></em></div></div></header><div class="inventory-workspace"><section class="inventory-storage" aria-label="所持品"><div class="inventory-section-heading"><h3>持っているもの</h3></div><div class="inventory-grid"></div></section>${inventoryCrafting.markup()}</div>`;
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
  if (key === 'boat') return boatUI.launchReason();
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
      if (use.cooks) {
        const recipe = { cook: 'meat', cookFish: 'fish', cookShellfish: 'shellfish' }[use.action];
        document.querySelector<HTMLButtonElement>(`[data-craft="${recipe}"]`)?.click();
      } else {
        if (use.action === 'launchBoat') $('#modal').close();
        action(use.action);
      }
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
/** The inventory shortcut opens the bag directly in either menu layout. */
function openInventory() {
  openPauseMenu('inventory');
}
function tribeMarkup() {
  return `<h2>同じ火を囲む仲間。</h2><p class="modal-intro" id="tribe-summary">いま、この谷で暮らしている ${state.players.length} 人。</p><div id="tribe-list" class="tribe-list"></div><button id="tribe-invite" class="button button-accent wide">${icon('plus')} 仲間を招待する</button>`;
}
function openTribe() {
  openModal(tribeMarkup());
  updateModalHUD();
  $('#tribe-invite').onclick = openInvite;
}
function updateGamepadHints(active: boolean) {
  usingGamepad = active;
  if (active) touchControls?.setEnabled(false);
  inputCues?.device(controllerHints());
  updateHintLabels();
  updateHuntingHUD();
}
function updateHintLabels() {
  const pad = controllerHints();
  for (const [selector, label] of [
    ['#interaction-hint kbd', pad ? controllerLabels().right : 'E'],
    ['#ride-button kbd', pad ? controllerLabels().bottom : 'R'],
    ['#boat-board kbd', pad ? controllerLabels().bottom : 'B'],
    ['#chat-toggle kbd', pad ? '⌨' : 'Enter'],
  ])
    if ($(selector)) $(selector).textContent = label;
  const mapKey = $('#map-button .map-key');
  if (mapKey) mapKey.textContent = pad ? controllerLabels().map.split(' / ')[0] : 'M';
  $('#map-button').title = '世界地図';
  if (touchMode())
    $('#world').setAttribute(
      'aria-label',
      '氷河時代の3Dワールド。移動パッドで歩く・走る。視点は追従し、画面をなぞると見渡せます。行動ボタンを直接押せます。',
    );
  updatePromptBar();
}
function updatePromptBar() {
  $('#prompt-bar').innerHTML = keyPrompts(usingGamepad, fixedIdentity)
    .map((p) => `<span><kbd>${p.key}</kbd>${p.label}</span>`)
    .join('');
}
updateHintLabels();

function controllerRide() {
  if (preferredPet()) {
    petNearbyCompanion();
    return;
  }
  if (player()?.boatId) action('boardBoat');
  else if (player()?.mountId || hasCarryChoice()) ride();
  else if (!$('#boat-board').disabled) action('boardBoat');
  else ride();
}

let startAtCamp = false,
  persistentSession = false,
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
 * buttons below the tabs. The exhibition layout opens on Warp; the normal layout
 * opens on the bag with the first food card focused.
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
  $('#chat-messages')?.replaceChildren();
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

function openPauseMenu(tab?: string) {
  if (screens.active) return;
  const tabs: [string, string, string][] = fixedIdentity
    ? [
        ['warp', 'compass', 'ワープする'],
        ['character', 'people', 'キャラクターを変える'],
        ['inventory', 'bag', '持ち物'],
      ]
    : [
        ['inventory', 'bag', '持ち物'],
        ['warp', 'compass', 'ワープする'],
        ['mascots', 'people', '連れていく仲間'],
        ['settings', 'sound', '設定'],
      ];
  const exits: [string, string, string, () => void][] = [
    ...(caveTorchAvailable(player())
      ? [
          [
            'caveTorch',
            'sun',
            caveTorchLit(player()) ? '松明を消す' : '松明を灯す',
            () => {
              action('toggleCaveTorch');
              $('#modal').close();
            },
          ] as [string, string, string, () => void],
        ]
      : []),
    ...(!fixedIdentity
      ? [
          ['character', 'people', 'キャラクターを変える', openCharacterSwitchMenu] as [
            string,
            string,
            string,
            () => void,
          ],
          ['resume', 'compass', '探索に戻る', () => $('#modal').close()] as [
            string,
            string,
            string,
            () => void,
          ],
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
  const initialTab = tab ?? (fixedIdentity ? 'warp' : 'inventory');
  let pauseTab = tabs.some(([id]) => id === initialTab) ? initialTab : tabs[0][0];
  const menuButton = ([id, glyph, label]: readonly [string, string, string, ...unknown[]]) =>
    `<button class="button button-outline" data-controller-menu="${id}">${icon(glyph)}<span>${label}</span></button>`;
  const panel = (id: string, body: string) =>
    tabs.some(([key]) => key === id)
      ? `<section class="pause-panel" data-pause-panel="${id}" role="tabpanel" id="pause-panel-${id}" ${pauseTab === id ? '' : 'hidden'}>${body}</section>`
      : '';
  openModal(
    `<div class="pause-menu${fixedIdentity ? ' exhibition-menu' : ''}"><aside class="pause-rail"><nav class="pause-tabs" role="tablist" aria-label="メニューの項目">${tabs
      .map(
        ([id, glyph, label]) =>
          `<button type="button" class="pause-tab" role="tab" data-pause-tab="${id}" data-controller-menu="${id}" aria-selected="${pauseTab === id}" aria-controls="pause-panel-${id}">${icon(glyph)}<span>${label}</span></button>`,
      )
      .join(
        '',
      )}</nav><button type="button" class="pause-more button button-outline" aria-expanded="false" aria-controls="pause-menu-actions">その他の操作</button><div id="pause-menu-actions" class="pause-exits">${exits.map(menuButton).join('')}</div></aside><div class="pause-panels">${panel(
      'inventory',
      inventoryMarkup(),
    )}${panel('character', characterSwitchMarkup())}${panel('warp', exhibitionWarpMarkup())}${panel('mascots', mascotMenuMarkup(state))}${panel(
      'settings',
      `<h2>設定</h2><div class="settings-list">${audioSettingsMarkup(renderer.audio.settings)}<div class="settings-item"><div><strong>全画面表示</strong></div><button class="button button-outline" data-setting="fullscreen">${icon('expand')} 切り替え</button></div><div class="settings-item"><div><strong>視点</strong></div><div class="settings-buttons"><button class="button button-outline" data-setting="zoom-out">− 遠く</button><button class="button button-outline" data-setting="zoom-in">+ 近く</button><button class="button button-outline" data-setting="camera">${icon('target')} 視点を戻す</button></div></div><div class="settings-item"><div><strong>コントローラー</strong><p class="gamepad-connection" role="status">${usingGamepad ? '' : '未接続'}</p></div></div></div><p id="local-save-status" class="form-note" role="status" hidden></p>${localResetMarkup()}`,
    )}</div></div>`,
  );
  const root = $('#modal-body') as HTMLElement;
  const more = root.querySelector<HTMLButtonElement>('.pause-more')!;
  more.onclick = () => {
    const expanded = more.getAttribute('aria-expanded') !== 'true';
    more.setAttribute('aria-expanded', String(expanded));
    root.querySelector('.pause-rail')?.classList.toggle('pause-actions-open', expanded);
  };
  const controlsSetting = document.createElement('div');
  controlsSetting.className = 'settings-item';
  controlsSetting.innerHTML = `<div><strong>操作</strong></div><div class="settings-buttons" role="group" aria-label="操作モード"><button class="button button-outline" data-controls="normal" aria-pressed="${!easyControls}">通常</button><button class="button button-outline" data-controls="easy" aria-pressed="${easyControls}">かんたん・視点自動</button></div>`;
  if (touchMode()) {
    controlsSetting.querySelector('[data-controls="normal"]').textContent = 'タッチ・視点追従';
    const note = document.createElement('p');
    note.textContent =
      '移動パッドを浅く倒すと歩き、深く倒すと走ります。視点は移動に合わせて追従し、画面をなぞると見渡せます。';
    controlsSetting.firstElementChild.append(note);
    root.querySelector('.gamepad-connection')?.closest('.settings-item')?.remove();
  }
  root.querySelector('#pause-panel-settings .settings-list')?.prepend(controlsSetting);
  const cameraButtons = root.querySelector('[data-setting="camera"]')?.parentElement;
  const automaticCameraLabel = document.createElement('span');
  automaticCameraLabel.textContent = '自動';
  cameraButtons?.before(automaticCameraLabel);
  const updateCameraSetting = () => {
    if (cameraButtons) cameraButtons.hidden = assistedControls();
    automaticCameraLabel.hidden = !assistedControls();
  };
  updateCameraSetting();
  for (const button of controlsSetting.querySelectorAll<HTMLButtonElement>('[data-controls]')) {
    button.onclick = () => {
      clearMovementInput();
      easyControls = button.dataset.controls === 'easy';
      if (easyControls) renderer.endCompanionView();
      updateCameraSetting();
      try {
        localStorage.setItem(ASSISTED_CONTROLS_KEY, easyControls ? 'on' : 'off');
      } catch {
        /* Current visit still works. */
      }
      for (const option of controlsSetting.querySelectorAll<HTMLElement>('[data-controls]'))
        option.setAttribute(
          'aria-pressed',
          String((option.dataset.controls === 'easy') === easyControls),
        );
    };
  }
  const tabButtons = [...root.querySelectorAll<HTMLButtonElement>('.pause-tab')];
  const showTab = (id: string) => {
    pauseTab = id;
    closeItemActions();
    for (const tab of tabButtons)
      tab.setAttribute('aria-selected', String(tab.dataset.pauseTab === id));
    for (const section of root.querySelectorAll<HTMLElement>('.pause-panel'))
      section.hidden = section.dataset.pausePanel !== id;
    root.querySelector<HTMLElement>(`[data-pause-tab="${id}"]`)?.focus({ preventScroll: true });
    if (id === 'character')
      root
        .querySelector<HTMLElement>('#character-switch-form input:checked')
        ?.focus({ preventScroll: true });
    if (id === 'warp')
      root.querySelector<HTMLElement>('[data-warp-spawn]')?.focus({ preventScroll: true });
    gamepadControls?.suspend();
  };
  for (const tab of tabButtons) tab.onclick = () => showTab(tab.dataset.pauseTab!);
  for (const [id, , , handler] of exits)
    if ($(`[data-controller-menu="${id}"]`))
      $(`[data-controller-menu="${id}"]`).onclick = () => handler();
  const menuActions = {
    player,
    now: () => renderer.serverNow(),
    connected: () => joined,
    action,
    settle: () => gamepadControls?.suspend(),
  };
  if (fixedIdentity) bindCharacterSwitch(menuActions, false);
  bindExhibitionWarp(menuActions);
  updateModalHUD();
  inventoryCrafting.bind();
  if (!fixedIdentity) {
    bindMascotMenu(root, action);
    updateSaveStatus();
    $('[data-setting="sound"]').onclick = toggleSound;
    for (const input of root.querySelectorAll<HTMLInputElement>('[data-audio-volume]')) {
      input.oninput = () => {
        const key = input.dataset.audioVolume as 'ambience' | 'music' | 'effects';
        renderer.audio.setSettings({
          ...renderer.audio.settings,
          [key]: Number(input.value) / 100,
        });
        input.nextElementSibling.textContent = `${input.value}%`;
      };
    }
    $('[data-setting="fullscreen"]').onclick = toggleFullscreen;
    $('[data-setting="camera"]').onclick = () => {
      if (!assistedControls()) renderer.focusPlayer();
    };
    $('[data-setting="zoom-out"]').onclick = () => {
      if (!assistedControls()) renderer.adjustZoom(-0.15);
    };
    $('[data-setting="zoom-in"]').onclick = () => {
      if (!assistedControls()) renderer.adjustZoom(0.15);
    };
    if ($('[data-setting="reset-room"]')) $('[data-setting="reset-room"]').onclick = openRoomReset;
  }
  // The exhibition menu opens on its first tab; the bag shortcut still focuses a usable item.
  if (pauseTab === 'warp')
    root.querySelector<HTMLElement>('[data-pause-tab="warp"]')?.focus({ preventScroll: true });
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
  openModal(mapScreen(icon, fixedIdentity));
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
function toggleSound() {
  renderer.audio.setSettings({
    ...renderer.audio.settings,
    enabled: !renderer.audio.settings.enabled,
  });
  const button = $('[data-setting="sound"]');
  if (button) {
    const enabled = renderer.audio.settings.enabled;
    button.textContent = enabled ? 'オン' : 'オフ';
    button.setAttribute('aria-pressed', String(enabled));
  }
}
// Browsers require a real user gesture. A controller can join before that gesture arrives.
function unlockNatureAudio() {
  if (joined && renderer.audio.context?.state !== 'running') void renderer.audio.start();
}
document.addEventListener('pointerdown', unlockNatureAudio);
document.addEventListener('keydown', unlockNatureAudio);

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
$('#pet-rimo-button').onclick = petRimo;
$('#dismiss-rimo-button').onclick = dismissRimo;
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
/** The open contributors dialog's cave visit (also one the title shell opened). */
function bindContributorsVisit() {
  const visit = $('#contributors-cave');
  visit.onclick = () => {
    if (visit.disabled || renderUnavailable || loadingCave) return;
    visit.disabled = true;
    $('#modal').close();
    visitContributorsCave();
  };
}
function visitContributorsCave() {
  // Use the existing safe cave arrival and resume path, retaining possessions.
  spawnChoice = 'cave';
  startAtCamp = true;
  contributorsCavePending = true;
  enterGame(true);
}
$('#title-start').onclick = () => showSetup();
$('#title-contributors').addEventListener('click', () => {
  openModal(contributorsDialogMarkup(undefined, { links: onlineTitle }));
  bindContributorsVisit();
});
$('#title-fullscreen').onclick = toggleFullscreen;
document.addEventListener('fullscreenchange', () => {
  const active = !!document.fullscreenElement;
  $('#title-fullscreen').setAttribute('aria-pressed', String(active));
  $('#title-fullscreen').setAttribute('aria-label', active ? '全画面表示を終了' : '全画面表示');
});
$('#setup-back').onclick = () => (joined ? screens.hide() : showTitle());
bindSetupFlow({
  form: $('#setup-form'),
  spawnChoice: () => fixedIdentity,
  spawn: () => spawnChoice,
  settle: () => gamepadControls?.suspend(),
});
$('#setup-form').onsubmit = (e) => {
  e.preventDefault();
  // Only the final はい of the setup flow submits; a stray Enter elsewhere does nothing.
  if (!setupFlowOpen()) return;
  applyProfileForm(e.currentTarget);
  closeSetupFlow();
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
document.addEventListener('keydown', (e) => {
  if (loadingCave) return;
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
    chatUI?.dialog.open ||
    screens.active ||
    renderUnavailable ||
    // No action without the drawn local body, nor while the GPU context is lost.
    (joined && !playReady())
  )
    return;
  if (e.key === 'Escape' && joined) {
    e.preventDefault();
    if (renderer.endCompanionView()) return;
    openPauseMenu();
    return;
  }
  if (motionControls?.ownsInput) return;
  if (
    ['Enter', ' '].includes(e.key) &&
    (e.target as Element)?.closest<HTMLElement>('button,a,[role="button"]')
  )
    return;
  const k = movementKey(e);
  if (k === 'x' && !e.repeat) {
    e.preventDefault();
    if (assistedControls()) return;
    if (!renderer.endCompanionView()) renderer.viewCompanion();
    return;
  }
  if (
    !assistedControls() &&
    renderer.viewingCompanion &&
    ['+', '=', '-', 'Subtract', 'Add'].includes(e.key)
  ) {
    e.preventDefault();
    renderer.adjustZoom(e.key === '-' || e.key === 'Subtract' ? -0.15 : 0.15);
    return;
  }
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
  if (k === 'c') {
    e.preventDefault();
    orbBotUI.use();
  }
  if (k === 'z') {
    e.preventDefault();
    orbBotUI.cycle();
  }
  if (k === 'q') {
    e.preventDefault();
    orbBotUI.recall();
  }
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
  if (k === 'v') {
    e.preventDefault();
    petNearbyCompanion();
  }
  if (k === 't') {
    e.preventDefault();
    dismissNearbyCompanion();
  }
  if (k === 'l' && !e.ctrlKey && !e.metaKey && !e.altKey) {
    e.preventDefault();
    action('toggleCaveTorch');
  }
  if (isAttackShortcut(e)) {
    e.preventDefault();
    attack();
  }
  if (['1', '2', '3', '4'].includes(k))
    action(['gather', 'craft', 'contribute', 'trade'][Number(k) - 1]);
  if (k === 'enter' && !fixedIdentity) {
    e.preventDefault();
    chatUI?.setOpen(true);
    $('#chat-input').focus();
  }
  if (k === 'm') openMap();
  if (k === 'i') openInventory();
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
  menu: () =>
    chatUI?.dialog.open ? chatUI.dialog : $('#modal').open ? $('#modal') : screens.activeElement(),
  closeMenu: () => {
    if (chatUI?.dialog.open) chatUI.setOpen(false);
    else if ($('#modal').open) $('#modal').close();
    else if (screens.active === 'setup' && !setupFlowBack()) $('#setup-back').click();
  },
  cancelMenu: () => {
    if (chatUI?.dialog.open) return chatUI.setOpen(false);
    if (cancelRoomReset()) return;
    if (closeCharacterConfirm()) {
      gamepadControls?.suspend();
      return;
    }
    if (screens.active === 'setup' && setupFlowBack()) return;
    if (closeItemActions()) return;
    if ($('#modal').open) $('#modal').close();
    else if (screens.active === 'setup') $('#setup-back').click();
  },
  canPlay: () =>
    joined &&
    playReady() &&
    !renderUnavailable &&
    !screens.active &&
    !chatUI?.dialog.open &&
    !!player() &&
    !player()?.downedUntil,
  onStop: () => {
    // A controller losing focus/connection cannot suspend the current camera
    // owner. Camera input handles its own menus, focus and text-field checks.
    if (!motionControls?.ownsInput) stopInput();
  },
  onActivity: updateGamepadHints,
  onFrame: (pad, _frame, mode) => {
    if (setConnectedController(pad?.id ?? null, fixedIdentity)) {
      inputCues?.device(controllerHints());
      updateHintLabels();
    }
    inputCues?.frame(pad, mode === 'game');
  },
  onMapInput: (frame, dt) =>
    frame.actions.includes('map') ? openMap() : mapInput?.input(frame, dt),
  onLook: (x, y, dt) => {
    if (!assistedControls()) renderer.rotateCamera(x * dt * 2.4, y * dt * 1.5);
  },
  onAction: (command) => {
    if (motionControls?.ownsInput && !['menu', 'inventory', 'map', 'cancel'].includes(command))
      return;
    switch (command) {
      case 'bot':
        orbBotUI.use();
        break;
      case 'recallBots':
        orbBotUI.recall();
        break;
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
        if (renderer.endCompanionView()) break;
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
      case 'center':
        if (assistedControls()) break;
        if (!renderer.endCompanionView()) renderer.focusPlayer();
        break;
      case 'zoomIn':
        if (assistedControls()) break;
        if (!renderer.viewCompanion()) renderer.adjustZoom(0.15);
        break;
      case 'zoomOut':
        if (assistedControls()) break;
        renderer.adjustZoom(-0.15);
        break;
    }
  },
});
const handFeature = createHandControls($('.game-viewport'), {
  stop: clearMovementInput,
  updateInput: updateMovementInput,
  canStart: () =>
    joined &&
    !renderUnavailable &&
    !screens.active &&
    !$('#modal').open &&
    !document.hidden &&
    !player()?.downedUntil,
  begin: () => {
    renderer.endCompanionView();
    clearMovementInput();
    renderer.cancel?.();
  },
});
motionControls = handFeature?.controls;
function touchPlayable(command?: TouchAction) {
  return (
    joined &&
    playReady() &&
    !renderUnavailable &&
    !screens.active &&
    !$('#modal').open &&
    !document.hidden &&
    document.hasFocus() &&
    !!player() &&
    (!player()?.downedUntil || ['menu', 'map', 'chat', 'mascots', 'bag'].includes(command ?? '')) &&
    !motionControls?.ownsInput &&
    ($('#chat-content')?.hidden ?? true) &&
    !document.activeElement?.closest('input,textarea,select,[contenteditable]')
  );
}
touchControls = new TouchControls($('.game-viewport'), {
  icon,
  chat: !fixedIdentity,
  available: touchPlayable,
  perform: performCue,
  move: updateMovementInput,
  beginMove: () => {
    renderer.endCompanionView();
    touchYaw = renderer.yaw;
    $('#world').focus({ preventScroll: true });
  },
  changed: () => {
    chatUI?.syncMode();
    clearMovementInput();
    inputCues?.hide();
    updateHintLabels();
    updateHuntingHUD();
  },
});
renderer.manualInputAllowed = () =>
  joined &&
  playReady() &&
  !renderUnavailable &&
  !screens.active &&
  !$('#modal').open &&
  !chatUI?.dialog.open &&
  !player()?.downedUntil &&
  !motionControls?.ownsInput;
renderer.manualCameraAllowed = () => !joined || !assistedControls();
renderer.onFrameTiming = (ms) => motionControls?.camera.metrics.record('renderFrameMs', ms);
/** Read-only aggregate diagnostics. No images, body coordinates or event consumption. */
export function motionDiagnostics() {
  if (!motionControls) return { state: 'UNAVAILABLE' };
  return {
    state: motionControls.input.state,
    options: {
      delegate: motionControls.camera.options.delegate,
      hz: motionControls.camera.options.hz,
    },
    metrics: motionControls.camera.metrics.summary(performance.now()),
  };
}
/** Starts a new aggregate-only performance window without changing input or calibration. */
export function resetMotionMetrics() {
  motionControls?.camera.resetMetrics();
}
let lastMoveSent = 0;
const motionPetHold = handFeature?.petHold;
function assistedMovement(
  forward: number,
  turn: number,
  running: boolean,
  now: number,
  active: boolean,
) {
  const me = player();
  if (!me) return;
  const locked =
    me.carrierId ||
    me.downedUntil ||
    (me.attackSequence > 0 && renderer.serverNow() - me.attackAt < attackProfile(me).durationMs);
  if (!active || locked) forward = turn = 0;
  const identity = `${me.id}:${me.warpSequence ?? 0}:${me.mountId ?? ''}:${me.boatId ?? ''}:${me.carrierId ?? ''}:${characterModel(me).key}`;
  const { dx, dz, facing } = assistedNavigation.step(forward, turn, now, identity, me.facing);
  renderer.setAutomaticCamera(assistedNavigation.heading, active && !locked);
  if (forward || turn) renderer.endCompanionView();
  renderer.prediction?.setInput(dx, dz, running, now, facing);
  const direction = `${dx},${dz}${facing === undefined ? '' : `,${facing}`}`;
  if (
    (direction === '0,0' && assistedDirection !== '0,0') ||
    (direction !== '0,0' && assistedDirection === '0,0') ||
    ((forward || turn) && now - lastMoveSent >= (multiplayer.movementRefreshMs || 70))
  ) {
    send({ type: 'move', dx, dz, running, ...(facing === undefined ? {} : { facing }) });
    lastMoveSent = now;
    assistedDirection = direction;
  }
  if (running !== lastGait) {
    send({ type: 'gait', running });
    lastGait = running;
  }
}
function updateMovementInput() {
  const source = motionControls?.ownsInput ? 'hands' : easyControls ? 'easy' : '';
  if (source !== assistedSource) {
    assistedSource = source;
    $('#world').setAttribute(
      'aria-label',
      source
        ? '氷河時代の3Dワールド。前後に進み、左右で曲がります。視点は自動です。'
        : touchMode()
          ? '氷河時代の3Dワールド。移動パッドで歩く・走る。視点は追従し、画面をなぞると見渡せます。行動ボタンを直接押せます。'
          : '氷河時代の3Dワールド。WASDまたは左スティックで移動。右スティックまたはドラッグで見渡します。',
    );
    assistedNavigation.reset();
    assistedDirection = '0,0';
    movementCommands.reset();
    attackAssist.reset();
    petAssist.reset();
    interactionAssist.reset();
    renderer.setAssistMarker('attack', null);
    renderer.setAssistMarker('interact', null);
    if (!source) renderer.setAutomaticCamera(null);
  }
  renderer.setTouchCamera?.(touchMode());
  if (player()?.downedUntil || !joined || !playReady() || renderUnavailable) {
    touchControls?.stop();
    renderer.setTouchMovement?.(0, 0);
    motionControls?.pause('今は操作できません。操作可能になると自動再開します。');
    keys.clear();
    movementCommands.reset();
    assistedNavigation.reset();
    renderer.setAutomaticCamera(null);
    renderer.setAssistMarker('attack', null);
    renderer.setAssistMarker('interact', null);
    return;
  }
  let sx = 0,
    sy = 0;
  const gameFocused =
    !document.hidden &&
    document.hasFocus() &&
    !$('#modal').open &&
    !chatUI?.dialog.open &&
    !screens.active;
  const focusedField = document.activeElement?.closest('input,textarea,select,[contenteditable]');
  const canMove = gameFocused && !focusedField;
  if (motionControls?.ownsInput) {
    if (!gameFocused || (focusedField && !motionControls.root.contains(focusedField)))
      motionControls.pause();
    const now = performance.now(),
      input = motionControls.input;
    let intent = input.read(now);
    const movement = {
      offset: input.movementOffset,
      push: input.movementPush,
      roll: input.movementRoll,
    };
    const petting =
      state.mae?.petPlayerId === selfId ||
      state.kohaku?.petPlayerId === selfId ||
      state.maruimo?.petPlayerId === selfId ||
      state.rimoNeko?.petPlayerId === selfId ||
      state.companion524?.petPlayerId === selfId ||
      !!pettingFriend(state.friends, selfId) ||
      !!pettingOrbBot(state.orbBots, selfId);
    const target = interactionTarget(preferredPet(), nearby());
    motionControls.interactionHint =
      petting || motionPetHold.active
        ? 'なでています'
        : target
          ? `${input.actionHand === 'left' ? '左手' : '右手'}を低く横ふり → ${target.label}`
          : '';
    motionControls.attackStatus =
      attackBlockReason(player(), renderer.serverNow()) || '攻撃できます';
    for (const event of motionControls.input.consumeActions(now)) {
      if (event.action === 'attack') {
        const blocked = attackBlockReason(player(), renderer.serverNow());
        if (!blocked) {
          motionPetHold.reset();
          attack();
        }
        motionControls.reportAction(
          blocked || '銃の形を認識 → 攻撃。指を開いてから、もう一度銃の形へ。',
          !blocked,
        );
      } else if (event.action === 'jump') {
        const allowed = canStartJump(player(), renderer.serverNow());
        if (allowed) {
          motionPetHold.reset();
          jump();
        }
        motionControls.reportAction(
          allowed
            ? '上げる動きを認識 → ジャンプ。下ろすと次を出せます。'
            : '今はジャンプできません。着地や動作の終了を待ってください。',
          allowed,
        );
      } else {
        if (petting || motionPetHold.active) {
          motionControls.reportAction('撫でています。なで続けなくても大丈夫です。', true);
          continue;
        }
        if (target) {
          if (
            target.action === 'petRimo' ||
            target.action === 'petMae' ||
            target.action === 'petKohaku' ||
            target.action === 'petMaruimo' ||
            target.action === 'petFriend' ||
            target.action === 'pet524' ||
            target.action === 'petBot' ||
            target.action === 'petBots'
          ) {
            motionPetHold.begin(input.sessionId, now, movement);
            // Stop before the action reaches the server, so the first pet tick is stationary.
            renderer.prediction?.stop();
            send({ type: 'move', dx: 0, dz: 0, running: false });
            assistedDirection = '0,0';
            lastMoveSent = now;
          }
          action(target.action, target.targetId);
        }
        motionControls.reportAction(
          target
            ? `横なでを認識 → ${target.label}`
            : '横なでは認識しました。近くに相手がいません。',
          !!target,
        );
      }
    }
    intent = motionPetHold.filter(intent, movement, petting, now);
    assistedMovement(
      intent.forward,
      intent.turn,
      tuning.alwaysRun,
      now,
      gameFocused && intent.active,
    );
    assistedAttackTarget();
    if (!gameFocused || !intent.active) renderer.setAssistMarker('interact', null);
    motionControls.camera.applied(now);
    return;
  }
  motionPetHold?.reset();
  if (canMove) {
    if (keys.has('w') || keys.has('arrowup')) sy--;
    if (keys.has('s') || keys.has('arrowdown')) sy++;
    if (keys.has('a') || keys.has('arrowleft')) sx--;
    if (keys.has('d') || keys.has('arrowright')) sx++;
  }
  const motion =
    touchMode() && touchControls
      ? canMove && touchPlayable()
        ? touchControls.movement
        : { x: 0, y: 0, running: false }
      : combineMovement(
          sx,
          sy,
          wantsToRun(),
          canMove ? gamepadControls.movement : { x: 0, y: 0, running: false },
        );
  if (easyControls) {
    assistedMovement(
      -motion.y,
      motion.x,
      motion.running || tuning.alwaysRun,
      performance.now(),
      canMove,
    );
    assistedAttackTarget();
    if (canMove) nearby();
    else renderer.setAssistMarker('interact', null);
    return;
  }
  if (motion.x || motion.y) renderer.endCompanionView();
  const running = motion.running || tuning.alwaysRun;
  if (running !== lastGait) {
    send({ type: 'gait', running });
    lastGait = running;
  }
  const { dx, dz } = touchMode()
    ? movementFromCamera(motion.x, motion.y, touchYaw)
    : renderer.getMovementDirection(motion.x, motion.y);
  renderer.setTouchMovement?.(dx, dz);
  const changed = movementCommands.direction !== `${dx},${dz}`,
    command = movementCommands.next({ dx, dz, running });
  const now = performance.now();
  if (renderer.prediction?.enabled) renderer.prediction.setInput(dx, dz, running, now);
  if (
    command &&
    ((!multiplayer.movementRefreshMs && multiplayer.mode !== 'lan') ||
      changed ||
      now - lastMoveSent >= (multiplayer.movementRefreshMs || 70))
  ) {
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
  inputCues?.destroy();
  touchControls?.destroy();
  motionControls?.destroy();
  screens.destroy();
  closeLoadingCave();
  renderer.destroy();
});
// The title screen slowly pans the camera around the world until play begins.
let titleClock = 0;
function titleIdle(now: number) {
  const audioStatus = document.querySelector('[data-audio-status]');
  if (audioStatus && audioStatus.textContent !== renderer.audio.status)
    audioStatus.textContent = renderer.audio.status;
  if (screens.active === 'title')
    renderer.rotateCamera(Math.min(0.05, (now - titleClock) / 1000) * 0.05, 0);
  titleClock = now;
  requestAnimationFrame(titleIdle);
}
requestAnimationFrame(titleIdle);
/** The title once this module owns it. A title shell's last pending action is
 * performed here exactly once (the handoff consumed it); an open contributors
 * dialog stays open with this module's cave visit. */
function resumeTitle(handoff: TitleHandoff | null) {
  if (handoff?.contributorsOpen) {
    screens.show('title');
    bindContributorsVisit();
    return;
  }
  showTitle();
  if (handoff?.intent === 'start') showSetup();
  else if (handoff?.intent === 'contributors-cave' && !renderUnavailable && !loadingCave)
    visitContributorsCave();
}
startupMarks.page('game-module-ready');
if (query.get('autostart') === '1') {
  // QA scripts and local shortcuts skip the title and setup screens.
  enterGame(true);
} else resumeTitle(titleHandoff);
