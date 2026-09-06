import { normalizeCharacter, characterModel } from '/shared/characters.mjs';
import { attackProfile } from '/shared/combat-profiles.mjs';
import { characterChoicesMarkup, bindCharacterSelection } from './character-selection.js';
import { WorldRenderer } from './world3d.js';
import { riverX } from '/shared/terrain.mjs';
import { WORLD, CAMP, NPC, INITIAL_RESOURCES } from '/shared/world.mjs';
import { HUNTING, nearestCookingFire } from '/shared/hunting.mjs';
import { inventoryCounts, selectedCombatTarget, huntInteraction, attackReady, approachAnimal, approachEnemyGround } from './hunting-ui.js';
import { canStartAttack, isAttackShortcut, MovementCommands } from './combat-input.js';
import { inAttackArc } from '/shared/combat.mjs';
import { ENEMY_GROUNDS } from '/shared/scenery-layout.mjs';
import { playerDamageEvent } from './enemy-state.js';
import { BIOMES, biomeAt, JOURNEY_STOPS } from '/shared/biomes.mjs';
import { drawWorldMap, mapProjection } from './world-map.js';

const icons = {
  katana: '<path d="m4 21 4-4m-2-3 4 4M8 15C15 10 20 5 21 2c-4 1-9 6-13 11Z"/>',
  magic: '<path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2Z"/><path d="m20 3 1 1M3 20l1 1"/>',
  spear: '<path d="m4 21 12-14m-2 0 6-5-1 8-5-3Z"/>',
  meat: '<path d="M5 6c3-3 9-3 12 0s4 9 0 12-10 3-13-1S2 9 5 6Z"/><path d="M7 8c2-2 6-2 8 0s2 6 0 8-6 2-8 0-2-6 0-8Z"/>',
  flame: '<path d="M12 3c1 5 7 7 7 12a7 7 0 0 1-14 0c0-3 2-5 4-7-1 4 2 5 3-5Z"/><path d="M10 17c0-2 2-3 2-5 3 3 4 6 0 7-1 0-2-1-2-2Z"/>',
  compass: '<circle cx="12" cy="12" r="9"/><path d="m16 8-2 6-6 2 2-6 6-2Z"/>',
  bag: '<path d="M8 7V5a4 4 0 0 1 8 0v2M6 7h12l2 14H4L6 7Z"/><path d="M8 13h8v5H8z"/>',
  people: '<circle cx="9" cy="8" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m1 4a5 5 0 0 1 4 5"/>',
  book: '<path d="M3 4h7l2 2 2-2h7v16h-7l-2 1-2-1H3V4Zm9 2v15M6 8h3m-3 4h3m6-4h3m-3 4h3"/>',
  arrow: '<path d="M5 12h14m-5-5 5 5-5 5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  wood: '<path d="m4 16 12-12 5 5L9 21 4 16Z"/><ellipse cx="6.5" cy="18.5" rx="3" ry="2.5" transform="rotate(45 6.5 18.5)"/><path d="m11 13 5-5m-3 7 5-5"/>',
  stone: '<path d="m3 16 4-10 10-2 5 10-6 7H7l-4-5Z"/><path d="m7 6 5 7 5-9m-5 9 4 8m-4-8-9 3m9-3 10 1"/>',
  berry: '<circle cx="8" cy="14" r="4"/><circle cx="16" cy="14" r="4"/><circle cx="12" cy="18" r="4"/><path d="M12 11V5m0 3C5 9 6 2 6 2s7 0 6 6Zm0 0c0-6 7-6 7-6s0 6-7 6"/>',
  axe: '<path d="m5 22 12-17m-5 4 5 4 5-7-7-5-3 8Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 1v2m0 18v2M1 12h2m18 0h2M4 4l2 2m12 12 2 2M4 20l2-2M18 6l2-2"/>',
  sound: '<path d="M11 4 5 9H2v6h3l6 5V4Zm4 4a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  muted: '<path d="M11 4 5 9H2v6h3l6 5V4Zm5 5 6 6m0-6-6 6"/>',
  expand: '<path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6"/>',
  target: '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2"/><path d="M12 1v4m0 14v4M1 12h4m14 0h4"/>',
  chat: '<path d="M21 15a3 3 0 0 1-3 3H9l-6 4V6a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v9Z"/><path d="M7 8h10M7 12h7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  leaf: '<path d="M20 3C4 1 1 13 8 17c7 5 14-4 12-14Z"/><path d="M4 22 16 8"/>',
  link: '<path d="m10 14 4-4m-6 6-2 2a4 4 0 0 1-6-6l5-5a4 4 0 0 1 6 0m2 1 2-2a4 4 0 0 1 6 6l-5 5a4 4 0 0 1-6 0" transform="translate(1 -1)"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3v.1"/>',
  exchange: '<path d="M3 7h17l-4-4m4 14H3l4 4M20 7l-4 4M3 17l4-4"/>',
  wave: '<path d="M5 12V8a2 2 0 0 1 3 0V4a2 2 0 0 1 3 0v7-8a2 2 0 0 1 3 0v8-6a2 2 0 0 1 3 0v8l2-3c2-2 4 0 3 2l-4 8c-4 4-13 1-13-4v-4Z"/>',
};
const icon = (name, cls = '') => `<svg class="icon ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.leaf}</svg>`;
const GAME_TITLE = 'CRO-MAGNON';
const $ = (s) => document.querySelector(s);
const readSaved = (key, fallback) => { try { return localStorage.getItem(key) || fallback; } catch { return fallback; } };
const save = (key, value) => { try { localStorage.setItem(key, value); } catch {} };
const query = new URLSearchParams(location.search);
let profile = { name: readSaved('cro-name', `旅人${Math.floor(Math.random() * 900 + 100)}`), ...normalizeCharacter({ species: readSaved('cro-species', 'cro'), gender: readSaved('cro-gender', 'female') }), room: (query.get('room') || readSaved('cro-room', 'EMBER')).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 16) || 'EMBER' };
let state = { players: [], resources: INITIAL_RESOURCES, camp: { ...CAMP }, npc: { ...NPC }, day: 1 };
let selfId = null, socket, joined = false, retry = null, manualLeave = false, ping = 0, gathered = 0, lastInventory = 0;
let audioContext = null, audioTimer = null, soundEnabled = false;
const keys = new Set();
const blockedMovementKeys = new Set();
const movementCommands = new MovementCommands();
let selectedAnimalId = null, stateReceivedAt = performance.now(), hurtUntil = 0;

