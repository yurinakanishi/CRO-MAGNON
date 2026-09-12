import { WARP_POINTS, warpPointById, warpUnavailable } from '../shared/warp-sites.mjs';
import { locationName } from '../shared/paleo-geography.mjs';
import { MAP_PIN_COOLDOWN_MS } from '../shared/map-pins.mjs';
import type { PadFrame } from './gamepad-input.js';
import {
  MAP_ZOOM,
  PICK_RADIUS,
  clampPointer,
  markerRotation,
  movePointer,
  nearestWithin,
  nudgeStep,
  type Point,
} from './map-layout.js';
import { MAP_EMPTY_PROMPT, warpRegionName } from './map-screen.js';
import {
  mapProjection,
  setWorldMapSelection,
  resetWorldMap,
  zoomWorldMap,
  panWorldMap,
  worldMapFireLabels,
} from './world-map.js';

/** The chosen destination id lives on the travel card so the HUD and controller can read it. */
export function selectedWarpId(): string {
  return document.querySelector<HTMLElement>('#map-card')?.dataset.warpId ?? '';
}

const metres = (a, b) => `${Math.round(Math.hypot(a.x - b.x, a.z - b.z))} m`;

export function updateMapWarp(player, now, connected = true) {
  const button = document.querySelector<HTMLButtonElement>('#map-warp');
  if (!button) return;
  const point = warpPointById(selectedWarpId());
  const reason = warpUnavailable(player, point, now);
  button.disabled = !!reason || !connected;
  button.setAttribute('aria-label', point ? `${point.name}へワープ` : 'ワープ');
  document.querySelector('#map-warp-status').textContent = !connected
    ? '接続を待っています。'
    : !point
      ? ''
      : reason || '';
  const card = document.querySelector<HTMLElement>('#map-card');
  card.dataset.state = !point ? 'empty' : reason || !connected ? 'blocked' : 'ready';
}

/** What the controller hands the open atlas every frame. */
export interface MapInput {
  input(frame: PadFrame, dt: number): void;
}

/** Keyboard arrows move the pointer this far per press. */
const KEY_STEP = 12;

