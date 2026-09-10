import { WARP_POINTS, warpPointById, warpUnavailable } from '../shared/warp-sites.mjs';
import { mapProjection, setWorldMapSelection } from './world-map.js';

export function updateMapWarp(player, now, connected = true) {
  const button = document.querySelector<HTMLButtonElement>('#map-warp');
  if (!button) return;
  const select = document.querySelector<HTMLSelectElement>('#map-location');
  const point = warpPointById(select.value);
  const reason = warpUnavailable(player, point, now);
  button.disabled = !!reason || !connected;
  document.querySelector('#map-warp-status').textContent = !connected
    ? '接続を待っています。'
    : reason || '無料 · 持ち物と元気はそのまま · 選んだ焚き火のそばへ移動';
  button.textContent = point ? `${point.name}へワープ` : 'ここへワープ';
}

export function installMapWarp({ player, now, action, selectTarget, icon }) {
  const root = document.querySelector('#warp-map-points');
  const panel = document.querySelector<HTMLElement>('.earth-travel');
  document.querySelector('.warp-map-wrap').before(panel);
  const choose = (point) => {
    selectTarget(point);
    panel.scrollIntoView({ block: 'nearest' });
  };
  const select = document.querySelector<HTMLSelectElement>('#map-location');
  root.innerHTML = WARP_POINTS.map(
    (p) =>
      `<button class="warp-map-point" data-warp-point="${p.id}" title="${p.name}" aria-label="${p.name}の焚き火を選ぶ" aria-pressed="false">${icon('flame')}</button>`,
  ).join('');
  const update = () => {
    const canvas = document.querySelector<HTMLCanvasElement>('#big-map');
    const projection = mapProjection(canvas, true, player());
    for (const button of root.querySelectorAll<HTMLButtonElement>('[data-warp-point]')) {
      const point = warpPointById(button.dataset.warpPoint),
        [x, y] = projection.point(point.x, point.z);
      button.hidden = x < 0 || y < 0 || x > canvas.width || y > canvas.height;
      button.style.left = `${(x / canvas.width) * 100}%`;
      button.style.top = `${(y / canvas.height) * 100}%`;
      button.setAttribute('aria-pressed', String(select.value === point.id));
    }
  };
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-warp-point]'))
    button.onclick = () => choose(warpPointById(button.dataset.warpPoint));
  select.onchange = () => {
    const point = warpPointById(select.value);
    if (point) selectTarget(point);
    else {
      setWorldMapSelection(null);
      document.querySelector('#map-selection').textContent = '炎マークか一覧から行き先を選ぼう。';
      updateMapWarp(player(), now());
      update();
    }
  };
  document.querySelector<HTMLButtonElement>('#map-warp').onclick = () => {
    const point = warpPointById(select.value);
    if (point && !warpUnavailable(player(), point, now())) action('warp', point.id);
  };
  return update;
}
