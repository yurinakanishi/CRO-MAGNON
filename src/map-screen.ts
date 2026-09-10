import { WARP_POINTS } from '../shared/warp-sites.mjs';
import { expeditionById } from '../shared/paleo-geography.mjs';
import { ADVENTURE_REGIONS } from '../shared/adventure-regions.mjs';
import { GULF } from '../shared/gulf-region.mjs';

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

/** Destination groups in travel order: home first, the gulf, each continent, then the adventure regions. */
export function warpGroups(): { name: string; points: (typeof WARP_POINTS)[number][] }[] {
  const groups: { name: string; points: (typeof WARP_POINTS)[number][] }[] = [];
  const adventure: (typeof WARP_POINTS)[number][] = [];
  for (const point of WARP_POINTS) {
    if (point.id.startsWith('adventure-fire-')) {
      adventure.push(point);
      continue;
    }
    const name = warpRegionName(point);
    const group = groups.find((g) => g.name === name);
    if (group) group.points.push(point);
    else groups.push({ name, points: [point] });
  }
  if (adventure.length) groups.push({ name: '探索の地域', points: adventure });
  return groups;
}

export function mapScreen(icon) {
  return `<section class="atlas" aria-label="世界地図とワープ">
    <nav class="earth-map-toolbar" aria-label="地図の範囲">
      <button class="button button-outline" id="map-overview" aria-pressed="true">世界全図</button>
      <button class="button button-outline" id="map-gulf" aria-pressed="false">${GULF.name}</button>
      <button class="button button-outline" id="map-local" aria-pressed="false">${icon('target')} 現在地</button>
      <button class="button button-outline" id="map-details" aria-pressed="false">探索の情報</button>
      <button class="button button-outline" id="map-pin-center">中央にピンを打つ</button>
    </nav>
    <div class="atlas-body">
      <div class="atlas-map-area">
        <div class="warp-map-wrap">
          <canvas id="big-map" width="960" height="600" class="big-map earth-map" aria-label="ドラッグで動かせる世界地図。焚き火のボタンか名前の一覧で行き先を選べます。"></canvas>
          <div id="warp-map-points" class="warp-map-points" aria-label="焚き火のワープ地点"></div>
          <div id="map-clusters" class="warp-map-points" aria-label="近くに集まった焚き火"></div>
          <div class="map-crosshair" aria-hidden="true">＋</div>
          <div class="map-pan" aria-label="地図を動かす">
            <button data-map-pan="left" aria-label="地図を西へ">←</button>
            <button data-map-pan="up" aria-label="地図を北へ">↑</button>
            <button data-map-pan="down" aria-label="地図を南へ">↓</button>
            <button data-map-pan="right" aria-label="地図を東へ">→</button>
          </div>
          <div id="map-self" aria-label="現在地"><i></i><span>▲</span><b>現在地</b></div>
          <div class="atlas-compass" aria-label="北が上">N<span>↑</span></div>
          <div class="atlas-legend"><span class="atlas-legend-fire">${icon('flame')} 焚き火</span><span class="atlas-legend-self">▲ 現在地</span></div>
          <div class="atlas-zoom" aria-label="地図の拡大と縮小">
            <button id="map-zoom-in" aria-label="地図を拡大">＋</button><output id="map-zoom-level">1×</output><button id="map-zoom-out" aria-label="地図を縮小">−</button>
          </div>
        </div>
      </div>
      <aside class="earth-travel" aria-label="ワープの行き先">
        <div class="atlas-card" id="map-card" data-state="empty">
          <div class="atlas-card-head">
            <div class="atlas-selection-icon">${icon('flame')}</div>
            <div class="atlas-card-text">
              <small id="map-region"></small>
              <h3 id="map-destination" aria-live="polite">場所を選ぼう</h3>
              <p id="map-selection">地図を押してピンを打つ</p>
            </div>
          </div>
          <button id="map-warp" class="button button-accent" disabled>ここへワープ<kbd>Enter</kbd></button>
          <div class="map-pin-actions">
            <button id="map-pin-send" class="button button-outline" disabled>ここへ行こう</button>
            <button id="map-pin-clear" class="button button-outline" disabled>自分のピンを消す</button>
          </div>
          <small id="map-pin-status" role="status">場所を選んで仲間に知らせる · 5分間</small>
          <small id="map-warp-status" role="status"></small>
        </div>
        <div class="atlas-list" id="map-list" role="listbox" aria-label="行き先の一覧">
          <div class="atlas-group" id="map-pin-list" aria-label="仲間のピン"></div>
          ${warpGroups()
            .map(
              (group) =>
                `<div class="atlas-group" data-group="${group.name}"><h4>${group.name}</h4>${group.points
                  .map(
                    (p) =>
                      `<button class="atlas-item" data-warp-item="${p.id}" role="option" aria-selected="false"><span>${p.name}</span><small></small></button>`,
                  )
                  .join('')}</div>`,
            )
            .join('')}
        </div>
      </aside>
    </div>
  </section>`;
}