export function installMapWarp({
  player,
  pins,
  pinEnabled,
  send,
  now,
  action,
  icon,
  redraw,
  connected,
}): MapInput {
  const canvas = document.querySelector<HTMLCanvasElement>('#big-map');
  const wrap = canvas.parentElement;
  const root = document.querySelector<HTMLElement>('#warp-map-points');
  const card = document.querySelector<HTMLElement>('#map-card');
  const warp = document.querySelector<HTMLButtonElement>('#map-warp');
  const pinSend = document.querySelector<HTMLButtonElement>('#map-pin-send');
  const pinClear = document.querySelector<HTMLButtonElement>('#map-pin-clear');
  const pinStatus = document.querySelector<HTMLElement>('#map-pin-status');
  const cursor = document.querySelector<HTMLElement>('#map-cursor');
  const selfMarker = document.querySelector<HTMLElement>('#map-self');
  const dialog = canvas.closest('dialog');
  const me = () => player() ?? { x: 50, z: 50 };
  const size = () => ({ width: canvas.width, height: canvas.height });
  let pointer: Point = { x: canvas.width / 2, y: canvas.height / 2 };
  let sentAt = -Infinity,
    nudges = 0,
    nudgedAt = -Infinity;
  const projection = () => mapProjection(canvas, true, player());
  const firePixels = () => {
    const { point } = projection();
    return WARP_POINTS.map((fire) => {
      const [x, y] = point(fire.x, fire.z);
      return { fire, x, y };
    });
  };
  const fireNear = (at: Point) => nearestWithin(firePixels(), at, PICK_RADIUS);
  const position = (el: HTMLElement, x: number, y: number) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const ownPin = () =>
    pins().find((pin) => pin.ownerId === player()?.id && pin.expiresAt > now()) ?? null;

  root.innerHTML = WARP_POINTS.map(
    (p) =>
      `<button class="warp-map-point" data-warp-point="${p.id}" title="${p.name}" aria-label="${p.name}の焚き火を選ぶ" aria-pressed="false">${icon('flame')}<span class="warp-point-label">${p.name}</span></button>`,
  ).join('');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-warp-point]')];

  // Selection: the card names the fire; a gold ring marks it on the canvas.
  const choose = (point) => {
    card.dataset.warpId = warpPointById(point?.id)?.id ?? '';
    setWorldMapSelection(point);
    document.querySelector('#map-region').textContent = point ? warpRegionName(point) : '';
    document.querySelector('#map-destination').textContent = point?.name ?? MAP_EMPTY_PROMPT;
    document.querySelector('#map-selection').textContent = point
      ? `現在地から ${metres(point, me())}`
      : '';
    redraw();
    updateMapWarp(player(), now(), connected());
  };
  const travel = () => {
    const point = warpPointById(card.dataset.warpId);
    if (connected() && point && !warpUnavailable(player(), point, now())) action('warp', point.id);
  };
  /** First confirm on a fire selects it; a second confirm on the same fire warps. */
  const confirm = () => {
    const hit = fireNear(pointer);
    if (!hit) return;
    if (card.dataset.warpId === hit.fire.id) travel();
    else choose(hit.fire);
  };
  const placePin = () => {
    if (!pinEnabled() || !connected() || now() - sentAt < MAP_PIN_COOLDOWN_MS) return;
    const world = projection().world(pointer.x, pointer.y);
    send({ type: 'mapPin', x: world.x, z: world.z });
    sentAt = now();
    redraw();
  };
  const clearPin = () => {
    if (pinEnabled() && connected() && ownPin()) send({ type: 'clearMapPin' });
  };
  const togglePin = () => (ownPin() ? clearPin() : placePin());

  // Pointer: free movement; the outer band drags the map along under it.
  const refreshPointer = () => {
    position(cursor, pointer.x, pointer.y);
    const near = fireNear(pointer);
    cursor.classList.toggle('is-near', !!near);
    for (const button of buttons) {
      const isNear = near?.fire.id === button.dataset.warpPoint;
      button.classList.toggle('is-near', isNear);
      if (isNear) button.classList.add('show-label');
      else if (!button.classList.contains('has-label') && !button.matches('[aria-pressed="true"]'))
        button.classList.remove('show-label');
    }
  };
  const setPointer = (x: number, y: number) => {
    pointer = {
      x: Math.max(0, Math.min(canvas.width, x)),
      y: Math.max(0, Math.min(canvas.height, y)),
    };
    refreshPointer();
  };
  /** Moves the pointer by a screen delta; overshoot into the edge band pans the map. */
  const nudge = (dx: number, dy: number) => {
    const { pointer: next, pan } = clampPointer({ x: pointer.x + dx, y: pointer.y + dy }, size());
    pointer = next;
    if (pan.x || pan.y) {
      panWorldMap(canvas, player(), pan.x, pan.y);
      redraw();
    } else refreshPointer();
  };
  const zoom = (factor: number, anchor: Point = pointer) => {
    zoomWorldMap(canvas, player(), factor, anchor);
    redraw();
  };
  const centerOnPlayer = () => {
    resetWorldMap(me(), MAP_ZOOM.open);
    pointer = { x: canvas.width / 2, y: canvas.height / 2 };
    redraw();
  };

  const update = () => {
    const enabled = pinEnabled();
    for (const element of document.querySelectorAll<HTMLElement>(
      '.map-pin-actions,#map-pin-status',
    ))
      element.hidden = !enabled;
    const { point, zoom: level } = projection();
    const self = player();
    const [selfX, selfY] = point(self?.x ?? 50, self?.z ?? 50);
    selfMarker.hidden =
      !self || selfX < 12 || selfY < 12 || selfX > canvas.width - 12 || selfY > canvas.height - 12;
    position(selfMarker, selfX, selfY);
    selfMarker.style.setProperty('--facing', `${markerRotation(self?.facing ?? 0)}rad`);
    const here = document.querySelector<HTMLElement>('#map-self b');
    if (self) here.textContent = locationName(self.x, self.z);
    const points = firePixels();
    selfMarker.classList.toggle(
      'is-crowded',
      points.some((p) => Math.hypot(p.x - selfX, p.y - selfY) < 34),
    );
    const labelled = worldMapFireLabels();
    const selectedId = card.dataset.warpId;
    for (const button of buttons) {
      const p = points.find((q) => q.fire.id === button.dataset.warpPoint);
      const visible =
        p.x >= -20 && p.y >= -20 && p.x <= canvas.width + 20 && p.y <= canvas.height + 20;
      button.hidden = !visible;
      if (!visible) continue;
      position(button, p.x, p.y);
      const selected = selectedId === p.fire.id;
      button.setAttribute('aria-pressed', String(selected));
      const hasLabel = labelled.has(p.fire.id);
      button.classList.toggle('has-label', hasLabel);
      button.classList.toggle('show-label', hasLabel || selected);
      const width = Math.min(180, p.fire.name.length * 12 + 16);
      const labelX = Math.max(4, Math.min(canvas.width - width - 4, p.x - width / 2));
      button.style.setProperty('--label-x', `${labelX - p.x + 17}px`);
      button.style.setProperty('--label-width', `${width}px`);
      button.classList.toggle(
        'is-locked',
        !!p.fire.requiredSeals && !!warpUnavailable(player(), p.fire, now()),
      );
    }
    const chosen = warpPointById(selectedId);
    if (chosen)
      document.querySelector('#map-selection').textContent = `現在地から ${metres(chosen, me())}`;
    document.querySelector('#map-zoom-level').textContent = `${level.toFixed(level % 1 ? 1 : 0)}×`;
    document.querySelector<HTMLButtonElement>('#map-zoom-in').disabled = level >= MAP_ZOOM.max;
    document.querySelector<HTMLButtonElement>('#map-zoom-out').disabled = level <= MAP_ZOOM.min;
    const mine = ownPin();
    pinSend.disabled = !enabled || !connected() || now() - sentAt < MAP_PIN_COOLDOWN_MS;
    pinClear.disabled = !enabled || !connected() || !mine;
    pinClear.hidden = !enabled || !mine;
    const friends = pins().filter((pin) => pin.expiresAt > now() && pin.ownerId !== player()?.id);
    pinStatus.textContent = mine
      ? `自分のピンを置いた · あと${Math.max(1, Math.ceil((mine.expiresAt - now()) / 60000))}分`
      : friends.length
        ? `仲間のピン：${friends.map((pin) => pin.name).join('、')}`
        : 'ポインタの場所を仲間に知らせる · 5分間';
    refreshPointer();
  };
  canvas.addEventListener('mapdraw', update);
  // The atlas fills terrain coarsely while the view moves and asks for this one redraw once it
  // settles, so the final picture is the fine one even if no frame loop is running.
  canvas.addEventListener('maprefine', () => redraw());

  // Buttons for mouse and touch users.
  for (const button of buttons)
    button.onclick = () => {
      const p = firePixels().find((q) => q.fire.id === button.dataset.warpPoint);
      if (p) setPointer(p.x, p.y);
      confirm();
    };
  warp.onclick = travel;
  pinSend.onclick = placePin;
  pinClear.onclick = clearPin;
  document.getElementById('map-zoom-in').onclick = () => zoom(MAP_ZOOM.step);
  document.getElementById('map-zoom-out').onclick = () => zoom(1 / MAP_ZOOM.step);
  document.getElementById('map-center').onclick = centerOnPlayer;

  // Mouse and touch on the canvas: hover moves the pointer, drag pans, wheel and pinch zoom,
  // a click selects (or warps on the selected fire), right-click toggles the shared pin.
  const canvasPoint = (event: { clientX: number; clientY: number }) => {
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) * canvas.width) / (rect.width || canvas.width),
      y: ((event.clientY - rect.top) * canvas.height) / (rect.height || canvas.height),
    };
  };
  // Wheel and right-click are taken on the wrapper so fire marks above the canvas do not swallow them.
  const overControls = (event: Event) =>
    !!(event.target as HTMLElement)?.closest?.('.atlas-card,.atlas-zoom');
  wrap.onwheel = (event) => {
    if (overControls(event)) return;
    event.preventDefault();
    const at = canvasPoint(event);
    setPointer(at.x, at.y);
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, at);
  };
  wrap.oncontextmenu = (event) => {
    if (overControls(event)) return;
    event.preventDefault();
    const at = canvasPoint(event);
    setPointer(at.x, at.y);
    togglePin();
  };
  const touches = new Map<number, Point>();
  let drag: {
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    moved: boolean;
  } | null = null;
  let pinch: { distance: number; mid: Point } | null = null;
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (touches.size === 2) {
      const [a, b] = [...touches.values()];
      pinch = {
        distance: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      drag = null;
      return;
    }
    drag = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    canvas.focus?.({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    canvas.classList.add('dragging');
  };
  canvas.onpointermove = (event) => {
    if (touches.has(event.pointerId))
      touches.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && touches.size === 2) {
      const [a, b] = [...touches.values()];
      const distance = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      panWorldMap(canvas, player(), mid.x - pinch.mid.x, mid.y - pinch.mid.y);
      const at = canvasPoint({ clientX: mid.x, clientY: mid.y });
      setPointer(at.x, at.y);
      if (pinch.distance > 0) zoomWorldMap(canvas, player(), distance / pinch.distance, at);
      pinch = { distance, mid };
      redraw();
      return;
    }
    if (!drag || drag.id !== event.pointerId) {
      if (event.pointerType !== 'touch' && !drag) {
        const at = canvasPoint(event);
        setPointer(at.x, at.y);
      }
      return;
    }
    if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) > 6) drag.moved = true;
    if (!drag.moved) return;
    panWorldMap(canvas, player(), event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
    redraw();
  };
  const release = (event: PointerEvent) => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = null;
    if (drag && drag.id === event.pointerId) {
      if (!drag.moved && event.type === 'pointerup') {
        const at = canvasPoint(event);
        setPointer(at.x, at.y);
        confirm();
      }
      drag = null;
      canvas.classList.remove('dragging');
    }
  };
  canvas.onpointerup = release;
  canvas.onpointercancel = release;
  canvas.onlostpointercapture = () => {
    drag = null;
    canvas.classList.remove('dragging');
  };

  // Keyboard: arrows move the pointer, + / - zoom at it, Enter confirms; Esc closes natively.
  const keys = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement;
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      target?.closest?.('input,select,textarea')
    )
      return;
    if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      zoom(event.key === '-' ? 1 / MAP_ZOOM.step : MAP_ZOOM.step);
      return;
    }
    const step = {
      ArrowLeft: [-KEY_STEP, 0],
      ArrowRight: [KEY_STEP, 0],
      ArrowUp: [0, -KEY_STEP],
      ArrowDown: [0, KEY_STEP],
    }[event.key];
    if (step) {
      event.preventDefault();
      nudge(step[0], step[1]);
      return;
    }
    if (event.key === 'Enter' && !target?.closest?.('button,a,summary,[role="button"]')) {
      event.preventDefault();
      confirm();
    }
  };
  dialog.addEventListener('keydown', keys);

  // Controller: the frame the GamepadControls hands over while the atlas is open.
  const input = (frame: PadFrame, dt: number) => {
    let dirty = false;
    if (frame.pointer && (frame.pointer.x || frame.pointer.y)) {
      const moved = movePointer(pointer, frame.pointer, dt, size());
      pointer = moved.pointer;
      if (moved.pan.x || moved.pan.y) {
        panWorldMap(canvas, player(), moved.pan.x, moved.pan.y);
        dirty = true;
      }
    }
    if (frame.zoom) {
      zoomWorldMap(canvas, player(), 2 ** (-frame.zoom * dt * 1.5), pointer);
      dirty = true;
    }
    if (frame.navigation) {
      const t = now();
      nudges = t - nudgedAt < 450 ? nudges + 1 : 0;
      nudgedAt = t;
      const px = nudgeStep(nudges);
      const [dx, dy] = { up: [0, -px], down: [0, px], left: [-px, 0], right: [px, 0] }[
        frame.navigation
      ];
      nudge(dx, dy);
    }
    for (const act of new Set(frame.actions)) {
      if (act === 'confirm') confirm();
      else if (act === 'pin') togglePin();
      else if (act === 'center') centerOnPlayer();
      else if (act === 'zoomIn') zoom(MAP_ZOOM.step);
      else if (act === 'zoomOut') zoom(1 / MAP_ZOOM.step);
      else if (act === 'menu') dialog.close();
    }
    if (dirty) redraw();
    else refreshPointer();
  };

  const fit = () => {
    canvas.width = Math.max(100, wrap.clientWidth || canvas.width);
    canvas.height = Math.max(100, wrap.clientHeight || canvas.height);
    pointer = clampPointer(pointer, size(), 0).pointer;
  };
  const resize =
    typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(() => {
          if (!canvas.isConnected || !dialog.open) {
            cleanup();
            return;
          }
          fit();
          redraw();
        });
  const cleanup = () => {
    resize?.disconnect();
    dialog.removeEventListener('keydown', keys);
    dialog.removeEventListener('close', cleanup);
  };
  dialog.addEventListener('close', cleanup);
  resize?.observe(wrap);
  canvas.tabIndex = -1; // Keyboard focus lands on the map itself, outside the controller's item list.
  fit();
  centerOnPlayer();
  updateMapWarp(player(), now(), connected());
  canvas.focus?.({ preventScroll: true });
  return { input };
}
