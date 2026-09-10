import { WARP_POINTS, warpPointById, warpUnavailable } from '../shared/warp-sites.mjs';
import { inGulf } from '../shared/gulf-region.mjs';
import { groupMapPoints } from './map-layout.js';
import {
  mapProjection,
  setWorldMapSelection,
  setWorldMapMode,
  setWorldMapDetails,
  centerWorldMap,
  zoomWorldMap,
  panWorldMap,
} from './world-map.js';

export function updateMapWarp(player, now, connected = true) {
  const button = document.querySelector<HTMLButtonElement>('#map-warp');
  if (!button) return;
  const point = warpPointById(document.querySelector<HTMLSelectElement>('#map-location').value);
  const reason = warpUnavailable(player, point, now);
  button.disabled = !!reason || !connected;
  button.setAttribute('aria-label', point ? `${point.name}へワープ` : 'ここへワープ');
  document.querySelector('#map-warp-status').textContent = !connected
    ? '接続を待っています。'
    : !point
      ? ''
      : reason || '';
}

export function installMapWarp({ player, now, action, icon, redraw, connected }) {
  const canvas = document.querySelector<HTMLCanvasElement>('#big-map');
  const wrap = canvas.parentElement;
  const root = document.querySelector<HTMLElement>('#warp-map-points');
  const clusters = document.querySelector<HTMLElement>('#map-clusters');
  const select = document.querySelector<HTMLSelectElement>('#map-location');
  const warp = document.querySelector<HTMLButtonElement>('#map-warp');
  let mode = inGulf(player()?.x, player()?.z) ? 'gulf' : 'earth';
  let clusterKey = '',
    details = false;
  setWorldMapDetails(false);
  const choose = (point, focus = true) => {
    select.value = point?.id ?? '';
    setWorldMapSelection(point);
    document.querySelector('#map-destination').textContent = point?.name ?? '';
    document.querySelector('#map-selection').textContent = point
      ? `${Math.round(Math.hypot(point.x - (player()?.x ?? 50), point.z - (player()?.z ?? 50)))} m`
      : '';
    if (point) {
      const [x, y] = mapProjection(canvas, true, player()).point(point.x, point.z);
      if (x < 40 || y < 40 || x > canvas.width - 40 || y > canvas.height - 40)
        centerWorldMap(point);
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
  const position = (el, x, y) => {
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  };
  const update = () => {
    const projection = mapProjection(canvas, true, player());
    const me = player();
    const [selfX, selfY] = projection.point(me?.x ?? 50, me?.z ?? 50);
    const selfMarker = document.querySelector<HTMLElement>('#map-self');
    selfMarker.hidden =
      !me || selfX < 12 || selfY < 12 || selfX > canvas.width - 12 || selfY > canvas.height - 12;
    position(selfMarker, selfX, selfY);
    selfMarker.style.setProperty('--facing', `${Math.PI - (me?.facing ?? 0)}rad`);
    const points = WARP_POINTS.map((point) => {
      const [x, y] = projection.point(point.x, point.z);
      return { point, x, y };
    }).filter(
      (p) => p.x >= 24 && p.y >= 24 && p.x <= canvas.width - 24 && p.y <= canvas.height - 24,
    );
    const groups = groupMapPoints(points);
    const singles = groups.filter((g) => g.length === 1).map((g) => g[0]);
    const selected = points.find((p) => p.point.id === select.value);
    if (selected && !singles.includes(selected)) singles.push(selected);
    const labels: { x: number; y: number; width: number }[] = [];
    for (const button of buttons) {
      const p = singles.find((p) => p.point.id === button.dataset.warpPoint);
      button.hidden = !p;
      button.setAttribute('aria-pressed', String(select.value === button.dataset.warpPoint));
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
      button.style.setProperty('--label-x', `${labelX - p.x + 20}px`);
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
          `近くの焚き火${group.length}か所を選ぶ：${group.map((p) => p.point.name).join('、')}`,
        );
        button.onclick = () => {
          document.querySelector<HTMLElement>('#map-nearby').hidden = false;
          const list = document.querySelector('#map-nearby-list');
          list.replaceChildren();
          for (const p of group) {
            const item = document.createElement('button');
            item.className = 'button button-outline';
            item.textContent = p.point.name;
            item.onclick = () => choose(p.point);
            list.append(item);
          }
          centerWorldMap({
            x: group.reduce((s, p) => s + p.point.x, 0) / group.length,
            z: group.reduce((s, p) => s + p.point.z, 0) / group.length,
          });
          zoomWorldMap(canvas, player(), 2);
          redraw();
          list.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true });
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
  };
  canvas.addEventListener('mapdraw', update);
  select.onchange = () => choose(warpPointById(select.value), false);
  warp.onclick = () => {
    const point = warpPointById(select.value);
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
      document.querySelector<HTMLElement>('#map-nearby').hidden = true;
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
  canvas.onwheel = (event) => {
    event.preventDefault();
    const rect = canvas.getBoundingClientRect();
    zoom(event.deltaY < 0 ? 1.2 : 1 / 1.2, {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    });
  };
  let drag = null;
  canvas.onpointerdown = (event) => {
    if (event.button !== 0) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
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
  redraw();
  updateMapWarp(player(), now(), connected());
}
