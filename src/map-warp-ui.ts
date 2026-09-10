import { WARP_POINTS, warpPointById, warpUnavailable } from '../shared/warp-sites.mjs';
import { inGulf } from '../shared/gulf-region.mjs';
import { locationName } from '../shared/paleo-geography.mjs';
import { groupMapPoints } from './map-layout.js';
import { warpRegionName } from './map-screen.js';
import {
  mapProjection,
  setWorldMapSelection,
  setWorldMapMode,
  setWorldMapDetails,
  centerWorldMap,
  zoomWorldMap,
  panWorldMap,
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
  button.setAttribute('aria-label', point ? `${point.name}へワープ` : 'ここへワープ');
  document.querySelector('#map-warp-status').textContent = !connected
    ? '接続を待っています。'
    : !point
      ? ''
      : reason || '';
  const card = document.querySelector<HTMLElement>('#map-card');
  card.dataset.state = !point ? 'empty' : reason || !connected ? 'blocked' : 'ready';
}

export function installMapWarp({ player, now, action, icon, redraw, connected }) {
  const canvas = document.querySelector<HTMLCanvasElement>('#big-map');
  const wrap = canvas.parentElement;
  const root = document.querySelector<HTMLElement>('#warp-map-points');
  const clusters = document.querySelector<HTMLElement>('#map-clusters');
  const card = document.querySelector<HTMLElement>('#map-card');
  const list = document.querySelector<HTMLElement>('#map-list');
  const warp = document.querySelector<HTMLButtonElement>('#map-warp');
  const items = [...list.querySelectorAll<HTMLButtonElement>('[data-warp-item]')];
  let mode = inGulf(player()?.x, player()?.z) ? 'gulf' : 'earth';
  let clusterKey = '',
    details = false,
    grouped = new Set<string>();
  setWorldMapDetails(false);
  const me = () => player() ?? { x: 50, z: 50 };
  const refreshList = () => {
    for (const item of items) {
      const point = warpPointById(item.dataset.warpItem);
      const locked = !!point.requiredSeals && !!warpUnavailable(player(), point, now());
      item.querySelector('small').textContent = locked ? '旅の証が必要' : metres(point, me());
      item.classList.toggle('is-locked', locked);
      item.setAttribute('aria-selected', String(item.dataset.warpItem === card.dataset.warpId));
    }
  };
  const choose = (point, { focus = true, reveal = false } = {}) => {
    card.dataset.warpId = point?.id ?? '';
    setWorldMapSelection(point);
    document.querySelector('#map-region').textContent = point ? warpRegionName(point) : '';
    document.querySelector('#map-destination').textContent = point?.name ?? '焚き火を選ぼう';
    document.querySelector('#map-selection').textContent = point
      ? `現在地から ${metres(point, me())}`
      : '地図の炎か、下の一覧から';
    if (point) {
      const [x, y] = mapProjection(canvas, true, player()).point(point.x, point.z);
      const offscreen = x < 40 || y < 40 || x > canvas.width - 40 || y > canvas.height - 40;
      if (reveal && grouped.has(point.id)) {
        // Chosen by name while hidden inside a cluster: open the cluster around it.
        centerWorldMap(point);
        zoomWorldMap(canvas, player(), Math.max(1, 3 / mapProjection(canvas, true, player()).zoom));
      } else if (offscreen) centerWorldMap(point);
      const item = items.find((i) => i.dataset.warpItem === point.id);
      item?.scrollIntoView({ block: 'nearest' });
    }
    redraw();
    updateMapWarp(player(), now(), connected());
    if (focus && !warp.disabled) warp.focus({ preventScroll: true });
  };
  root.innerHTML = WARP_POINTS.map(
    (p) =>
      `<button class="warp-map-point" data-warp-point="${p.id}" title="${p.name}" aria-label="${p.name}の焚き火を選ぶ" aria-pressed="false">${icon('flame')}<span class="warp-point-label">${p.name}</span></button>`,
  ).join('');
  const buttons = [...root.querySelectorAll<HTMLButtonElement>('[data-warp-point]')];
  for (const button of buttons)
    button.onclick = () => choose(warpPointById(button.dataset.warpPoint));
  for (const item of items)
    item.onclick = () => choose(warpPointById(item.dataset.warpItem), { reveal: true });
  const position = (el, x, y) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const update = () => {
    const projection = mapProjection(canvas, true, player());
    const self = player();
    const [selfX, selfY] = projection.point(self?.x ?? 50, self?.z ?? 50);
    const selfMarker = document.querySelector<HTMLElement>('#map-self');
    selfMarker.hidden =
      !self || selfX < 12 || selfY < 12 || selfX > canvas.width - 12 || selfY > canvas.height - 12;
    position(selfMarker, selfX, selfY);
    selfMarker.style.setProperty('--facing', `${Math.PI - (self?.facing ?? 0)}rad`);
    const points = WARP_POINTS.map((point) => {
      const [x, y] = projection.point(point.x, point.z);
      return { point, x, y };
    }).filter(
      (p) => p.x >= 24 && p.y >= 24 && p.x <= canvas.width - 24 && p.y <= canvas.height - 24,
    );
    const groups = groupMapPoints(points);
    const singles = groups.filter((g) => g.length === 1).map((g) => g[0]);
    const selectedId = card.dataset.warpId;
    const selected = points.find((p) => p.point.id === selectedId);
    if (selected && !singles.includes(selected)) singles.push(selected);
    grouped = new Set(
      groups
        .filter((g) => g.length > 1)
        .flat()
        .map((p) => p.point.id),
    );
    selfMarker.classList.toggle(
      'is-crowded',
      points.some((p) => Math.hypot(p.x - selfX, p.y - selfY) < 34),
    );
    const labels: { x: number; y: number; width: number }[] = [];
    for (const button of buttons) {
      const p = singles.find((p) => p.point.id === button.dataset.warpPoint);
      button.hidden = !p;
      button.setAttribute('aria-pressed', String(selectedId === button.dataset.warpPoint));
      if (!p) continue;
      position(button, p.x, p.y);
      const width = Math.min(180, p.point.name.length * 12 + 16);
      const labelX = Math.max(4, Math.min(canvas.width - width - 4, p.x - width / 2));
      const showLabel =
        p.y < canvas.height - 60 &&
        !points.some(
          (q) =>
            q !== p &&
            Math.abs(q.y - (p.y + 39)) < 31 &&
            q.x > labelX - 28 &&
            q.x < labelX + width + 28,
        ) &&
        !labels.some(
          (l) => Math.abs(l.y - p.y) < 27 && labelX < l.x + l.width + 8 && labelX + width + 8 > l.x,
        );
      button.classList.toggle('show-label', showLabel);
      button.style.setProperty('--label-x', `${labelX - p.x + 17}px`);
      button.style.setProperty('--label-width', `${width}px`);
      if (showLabel) labels.push({ x: labelX, y: p.y, width });
      button.classList.toggle(
        'is-locked',
        !!p.point.requiredSeals && !!warpUnavailable(player(), p.point, now()),
      );
    }
    const multiple = groups.filter((g) => g.length > 1);
    const nextKey = multiple
      .map((g) =>
        g
          .map((p) => p.point.id)
          .sort()
          .join(','),
      )
      .join('|');
    if (clusterKey !== nextKey) {
      clusterKey = nextKey;
      clusters.replaceChildren();
      for (const group of multiple) {
        const button = document.createElement('button');
        button.className = 'warp-map-cluster';
        button.innerHTML = `${icon('flame')}<b>${group.length}</b>`;
        button.setAttribute(
          'aria-label',
          `近くの焚き火${group.length}か所を広げる：${group.map((p) => p.point.name).join('、')}`,
        );
        button.onclick = () => {
          // Open the cluster on the map and hand focus to its first name in the list.
          centerWorldMap({
            x: group.reduce((s, p) => s + p.point.x, 0) / group.length,
            z: group.reduce((s, p) => s + p.point.z, 0) / group.length,
          });
          zoomWorldMap(canvas, player(), 2.5);
          redraw();
          const ids = group.map((p) => p.point.id);
          for (const item of items)
            item.classList.toggle('is-nearby', ids.includes(item.dataset.warpItem));
          const first = items.find((i) => i.dataset.warpItem === ids[0]);
          first?.scrollIntoView({ block: 'center' });
          first?.focus({ preventScroll: true });
        };
        clusters.append(button);
      }
    }
    [...clusters.children].forEach((button: HTMLElement, i) => {
      const group = multiple[i];
      let x = group.reduce((s, p) => s + p.x, 0) / group.length;
      let y = group.reduce((s, p) => s + p.y, 0) / group.length;
      if (
        Math.hypot(x - selfX, y - selfY) < 45 ||
        (selected && Math.hypot(x - selected.x, y - selected.y) < 45)
      ) {
        const blockers = [
          ...singles,
          { x: selfX, y: selfY },
          ...multiple
            .filter((_, j) => j !== i)
            .map((g) => ({
              x: g.reduce((s, p) => s + p.x, 0) / g.length,
              y: g.reduce((s, p) => s + p.y, 0) / g.length,
            })),
        ];
        const free = [
          [0, -56],
          [-56, 0],
          [56, 0],
          [0, 56],
          [-56, -56],
          [56, -56],
        ]
          .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
          .find(
            (p) =>
              p.x > 28 &&
              p.y > 28 &&
              p.x < canvas.width - 28 &&
              p.y < canvas.height - 28 &&
              blockers.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 48),
          );
        if (free) {
          x = free.x;
          y = free.y;
        }
      }
      position(button, x, y);
    });
    document.querySelector('#map-zoom-level').textContent =
      `${projection.zoom.toFixed(projection.zoom % 1 ? 1 : 0)}×`;
    document.querySelector<HTMLButtonElement>('#map-zoom-in').disabled = projection.zoom >= 32;
    document.querySelector<HTMLButtonElement>('#map-zoom-out').disabled = projection.zoom <= 1;
    for (const [id, value] of [
      ['map-overview', 'earth'],
      ['map-gulf', 'gulf'],
      ['map-local', 'local'],
    ])
      document.getElementById(id).setAttribute('aria-pressed', String(mode === value));
    const here = document.querySelector<HTMLElement>('#map-self b');
    if (self) here.textContent = locationName(self.x, self.z);
    refreshList();
  };
  canvas.addEventListener('mapdraw', update);
  warp.onclick = () => {
    const point = warpPointById(card.dataset.warpId);
    if (connected() && point && !warpUnavailable(player(), point, now())) action('warp', point.id);
  };
  for (const [id, value] of [
    ['map-overview', 'earth'],
    ['map-gulf', 'gulf'],
    ['map-local', 'local'],
  ])
    document.getElementById(id).onclick = () => {
      mode = value;
      setWorldMapMode(mode);
      for (const item of items) item.classList.remove('is-nearby');
      redraw();
    };
  document.getElementById('map-details').onclick = () => {
    details = !details;
    setWorldMapDetails(details);
    document.getElementById('map-details').setAttribute('aria-pressed', String(details));
    redraw();
  };
  const zoom = (factor, anchor?) => {
    zoomWorldMap(canvas, player(), factor, anchor);
    redraw();
  };
  document.getElementById('map-zoom-in').onclick = () => zoom(1.5);
  document.getElementById('map-zoom-out').onclick = () => zoom(1 / 1.5);
  const pointerAnchor = (event: MouseEvent) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };
  canvas.onwheel = (event) => {
    event.preventDefault();
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, pointerAnchor(event));
  };
  canvas.ondblclick = (event) => zoom(2, pointerAnchor(event));
  let drag = null;
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    canvas.classList.add('dragging');
  };
  canvas.onpointermove = (event) => {
    if (!drag || drag.id !== event.pointerId) return;
    panWorldMap(canvas, player(), event.clientX - drag.x, event.clientY - drag.y);
    drag.x = event.clientX;
    drag.y = event.clientY;
    redraw();
  };
  canvas.onpointerup =
    canvas.onpointercancel =
    canvas.onlostpointercapture =
      () => {
        drag = null;
        canvas.classList.remove('dragging');
      };
  const dialog = canvas.closest('dialog');
  const keys = (event: KeyboardEvent) => {
    if (
      event.ctrlKey ||
      event.altKey ||
      event.metaKey ||
      (event.target as HTMLElement).closest('input,select,textarea')
    )
      return;
    if (['+', '=', '-'].includes(event.key)) {
      event.preventDefault();
      zoom(event.key === '-' ? 1 / 1.5 : 1.5);
      return;
    }
    // Arrow keys pan the map only while the map itself (not a list or button) has focus.
    const pan = { ArrowLeft: [60, 0], ArrowRight: [-60, 0], ArrowUp: [0, 60], ArrowDown: [0, -60] }[
      event.key
    ];
    if (pan && event.target === canvas) {
      event.preventDefault();
      panWorldMap(canvas, player(), pan[0], pan[1]);
      redraw();
    }
  };
  dialog.addEventListener('keydown', keys);
  const resize = new ResizeObserver(() => {
    if (!canvas.isConnected || !dialog.open) {
      cleanup();
      return;
    }
    canvas.width = Math.max(100, wrap.clientWidth);
    canvas.height = Math.max(100, wrap.clientHeight);
    redraw();
  });
  const cleanup = () => {
    resize.disconnect();
    dialog.removeEventListener('keydown', keys);
    dialog.removeEventListener('close', cleanup);
  };
  dialog.addEventListener('close', cleanup);
  resize.observe(wrap);
  canvas.tabIndex = -1; // Focusable by click for arrow-key panning, without joining the controller's item list.
  redraw();
  updateMapWarp(player(), now(), connected());
}
