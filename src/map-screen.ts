import { expeditionById } from '../shared/paleo-geography.mjs';
import { ADVENTURE_REGIONS } from '../shared/adventure-regions.mjs';
import { GULF } from '../shared/gulf-region.mjs';
import { MAP_ARROW_PATH, MAP_ARROW_SIZE } from './map-layout.js';

/** Where a fire sits, in the words the rest of the game already uses. */
export function warpRegionName(point: { id: string }): string {
  if (point.id.startsWith('gulf-fire-')) return GULF.name;
  if (point.id.startsWith('adventure-fire-'))
    return (
      ADVENTURE_REGIONS.find((r) => `adventure-fire-${r.id}` === point.id)?.kind ?? '探索の地域'
    );
  const stop = expeditionById(point.id.replace(/^fire-/, ''));
  return stop?.continent ?? 'はじまりの地';
}

export const MAP_EMPTY_PROMPT = '焚き火にポインタを合わせて ○';

/** The player arrow as inline SVG: the same shape the minimap draws on its canvas. */
export const mapArrowSvg = () =>
  `<svg class="map-arrow" viewBox="0 0 ${MAP_ARROW_SIZE} ${MAP_ARROW_SIZE}" aria-hidden="true"><path d="${MAP_ARROW_PATH}"/></svg>`;

/**
 * Full-bleed atlas: one canvas, a free pointer, a small destination card at the bottom left
 * and the zoom controls at the bottom right. No toolbar, no list.
 */
export function mapScreen(icon) {
  return `<section class="atlas" aria-label="世界地図とワープ">
    <div class="warp-map-wrap">
      <canvas id="big-map" width="960" height="600" class="big-map earth-map" aria-label="世界地図。ポインタを焚き火に合わせて決定するとワープ先になります。"></canvas>
      <div id="warp-map-points" class="warp-map-points" aria-label="焚き火のワープ地点"></div>
      <div id="map-self" aria-label="現在地"><i></i><span>${mapArrowSvg()}</span><b>現在地</b></div>
      <div id="map-cursor" class="map-cursor" aria-hidden="true"><i></i></div>
      <div class="atlas-compass" aria-label="北が上">N<span>↑</span></div>
      <div class="atlas-legend"><span class="atlas-legend-fire">${icon('flame')} 焚き火</span><span class="atlas-legend-self">${mapArrowSvg()} 現在地</span><span class="atlas-legend-enemy">✕ 敵</span></div>
      <div class="atlas-card" id="map-card" data-state="empty">
        <div class="atlas-card-text">
          <small id="map-region"></small>
          <h3 id="map-destination" aria-live="polite">${MAP_EMPTY_PROMPT}</h3>
          <p id="map-selection"></p>
        </div>
        <button id="map-warp" class="button button-accent" disabled>○ ワープ<kbd>Enter</kbd></button>
        <small id="map-warp-status" role="status"></small>
        <div class="map-pin-actions">
          <button id="map-pin-send" class="button button-outline" disabled>□ ここへ行こう</button>
          <button id="map-pin-clear" class="button button-outline" disabled>自分のピンを消す</button>
        </div>
        <small id="map-pin-status" role="status"></small>
      </div>
      <div class="atlas-zoom" aria-label="地図の拡大と縮小">
        <button id="map-zoom-in" aria-label="地図を拡大">＋</button><output id="map-zoom-level">4×</output><button id="map-zoom-out" aria-label="地図を縮小">−</button>
        <button id="map-center" class="atlas-center" aria-label="現在地へ戻る">現在地へ<kbd>R3</kbd></button>
      </div>
    </div>
  </section>`;
}
