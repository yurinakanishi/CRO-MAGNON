import { WARP_POINTS } from '../shared/warp-sites.mjs';

export function mapScreen(icon) {
  return `<section class="atlas" aria-label="世界地図とワープ">
    <nav class="earth-map-toolbar" aria-label="地図の範囲">
      <button class="button button-outline" id="map-overview" aria-pressed="true">世界全図</button>
      <button class="button button-outline" id="map-gulf" aria-pressed="false">三つの岸</button>
      <button class="button button-outline" id="map-local" aria-pressed="false">${icon('target')} 現在地</button>
      <button class="button button-outline" id="map-details" aria-pressed="false">探索の情報</button>
    </nav>
    <div class="atlas-body">
      <div class="atlas-map-area">
        <div class="warp-map-wrap">
          <canvas id="big-map" width="960" height="600" class="big-map earth-map" aria-label="ドラッグで動かせる世界地図。焚き火のボタンか名前の一覧で行き先を選べます。"></canvas>
          <div id="warp-map-points" class="warp-map-points" aria-label="焚き火のワープ地点"></div>
          <div id="map-clusters" class="warp-map-points" aria-label="近くに集まった焚き火"></div>
          <div id="map-self" aria-label="現在地"><span>▲</span></div>
          <div class="atlas-compass" aria-label="北が上">N<span>↑</span></div>
          <div class="atlas-zoom" aria-label="地図の拡大と縮小">
            <button id="map-zoom-in" aria-label="地図を拡大">＋</button><output id="map-zoom-level">1×</output><button id="map-zoom-out" aria-label="地図を縮小">−</button>
          </div>
        </div>
        <div class="atlas-legend"><span class="atlas-legend-fire">${icon('flame')} ワープ</span><span class="atlas-legend-self">▲ 現在地</span></div>
      </div>
      <aside class="earth-travel" aria-label="ワープの行き先">
        <div class="atlas-selection-icon">${icon('flame')}</div>
        <h3 id="map-destination" aria-live="polite"></h3>
        <p id="map-selection"></p>
        <button id="map-warp" class="button button-accent" disabled>ここへワープ</button>
        <small id="map-warp-status" role="status"></small>
        <div id="map-nearby" hidden><p>このあたりの焚き火</p><div id="map-nearby-list"></div></div>
        <div class="atlas-location-picker"><label for="map-location">名前から選ぶ</label>
          <select id="map-location"><option value="">行き先を選ぶ…</option>${WARP_POINTS.map((s) => `<option value="${s.id}">${s.name}</option>`).join('')}</select>
        </div>
      </aside>
    </div>
  </section>`;
}