$('#app').innerHTML = `
  <aside class="sidebar">
    <a class="brand" href="/" aria-label="${GAME_TITLE} ホーム"><span class="brand-mark">${icon('flame')}</span><span>${GAME_TITLE}<small>MULTIPLAYER</small></span></a>
    <div class="world-selector"><span class="world-symbol">Ⅰ</span><div>はじまりの世界<small><i class="status-dot"></i> 5人で紡ぐ、小さな物語</small></div><span class="tiny-tag">α</span></div>
    <p class="section-label">YOUR JOURNEY</p>
    <nav class="navigation" aria-label="メインメニュー">
      <button class="nav-item active" data-panel="explore">${icon('compass')}<span>世界を探索</span><span class="nav-dot"></span></button>
      <button class="nav-item" data-panel="inventory">${icon('bag')}<span>もちもの</span><span id="bag-count" class="nav-count">0</span></button>
      <button class="nav-item" data-panel="tribe">${icon('people')}<span>部族の仲間</span><span id="tribe-count" class="nav-count">0 / 5</span></button>
      <button class="nav-item" data-panel="journal">${icon('book')}<span>旅の手帳</span></button>
    </nav>
    <div class="sidebar-divider"></div>
    <div class="section-heading"><p class="section-label">OUR FIRST FIRE</p><span id="quest-count">0 / 3</span></div>
    <h2 class="quest-title">ここから、暮らしが始まる。</h2>
    <div class="quest-list">
      <div class="quest" id="quest-gather"><span class="quest-check">1</span><div><strong>森の恵みを集める</strong><p>木や石、ベリーを3つ採集</p><div class="progress-track"><span id="gather-progress"></span></div></div></div>
      <div class="quest" id="quest-craft"><span class="quest-check">2</span><div><strong>はじめての道具</strong><p>木材3・石2で石斧をつくる</p></div></div>
      <div class="quest" id="quest-camp"><span class="quest-check">3</span><div><strong>みんなの火を育てる</strong><p>拠点に木材12・石6を届ける</p></div></div>
    </div>
    <div class="camp-card"><div class="camp-card-top"><span class="camp-icon">${icon('flame')}</span><div><strong id="camp-name">小さな野営地</strong><small id="camp-level">CAMP LEVEL 0</small></div><span class="camp-spark">✦</span></div><div class="camp-stats"><span>${icon('wood')} <b id="camp-wood">0</b><em>/ 12</em></span><span>${icon('stone')} <b id="camp-stone">0</b><em>/ 6</em></span></div><button id="go-camp" class="camp-link">焚き火のそばへ ${icon('arrow')}</button></div>
    <div class="sidebar-bottom"><button id="help-button" class="help-link">${icon('help')} 遊びかた <kbd>?</kbd></button><button id="profile-button" class="profile-card"><span class="portrait cro" id="my-portrait"><i></i></span><span><strong id="profile-name"></strong><small id="profile-species">クロマニョン人</small></span><span class="profile-edit">•••</span></button><div class="build-label"><span>ALPHA 0.1</span><span>MADE FOR TOGETHER</span></div></div>
  </aside>
  <main class="main">
    <header class="topbar"><div class="breadcrumb"><span>世界</span><span>/</span><strong>五つの大地</strong><span class="live-tag">LIVE</span></div><div class="topbar-actions"><button id="room-button" class="room-button">${icon('people')}<span id="room-label"></span><span id="online-count">0/5</span></button><button id="invite-button" class="button button-accent">${icon('plus')} 仲間を招待</button></div></header>
    <section class="game-viewport" aria-label="${GAME_TITLE} ゲーム画面">
      <canvas id="world" aria-label="五つの地域がつながる3Dワールド。WASDで歩行、Shiftで走行、ドラッグでカメラ回転、ホイールで距離を調整。地面クリックでも移動できます。" tabindex="0"></canvas>
      <div class="tps-reticle" aria-hidden="true"><i></i></div>
      <div class="camera-badge"><span class="status-dot"></span> TPS <span>肩越し視点</span></div>
      <div class="scene-shade"></div>
      <div id="damage-flash" class="damage-flash" aria-hidden="true" hidden></div>
      <div id="combat-status" class="combat-status" role="status" hidden></div>
      <div class="location-title"><div class="eyebrow"><span></span> はじまりの谷</div><h1>${GAME_TITLE}</h1><p>まだ名前のない世界で、今日を生きよう。</p><div class="location-meta"><span>${icon('leaf')} 針葉樹の森</span><span class="meta-divider"></span><span>${icon('sun')} <b id="day-label">1日目</b> · 穏やかな朝</span></div></div>
      <div class="map-hud"><button id="map-button" class="minimap-button" aria-label="世界地図を開く"><canvas id="minimap" width="160" height="115"></canvas><span class="map-north">N</span><span class="map-caption">VALLEY 01 ${icon('expand')}</span></button><div class="connection"><i class="status-dot" id="connection-dot"></i><span id="connection-label">接続中…</span><span id="ping-label">— ms</span></div></div>
      <div class="discovery-card hunting-card" id="discovery-card"><div><small>OPEN MEADOW · みんなで狩る</small><strong id="hunt-target-name">草原のマンモス</strong><progress id="hunt-health" max="100" value="100" aria-label="マンモスの体力"></progress><p id="hunt-target-note">開けた草原でマンモスを探そう。</p></div><button id="go-hunt" title="マンモスの近くへ移動" aria-label="マンモスの近くへ移動">${icon('arrow')}</button></div>
      <div class="scene-tools"><button id="sound-button" class="icon-button" aria-label="環境音をオン" title="環境音">${icon('muted')}</button><button id="zoom-out" class="icon-button" aria-label="縮小">−</button><button id="zoom-in" class="icon-button" aria-label="拡大">+</button><button id="focus-button" class="icon-button" aria-label="自分の位置へ">${icon('target')}</button><button id="fullscreen-button" class="icon-button" aria-label="全画面表示">${icon('expand')}</button></div>
      <div id="toast-stack" class="toast-stack" aria-live="polite"></div>
      <div class="chat-panel"><button class="chat-heading" id="chat-toggle">${icon('chat')}<strong>焚き火の会話</strong><span>部族</span><span class="chat-collapse">−</span></button><div id="chat-content"><div id="chat-messages" class="chat-messages" role="log" aria-live="polite"><p class="chat-system">この谷での物語が、ここから始まります。</p></div><form id="chat-form"><input id="chat-input" maxlength="180" placeholder="仲間に話しかける…" aria-label="チャットメッセージ" autocomplete="off"><button aria-label="メッセージを送信" type="submit">${icon('arrow')}</button></form></div></div>
      <div class="player-hud"><div class="energy-label"><span>${icon('leaf')} 元気</span><span id="energy-label">100 / 100</span></div><div class="energy-track"><span id="energy-bar"></span></div></div>
      <div class="hotbar-wrap"><div class="interaction-hint" id="interaction-hint"><kbd>E</kbd><span>近くのものを調べる</span></div><div class="hotbar"><div class="resource-slots"><button class="resource-slot" data-inventory="wood" aria-label="木材のもちもの"><kbd>木材</kbd><span class="resource-icon wood">${icon('wood')}</span><b id="wood-count">0</b></button><button class="resource-slot" data-inventory="stone" aria-label="石のもちもの"><kbd>石</kbd><span class="resource-icon stone">${icon('stone')}</span><b id="stone-count">0</b></button><button class="resource-slot" id="eat-button" aria-label="ベリーを食べて元気を回復"><kbd>ベリー</kbd><span class="resource-icon berry">${icon('berry')}</span><b id="berry-count">0</b></button></div><div class="hotbar-divider"></div><button class="action-slot selected" data-action="gather" title="採集する [1]"><kbd>1</kbd>${icon('leaf')}<span>採集</span></button><button class="action-slot" data-action="craft" title="木材3・石2で石斧を作る [2]"><kbd>2</kbd>${icon('axe')}<span>つくる</span></button><button class="action-slot" data-action="contribute" title="焚き火の近くで資材を届ける [3]"><kbd>3</kbd>${icon('flame')}<span>届ける</span></button><button class="action-slot" data-action="trade" title="オルの近くで物々交換 [4]"><kbd>4</kbd>${icon('exchange')}<span>交換</span></button><button id="run-button" class="action-slot" aria-label="走行モード" aria-pressed="false" title="走る／歩く（Shiftを押している間も走る）"><kbd>Shift</kbd>${icon('arrow')}<span>走る</span></button></div><div class="controls-caption"><span><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 移動</span><i>·</i><span>地面をクリックしても移動できます</span></div></div>
    </section>
    <footer class="statusbar"><span><i class="status-dot"></i> 同じ火を囲む、同じ世界。</span><span id="status-tip">ひとりでも、仲間とでも。あなたのペースで。</span><button id="wave-button">${icon('wave')} 手をふる</button></footer>
  </main>
  <dialog id="modal"><div class="modal-top"><span class="eyebrow">${GAME_TITLE} · FIELD NOTES</span><button id="modal-close" class="icon-button" aria-label="閉じる">${icon('close')}</button></div><div id="modal-body"></div></dialog>`;

