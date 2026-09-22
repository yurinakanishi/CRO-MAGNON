import { SPAWN_SITES } from '../shared/spawn-sites.mjs';
import { warpUnavailable } from '../shared/warp-sites.mjs';
import { spawnCardsMarkup } from './spawn-picker.js';

export function exhibitionWarpMarkup() {
  return `<div id="exhibition-warp"><h2>ワープする</h2><div class="spawn-grid" role="group" aria-label="ワープする場所">${spawnCardsMarkup('', true)}</div><p id="exhibition-warp-status" class="form-note" role="status"></p></div>`;
}

export function updateExhibitionWarp(player, now, connected) {
  const status = document.querySelector<HTMLElement>('#exhibition-warp-status');
  if (!status) return;
  const reason = connected ? warpUnavailable(player, SPAWN_SITES[0], now) : '接続を待っています。';
  status.textContent = reason;
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-warp-spawn]'))
    button.setAttribute('aria-disabled', String(!!reason));
}

export function bindExhibitionWarp({ player, now, connected, action }) {
  for (const button of document.querySelectorAll<HTMLButtonElement>('[data-warp-spawn]')) {
    button.onclick = () => {
      updateExhibitionWarp(player(), now(), connected());
      if (button.getAttribute('aria-disabled') === 'true') return;
      action('warp', `spawn-${button.dataset.warpSpawn}`);
    };
  }
  updateExhibitionWarp(player(), now(), connected());
}