function showRenderError(text) {
  if ($('#render-error')) return;
  const message=document.createElement('div');message.id='render-error';message.className='render-error';
  const heading=document.createElement('strong');heading.textContent='3D画面を表示できません';
  const detail=document.createElement('p');detail.textContent=text;
  const button=document.createElement('button');button.className='button button-accent';button.textContent='再読み込み';button.onclick=()=>location.reload();message.append(heading,detail,button);$('.game-viewport').append(message);
}
let runMode = false;
const wantsToRun = () => runMode || keys.has('shift');
let lastGait = false;
let renderer;
try {
  renderer = new WorldRenderer($('#world'), { onMoveTarget: (x, z) => { if (!joined) return notify('接続を確認してください。', 'error'); if(player()?.downedUntil)return;sendMoveTarget(x,z); }, onAnimal: interactAnimal, onError: showRenderError });
} catch (error) {
  console.error('3D renderer could not initialize:', error);
  showRenderError('WebGL 2対応ブラウザで開き、ハードウェアアクセラレーションが有効か確認してください。');
  renderer = { setState(){},setEmote(){},focusPlayer(){},adjustZoom(){},destroy(){},getMovementDirection(){return {dx:0,dz:0};} };
}
document.body.classList.add('tps-mode');
$('.hotbar-wrap').insertAdjacentHTML('afterbegin', `<div class="hunt-controls"><button id="attack-button" class="hunt-button attack-button" title="槍で攻撃 [F / 5]">${icon('spear')}<kbd>F</kbd><span>槍で攻撃</span></button><button id="meat-inventory" class="hunt-button meat-counts" title="生肉は焚き火で焼いてから食べられます">${icon('meat')}<span>生 <b id="rawMeat-count">0</b> / 焼 <b id="cookedMeat-count">0</b></span></button><button id="cook-button" class="hunt-button" title="近くの焚き火で肉を焼く">${icon('flame')}<span>焼く</span></button><button id="eat-meat-button" class="hunt-button" title="焼き肉で元気を45回復">食べる</button></div><div id="cooking-status" class="cooking-status" hidden><span id="cooking-label">肉を焼いています…</span><progress id="cooking-progress" max="1" value="0" aria-label="肉を焼く進み具合"></progress><button id="cancel-cook">中止</button></div>`);
$('.controls-caption>span:last-child').textContent='Shiftで走る · ドラッグで視点回転';
$('#discovery-card').insertAdjacentHTML('beforeend', `<button id="go-enemy" class="enemy-link" hidden>白羽の呪術師へ ${icon('arrow')}</button>`);
if(matchMedia('(max-width: 760px)').matches){$('#chat-content').hidden=true;$('.chat-collapse').textContent='+';}
renderer.setState(state, selfId);
$('#profile-name').textContent = profile.name;
$('#room-label').textContent = profile.room;

function send(message) { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message)); }
function sendMoveTarget(x,z) { movementCommands.reset();send({ type:'target',x,z,running:wantsToRun() }); }
function notify(text, tone = 'info') {
  const toast = document.createElement('div'); toast.className = `toast ${tone}`;
  const mark = document.createElement('span'); mark.innerHTML = icon(tone === 'success' ? 'check' : 'leaf');
  const label = document.createElement('span'); label.textContent = text; toast.append(mark, label);
  $('#toast-stack').append(toast); setTimeout(() => toast.remove(), 4500);
  if ($('#toast-stack').children.length > 3) $('#toast-stack').firstChild.remove();
}
function addChat(message) {
  const p = document.createElement('p');
  if (message.system) { p.className = 'chat-system'; p.textContent = message.text; }
  else { const name = document.createElement('strong'); name.textContent = `${message.name} `; p.append(name, document.createTextNode(message.text)); }
  const box = $('#chat-messages'); box.append(p); while (box.children.length > 40) box.firstChild.remove(); box.scrollTop = box.scrollHeight;
}
function connection(connected, label) {
  joined = connected; $('#connection-dot').classList.toggle('offline', !connected); $('#connection-label').textContent = label;
}
function connect() {
  clearTimeout(retry); manualLeave = false; selfId = null; connection(false, '接続中…');
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws?${new URLSearchParams(profile)}`); socket = ws;
  ws.addEventListener('message', ({ data }) => {
    if (ws !== socket) return;
    let message; try { message = JSON.parse(data); } catch { return; }
    if (message.type === 'welcome') { selfId = message.id; profile.room = message.room; save('cro-room', profile.room); $('#room-label').textContent = profile.room; connection(true, 'オンライン'); notify('谷へようこそ。近くの木や石を集めてみよう。', 'success'); }
    if (message.type === 'state') { const previous=player();state = { ...state, ...message }; stateReceivedAt=performance.now();if(playerDamageEvent(previous,player()))hurtUntil=performance.now()+750;if(player()?.downedUntil){for(const key of keys)blockedMovementKeys.add(key);keys.clear();movementCommands.reset();}renderer.setState(state, selfId); updateHUD(); }
    if (message.type === 'emote') renderer.setEmote(message.id,message.emote);
    if (message.type === 'notice') { notify(message.text, message.tone); if (message.tone === 'success') playNote(); }
    if (message.type === 'chat') addChat(message);
    if (message.type === 'pong') { ping = Math.max(0, Date.now() - message.at); $('#ping-label').textContent = `${ping} ms`; }
    if (message.type === 'error') { manualLeave = true; notify(message.text, 'error'); connection(false, '参加できません'); openRoom(message.text); }
  });
  ws.addEventListener('close', () => { if (ws !== socket) return; connection(false, manualLeave ? '未接続' : '再接続中…'); keys.clear(); movementCommands.reset(); if (!manualLeave) retry = setTimeout(connect, 2500); });
  ws.addEventListener('error', () => { if (ws === socket) $('#connection-label').textContent = 'サーバーを確認中…'; });
}
function player() { return state.players.find(p => p.id === selfId); }
function distance(a, b) { return Math.hypot(a.x - b.x, a.z - b.z); }
function nearby() {
  const me = player(); if (!me||me.downedUntil) return null;
  const hunting=huntInteraction(state,me);if(hunting)return hunting;
  const objects = state.resources.filter(r => r.amount > 0).map(r => ({ ...r, action: 'gather', label: `${{wood:'木材',stone:'石',berry:'ベリー'}[r.type]}を採集する`, range: 8 }));
  objects.push({ ...state.camp, action: 'contribute', label: '焚き火に資材を届ける', range: 10 }, { ...state.npc, action: 'trade', label: 'オルと物々交換する', range: 10 });
  return objects.filter(o => distance(me, o) <= o.range).sort((a, b) => distance(me, a) - distance(me, b))[0];
}
function updateHUD() {
  const me = player(), inv = inventoryCounts(me?.inventory);
  const gatheredCount=inv.wood+inv.stone+inv.berry,count=Object.values(inv).reduce((a,b)=>a+b,0);
  if (gatheredCount > lastInventory) gathered += gatheredCount - lastInventory; lastInventory = gatheredCount;
  for (const key of Object.keys(inv)) $(`#${key}-count`).textContent = inv[key];
  $('#bag-count').textContent = count; $('#tribe-count').textContent = `${state.players.length} / 5`; $('#online-count').textContent = `${state.players.length}/5`;
  $('#camp-wood').textContent = state.camp.wood; $('#camp-stone').textContent = state.camp.stone;
  $('#camp-level').textContent = `CAMP LEVEL ${state.camp.level}`; $('#camp-name').textContent = state.camp.level ? 'みんなの野営地' : '小さな野営地';
  $('#day-label').textContent = `${state.day || 1}日目`;
  const energy = Math.round(me?.energy ?? 100); $('#energy-label').textContent = `${energy} / 100`; $('#energy-bar').style.width = `${energy}%`;
  $('#gather-progress').style.width = `${Math.min(gathered / 3, 1) * 100}%`;
  let done = 0;
  for (const [id, complete] of [['gather', gathered >= 3], ['craft', !!me?.tool], ['camp', state.camp.level > 0]]) { $(`#quest-${id}`).classList.toggle('done', complete); if (complete) done++; }
  $('#quest-count').textContent = `${done} / 3`;
  $('#interaction-hint span').textContent = nearby()?.label || '近くのものを調べる';
  $('#interaction-hint').classList.toggle('available', !!nearby());
  $('#profile-species').textContent = characterModel(profile).name;
  $('#my-portrait').className = `portrait ${profile.species}`;
  updateHuntingHUD();
  const biome=biomeAt(me?.x??50,me?.z??50);
  $('.location-title h1').textContent=biome.name;
  $('.location-title p').textContent=biome.description;
  $('.location-title .eyebrow').textContent='CRO-MAGNON · OPEN WORLD';
  $('.location-meta span:first-child').textContent=`${biome.short} · ${Math.round(me?.x??50)}, ${Math.round(me?.z??50)}`;
  $('.map-caption').innerHTML=`WORLD · ${biome.short} ${icon('expand')}`;
  drawMinimap();
}
function action(type, targetId) {
  if (!joined) return notify('サーバーへの接続を待っています。', 'error');
  if(player()?.downedUntil)return;
  send({ type: 'action', action: type, ...(targetId?{targetId}:{}) });
  document.querySelectorAll('[data-action]').forEach(el => el.classList.toggle('selected', el.dataset.action === type));
}
function huntTarget(){return selectedCombatTarget(state,player(),selectedAnimalId);}
function approachHunt(animal=huntTarget()){
  const me=player();if(!me||!animal)return notify('マンモスが草原に戻るのを待とう。');
  selectedAnimalId=animal.id;const ground=animal.hostile&&distance(me,animal)>10?ENEMY_GROUNDS.find(item=>item.id===animal.id):null;
  const target=ground?approachEnemyGround(me,ground):approachAnimal(me,animal);goTo(target.x,target.z,animal.hostile?animal.name:animal.phase==='meat'?'肉の近く':'マンモスの近く');
}
function approachEnemy(){
  const enemy=state.enemies?.find(item=>item.hostile===true&&item.phase==='alive');
  if(enemy)return approachHunt(enemy);
  const ground=ENEMY_GROUNDS[0];if(ground)goTo(ground.x,ground.z,'北の呪術師の草地');
}
function attack(){action('attack');}
function interactAnimal(id){
  const animal=[...(state.animals||[]),...(state.enemies||[]).filter(item=>item.hostile===true)].find(item=>item.id===id),me=player();if(!animal||!me)return;
  selectedAnimalId=id;updateHuntingHUD();
  if(animal.phase==='alive'){
    if(attackReady(me,animal))action('attack',id);else{approachHunt(animal);notify(`相手を向いて F または「${attackProfile(me).label}」。`);}
  }else if(animal.phase==='meat'){
    if(distance(me,animal)<=HUNTING.harvestRange)action('harvest',id);else approachHunt(animal);
  }
}
function updateHuntingHUD(){
  const me=player(),animal=huntTarget(),inv=inventoryCounts(me?.inventory),serverNow=(state.serverTime??Date.now())+performance.now()-stateReceivedAt;
  const cooking=!!me?.cookingEndsAt&&me.cookingEndsAt>serverNow;
  const downed=!!me?.downedUntil,protectedNow=!!me?.invulnerableUntil&&me.invulnerableUntil>serverNow;
  const enemies=(state.enemies||[]).filter(enemy=>enemy.hostile===true),nearestEnemy=me?[...enemies].sort((a,b)=>distance(me,a)-distance(me,b))[0]:null;
  const targetInFront=attackReady(me,animal)&&inAttackArc(me,animal);
  $('#hunt-target-name').textContent=animal?.hostile?animal.name:animal?.phase==='meat'?'マンモスの肉':animal?.phase==='dying'?'マンモスを倒した':'草原のマンモス';
  $('#discovery-card').classList.toggle('hostile',animal?.hostile===true);
  $('#discovery-card small').textContent=animal?.hostile?'HOSTILE · 杖の攻撃に注意':'OPEN MEADOW · みんなで狩る';
  $('#hunt-health').setAttribute('aria-label',`${animal?.hostile?animal.name:'マンモス'}の体力`);
  $('#hunt-health').hidden=animal?.phase!=='alive';$('#hunt-health').max=animal?.maxHealth??100;$('#hunt-health').value=animal?.health??100;
  $('#hunt-target-note').textContent=!animal?'Fで前方へ攻撃できます。':animal.phase==='meat'?`近づいて E · 残り${animal.meatRemaining}個`:animal.phase==='dead'?'呪術師を倒しました。しばらくすると戻ります。':animal.phase==='dying'?'肉になったら近づいて採ろう。':`${animal.health} / ${animal.maxHealth} · ${Math.round(distance(me,animal))}m · ${targetInFront?'前方へ F で攻撃':attackReady(me,animal)?'相手を向いて F':'近づいて、相手を向いて F'}`;
  $('#go-hunt').disabled=!animal||downed||animal.phase==='dead';$('#go-hunt').title=$('#go-hunt').ariaLabel=animal?.hostile?`${animal.name}の近くへ移動`:'マンモスの近くへ移動';
  $('#go-enemy').hidden=!enemies.length||animal?.hostile===true;$('#go-enemy').disabled=downed;
  const attackAvailable=joined&&canStartAttack(me,serverNow);
  $('#attack-button').disabled=!attackAvailable;$('#attack-button').classList.toggle('in-range',targetInFront);
  const combat=attackProfile(me??profile),attackButton=$('#attack-button');
  if(attackButton.dataset.style!==combat.key){attackButton.dataset.style=combat.key;attackButton.innerHTML=`${icon(combat.key)}<kbd>F</kbd><span>${combat.label}</span>`;}
  attackButton.title=attackAvailable?`前方へ${combat.label} [F / 5]。相手がいなくても発動できます。`:'次の攻撃を準備しています。';
  $('#cook-button').disabled=!joined||downed||cooking||!inv.rawMeat;$('#eat-meat-button').disabled=!joined||downed||cooking||!inv.cookedMeat;
  $('#cooking-status').hidden=!cooking;
  if(cooking){const remaining=Math.max(0,me.cookingEndsAt-serverNow);$('#cooking-label').textContent=`肉を焼いています · ${(remaining/1000).toFixed(1)}秒`;$('#cooking-progress').value=1-remaining/HUNTING.cookDurationMs;}
  $('#damage-flash').hidden=performance.now()>hurtUntil&&!downed;
  $('#combat-status').hidden=!downed&&!protectedNow&&performance.now()>hurtUntil;
  $('#combat-status').classList.toggle('downed',downed);
  $('#combat-status').textContent=downed?`力尽きました · ${Math.max(0,Math.ceil((me.downedUntil-serverNow)/1000))}秒後に焚き火で回復\n持ち物は失いません`:protectedNow?`焚き火で回復 · 元気 ${me.energy} / 100 · あと${Math.ceil((me.invulnerableUntil-serverNow)/1000)}秒保護中`:`敵の攻撃を受けた · 元気 ${me?.energy??100} / 100`;
  Object.assign($('#world').dataset,{combatVersion:String(state.combatVersion??0),huntTarget:animal?.id??'',huntPhase:animal?.phase??'',huntHealth:String(animal?.health??0),huntInRange:String(attackReady(me,animal)),attackAvailable:String(attackAvailable),attackSequence:String(me?.attackSequence??0),attackAt:String(me?.attackAt??0),cooking:String(cooking),rawMeat:String(inv.rawMeat),cookedMeat:String(inv.cookedMeat)});
  Object.assign($('#world').dataset,{enemyVersion:String(state.enemyVersion??0),enemyCount:String(enemies.length),enemyName:nearestEnemy?.name??'',enemyHealth:String(nearestEnemy?.health??0),enemyPhase:nearestEnemy?.phase??'',enemyBehavior:nearestEnemy?.behavior??'',enemyClip:nearestEnemy?.clip??'',enemyAttackSequence:String(nearestEnemy?.attackSequence??0),enemyHitSequence:String(nearestEnemy?.hitSequence??0),hurtSequence:String(me?.hurtSequence??0),defeatSequence:String(me?.defeatSequence??0),downed:String(downed),invulnerable:String(protectedNow)});
}
function goTo(x, z, label) { if(player()?.downedUntil)return;sendMoveTarget(x,z); notify(`${label}へ向かいます。`); $('#modal').close(); }
function drawMinimap(canvas = $('#minimap'), big = false) { drawWorldMap(canvas,state,selfId,big); }
function openModal(content) { keys.clear(); send({ type: 'move', dx: 0, dz: 0 }); $('#modal-body').innerHTML = content; if (!$('#modal').open) $('#modal').showModal(); }
function openRoom(error = '') {
  openModal(`<h2>あなたの物語を、ここから。</h2><p class="modal-intro">キャラクターを選んで、同じ部屋の仲間と暮らそう。</p>${error?'<p class="form-error" id="room-error"></p>':''}<form id="join-form"><label>あなたの名前<input id="name-input" name="name" maxlength="16" required autocomplete="off"></label><label>部屋のコード <span>英数字・ハイフン・アンダースコア / 最大16文字</span><input id="room-input" name="room" maxlength="16" pattern="[A-Za-z0-9_-]+" required autocomplete="off"></label>${characterChoicesMarkup()}<p class="form-note">人間は槍、クノイチは刀、こぐまは光の魔法を使います。人間の男女で能力の差はありません。参加中に変更すると、もちものはリセットされます。</p><button class="button button-accent wide" type="submit">この谷で暮らす ${icon('arrow')}</button></form>`);
  if(error) $('#room-error').textContent = error;
  $('#name-input').value=profile.name;$('#room-input').value=profile.room;bindCharacterSelection($('#join-form'),profile);
  $('#join-form').onsubmit = e => { e.preventDefault(); const form = new FormData(e.currentTarget); manualLeave=true; const previous=socket; socket=null; previous?.close(); profile={name:String(form.get('name')).trim() || '旅人',room:String(form.get('room')).toUpperCase(),...normalizeCharacter({species:String(form.get('species')),gender:String(form.get('gender'))})}; for(const [k,v] of Object.entries(profile))save(`cro-${k}`,v); history.replaceState({},'',`?room=${encodeURIComponent(profile.room)}`); $('#profile-name').textContent=profile.name; gathered=0;lastInventory=0;$('#modal').close();connect(); };
}
async function openInvite() {
  openModal(`<span class="modal-illustration">${icon('people')}</span><h2>ひとつの火を、5人で。</h2><p class="modal-intro">同じ部屋のリンクを仲間に渡して、一緒に谷を探索しよう。</p><div class="invite-code"><small>ROOM CODE</small><strong id="invite-code"></strong><span>最大5人でプレイ</span></div><label>招待リンク<input id="invite-url" readonly aria-label="招待リンク"></label><button id="copy-invite" class="button button-accent wide">${icon('link')} 招待リンクをコピー</button><p id="invite-note" class="form-note">このPCと同じWi-Fi・LANにいる仲間が参加できます。インターネット越しの参加には、サーバーの公開が必要です。</p><button id="change-room" class="text-button">別の部屋に参加する ${icon('arrow')}</button>`);
  $('#invite-code').textContent = profile.room;
  let base = location.origin;
  try { const network = await fetch('/api/network').then(r=>r.json()); if (['localhost','127.0.0.1','[::1]'].includes(location.hostname) && network.urls?.length) base=network.urls[0]; } catch {}
  if (!$('#invite-url')) return;
  $('#invite-url').value = `${base}/?room=${encodeURIComponent(profile.room)}`;
  $('#copy-invite').onclick=async()=>{ const input=$('#invite-url'); try {await navigator.clipboard.writeText(input.value);notify('招待リンクをコピーしました。','success');} catch {input.select();notify('リンクを選択しました。Ctrl+C でコピーできます。');} };
  $('#change-room').onclick=()=>openRoom();
}
function openInventory() {
  const me=player(), inv=inventoryCounts(me?.inventory);
  openModal(`<h2>旅に持っていくもの。</h2><p class="modal-intro">狩りで得た生肉は、各地の焚き火で焼いてから食べよう。</p><div class="inventory-grid">${[['wood','木材','採集して、道具や拠点に。'],['stone','石','丈夫な道具と火の囲いに。'],['berry','ベリー','食べると元気が回復。'],['rawMeat','生肉','そのままでは食べられません。焚き火で3秒焼こう。'],['cookedMeat','焼き肉','1個で元気を45回復します。']].map(([key,label,note])=>`<div class="inventory-card"><span class="resource-icon ${key}">${icon(key.endsWith('Meat')?'meat':key)}</span><strong>${label}<b>${inv[key]}</b></strong><p>${note}</p>${key==='berry'?'<button id="modal-eat" class="button button-outline">食べる</button>':key==='rawMeat'?`<button id="modal-cook" class="button button-outline" ${inv.rawMeat?'':'disabled'}>焚き火で焼く</button>`:key==='cookedMeat'?`<button id="modal-eat-meat" class="button button-outline" ${inv.cookedMeat?'':'disabled'}>焼き肉を食べる</button>`:''}</div>`).join('')}</div><div class="recipe"><span class="resource-icon stone">${icon('axe')}</span><div><strong>${me?.tool?'石斧を装備中':'石斧をつくる'}</strong><p>木材3 + 石2 ・ 採集量が増えます</p></div><button id="modal-craft" class="button button-accent" ${me?.tool?'disabled':''}>${me?.tool?'装備中':'つくる'}</button></div><p class="form-note">${attackProfile(me??profile).label}は最初から使えます。相手を向いて F。敵がいない場所でも発動できます。</p>`);
  $('#modal-eat').onclick=()=>{action('eat');$('#modal').close();}; $('#modal-craft').onclick=()=>{action('craft');$('#modal').close();};
  $('#modal-cook').onclick=()=>{$('#modal').close();cook();};$('#modal-eat-meat').onclick=()=>{action('eatMeat');$('#modal').close();};
}
function openTribe() {
  openModal(`<h2>同じ火を囲む仲間。</h2><p class="modal-intro">いま、この谷で暮らしている ${state.players.length} 人。</p><div id="tribe-list" class="tribe-list"></div><button id="tribe-invite" class="button button-accent wide">${icon('plus')} 仲間を招待する</button><p class="form-note">NPCのオルは参加人数に含まれません。ひとりでも採集や拠点づくりを楽しめます。</p>`);
  state.players.forEach(p=>{const row=document.createElement('div');row.className='tribe-member';row.innerHTML=`<span class="portrait ${normalizeCharacter(p).species}"><i></i></span><div><strong></strong><small>${characterModel(p).name}</small></div><span class="member-status"><i class="status-dot"></i> ${p.id===selfId?'あなた':'オンライン'}</span>`;row.querySelector('strong').textContent=p.name;$('#tribe-list').append(row);});
  $('#tribe-invite').onclick=openInvite;
}
function openJournal() {
  openModal(`<span class="eyebrow">CHAPTER 01</span><h2>まだ、歴史のない日々。</h2><p class="modal-intro">ここは、氷河期をイメージした小さな谷。<br>あなたと仲間の手で、最初の野営地を育てましょう。</p><div class="journal-entry"><span>01</span><div><h3>森の恵みを分け合おう</h3><p>木、石、ベリーのそばまで歩き、Eキーか「採集」を押します。石斧があれば、いちどに多く採集できます。採り尽くした資源は、しばらくすると戻ります。</p></div></div><div class="journal-entry"><span>02</span><div><h3>小さな火から、みんなの家へ</h3><p>木材12と石6を、仲間と協力して集めましょう。焚き火のそばで「届ける」を押すと、持っている資材を拠点に使います。</p></div></div><div class="journal-entry"><span>03</span><div><h3>谷の隣人、オル</h3><p>ネアンデルタール人のオルは、物々交換ができる隣人です。集落へ歩いて「交換」を押してみましょう。自分自身もネアンデルタール人として遊べます。</p></div></div><p class="form-note">この世界の暮らしや地形は、遊びのためのフィクションです。部屋の進行はサーバーのメモリ上に保存されます。</p>`);
}
function openHelp() {
  openModal(`<h2>今日の一歩から、はじめよう。</h2><p class="modal-intro">最初は、近くの木を集めてみましょう。</p><div class="help-grid"><div><kbd>W A S D</kbd><strong>歩く・走る</strong><p>通常は歩行。Shiftを押している間は走行。「走る」ボタンでも切り替えられます。クリック移動は障害物を避けます。</p></div><div><kbd>E</kbd><strong>近くでアクション</strong><p>採集、焚き火に届ける、オルと交換。</p></div><div><kbd>1 · 2 · 3 · 4</kbd><strong>アクションを選ぶ</strong><p>採集・道具づくり・資材を届ける・交換。</p></div><div><kbd>Enter</kbd><strong>仲間と話す</strong><p>チャットを開き、Enterで送信。</p></div></div><div class="help-tip">${icon('flame')} まずは木材3と石2で石斧を作ろう。<br>そのあと、仲間と拠点に木材12・石6を届けよう。</div><button id="help-start" class="button button-accent wide">探索をはじめる ${icon('arrow')}</button>`);
  $('.help-grid').insertAdjacentHTML('beforeend',`<div><kbd>DRAG</kbd><strong>肩越しカメラを回す</strong><p>マウス右・左ドラッグ、または指のドラッグで周囲を見渡せます。WASDはカメラの向きに合わせて動きます。</p></div><div><kbd>SCROLL</kbd><strong>カメラの距離を変える</strong><p>ホイールか＋・−ボタンで調整。「自分の位置へ」で初期のTPS視点に戻せます。</p></div>`);
  $('.help-grid').insertAdjacentHTML('afterbegin',`<div><kbd>F / 5</kbd><strong>刀・魔法・槍で攻撃</strong><p>相手を向いて F か攻撃ボタン。クノイチは近くを刀で斬り、こぐまは両手から光弾を飛ばします。敵がいなくても発動でき、壁は通り抜けません。人間は槍を使います。</p></div><div><kbd>E</kbd><strong>肉を採って、焼いて食べる</strong><p>倒すと肉になります。近づいて E で採り、近くの焚き火で E か「焼く」。3秒待ったら「食べる」で元気を回復。火から離れると調理は中止され、生肉は残ります。</p></div>`);
  $('#help-start').onclick=()=>$('#modal').close();
  if(state.enemies?.length)$('.help-grid').insertAdjacentHTML('beforeend',`<div><kbd>北の赤い印</kbd><strong>白羽の呪術師</strong><p>地図から北の草地へ。近づくと追いかけて杖で襲ってきます。相手を向いて F で攻撃。力尽きても4秒後に焚き火で回復し、持ち物は残ります。</p></div>`);
}
function openMap() {
  openModal(`<h2>五つの大地を、歩いてつなぐ。</h2><p class="modal-intro">640 m四方のオープンワールド。地域を選ぶと、道をたどって走ります。WASDでいつでも移動を切り替えられます。</p><canvas id="big-map" width="580" height="450" class="big-map" aria-label="草原・雪原・氷原・火山・砂漠の世界地図"></canvas><div class="biome-destinations">${BIOMES.map(b=>`<button class="biome-destination" data-biome="${b.id}" style="--biome-color:${b.color}"><span>${b.name}</span><small>走って向かう</small></button>`).join('')}</div><div class="map-locations"><button class="button button-outline" id="map-camp">${icon('flame')} 焚き火・調理</button><button class="button button-outline" id="map-hunt-north">${icon('spear')} 北西の狩場</button><button class="button button-outline" id="map-hunt-south">${icon('spear')} 南西の狩場</button><button class="button button-outline" id="map-npc">${icon('people')} オルの集落</button></div>`);
  drawMinimap($('#big-map'),true);$('#map-camp').onclick=()=>goTo(49,52.4,'野営地の焚き火');$('#map-npc').onclick=()=>goTo(68,43,'オルの集落');
  if(state.enemies?.some(enemy=>enemy.hostile===true)){
    $('.map-locations').insertAdjacentHTML('beforeend',`<button class="button button-outline enemy-map-button" id="map-enemy">${icon('spear')} 北の白羽の呪術師</button>`);
    $('#map-enemy').onclick=approachEnemy;
  }
  for(const direction of ['north','south'])$(`#map-hunt-${direction}`).onclick=()=>{const animal=state.animals?.find(item=>direction==='north'?item.z<50:item.z>=50);if(animal)approachHunt(animal);};
  for(const button of document.querySelectorAll('[data-biome]'))button.onclick=()=>{
    const stop=JOURNEY_STOPS.find(s=>s.id===button.dataset.biome),biome=BIOMES.find(b=>b.id===stop.id);
    if(!runMode)$('#run-button').click();goTo(stop.x,stop.z,biome.name);
  };
  $('#big-map').onclick=event=>{const canvas=event.currentTarget,rect=canvas.getBoundingClientRect(),target=mapProjection(canvas,true,player()).world((event.clientX-rect.left)*canvas.width/rect.width,(event.clientY-rect.top)*canvas.height/rect.height);goTo(target.x,target.z,biomeAt(target.x,target.z).name);};
}
function cook(){const me=player();if(!me)return;const fire=nearestCookingFire(state,me);if(distance(me,fire)>HUNTING.cookRange){goTo(fire.x-1,fire.z+2.4,'近くの焚き火');notify('焚き火のそばで E または「焼く」を押そう。');}else action('cook');}
function playNote() {
  if(!soundEnabled||!audioContext)return;
  const osc=audioContext.createOscillator(),gain=audioContext.createGain();osc.type='sine';osc.frequency.value=[220,293.66,329.63,440,587.33][Math.floor(Math.random()*5)];gain.gain.setValueAtTime(0,audioContext.currentTime);gain.gain.linearRampToValueAtTime(.035,audioContext.currentTime+.05);gain.gain.exponentialRampToValueAtTime(.001,audioContext.currentTime+2);osc.connect(gain);gain.connect(audioContext.destination);osc.start();osc.stop(audioContext.currentTime+2);
}
async function toggleSound() {
  try {audioContext ||= new (window.AudioContext||window.webkitAudioContext)();await audioContext.resume();soundEnabled=!soundEnabled;clearInterval(audioTimer);if(soundEnabled){playNote();audioTimer=setInterval(playNote,3200);}$('#sound-button').innerHTML=icon(soundEnabled?'sound':'muted');$('#sound-button').setAttribute('aria-label',`環境音を${soundEnabled?'オフ':'オン'}`);$('#sound-button').classList.toggle('enabled',soundEnabled);}catch{notify('このブラウザでは環境音を再生できません。');}
}

document.querySelectorAll('[data-panel]').forEach(b=>b.onclick=()=>({explore:()=>{renderer.focusPlayer();$('#modal').close();},inventory:openInventory,tribe:openTribe,journal:openJournal}[b.dataset.panel]()));
document.querySelectorAll('[data-action]').forEach(b=>b.onclick=()=>action(b.dataset.action));
document.querySelectorAll('[data-inventory]').forEach(b=>b.onclick=openInventory);
$('#profile-button').onclick=()=>openRoom();$('#room-button').onclick=()=>openRoom();$('#invite-button').onclick=openInvite;
$('#help-button').onclick=openHelp;$('#map-button').onclick=openMap;
$('#go-camp').onclick=()=>goTo(49,52.4,'野営地の焚き火');$('#go-hunt').onclick=()=>approachHunt();
$('#go-enemy').onclick=approachEnemy;
$('#attack-button').onclick=attack;$('#meat-inventory').onclick=openInventory;$('#cook-button').onclick=cook;$('#eat-meat-button').onclick=()=>action('eatMeat');$('#cancel-cook').onclick=()=>action('cancelCook');
$('#interaction-hint').setAttribute('role','button');$('#interaction-hint').tabIndex=0;$('#interaction-hint').onclick=()=>{const next=nearby();action(next?.action||'gather',next?.targetId);};$('#interaction-hint').onkeydown=e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();$('#interaction-hint').click();}};
$('#eat-button').onclick=()=>action('eat');$('#wave-button').onclick=()=>action('wave');
$('#zoom-in').onclick=()=>renderer.adjustZoom(.15);$('#zoom-out').onclick=()=>renderer.adjustZoom(-.15);$('#focus-button').onclick=()=>renderer.focusPlayer();
$('#run-button').onclick=()=>{runMode=!runMode;$('#run-button').setAttribute('aria-pressed',String(runMode));$('#run-button span').textContent=runMode?'歩く':'走る';};
$('#sound-button').onclick=toggleSound;
$('#fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen();}catch{notify('この画面では全画面表示を利用できません。');}};
$('#modal-close').onclick=()=>$('#modal').close();$('#modal').addEventListener('click',e=>{if(e.target===$('#modal')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)e.target.close();}});
$('#chat-toggle').onclick=()=>{const hidden=$('#chat-content').hidden=!$('#chat-content').hidden;$('.chat-collapse').textContent=hidden?'+':'−';};
$('#chat-form').onsubmit=e=>{e.preventDefault();const text=$('#chat-input').value.trim();if(!text)return;if(!joined)return notify('チャットの送信には接続が必要です。','error');send({type:'chat',text});$('#chat-input').value='';$('#chat-input').blur();};
document.addEventListener('keydown',e=>{
  if(e.target.closest('input,textarea,select,[contenteditable=""],[contenteditable="true"]')||e.isComposing||$('#modal').open)return;
  const k=e.key.toLowerCase();if(['w','a','s','d','arrowup','arrowdown','arrowleft','arrowright','shift'].includes(k)){e.preventDefault();if(player()?.downedUntil)blockedMovementKeys.add(k);else if(!blockedMovementKeys.has(k))keys.add(k);return;}
  if(e.repeat)return;
  if(k==='e'){e.preventDefault();const next=nearby();action(next?.action||'gather',next?.targetId);}
  if(isAttackShortcut(e)){e.preventDefault();attack();}
  if(['1','2','3','4'].includes(k))action(['gather','craft','contribute','trade'][Number(k)-1]);
  if(k==='enter'){e.preventDefault();$('#chat-content').hidden=false;$('#chat-input').focus();}
  if(k==='?'||k==='h')openHelp();
});
document.addEventListener('keyup',e=>{const key=e.key.toLowerCase();keys.delete(key);blockedMovementKeys.delete(key);});
window.addEventListener('blur',()=>{keys.clear();send({type:'move',dx:0,dz:0});});
document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();send({type:'move',dx:0,dz:0});}});
setInterval(()=>{
  if(player()?.downedUntil){keys.clear();movementCommands.reset();return;}
  let sx=0,sy=0;if(!$('#modal').open&&!document.activeElement.matches('input,textarea')){if(keys.has('w')||keys.has('arrowup'))sy--;if(keys.has('s')||keys.has('arrowdown'))sy++;if(keys.has('a')||keys.has('arrowleft'))sx--;if(keys.has('d')||keys.has('arrowright'))sx++;}
  const running=wantsToRun();if(running!==lastGait){send({type:'gait',running});lastGait=running;}
  const {dx,dz}=renderer.getMovementDirection(sx,sy),command=movementCommands.next({dx,dz,running});
  if(command)send(command);
},70);
setInterval(()=>send({type:'ping',at:Date.now()}),3000);
setInterval(updateHuntingHUD,100);
window.addEventListener('beforeunload',()=>{manualLeave=true;socket?.close();renderer.destroy();});
connect();
