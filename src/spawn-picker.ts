import { SPAWN_SITES } from '../shared/spawn-sites.mjs';

/** The same six pictured destinations are used at departure and in the exhibition menu. */
export function spawnCardsMarkup(picked = '', warp = false) {
  return SPAWN_SITES.map(
    (site) =>
      `<button type="${warp ? 'button' : 'submit'}" class="spawn-card" data-${warp ? 'warp-spawn' : 'choose-spawn'}="${site.id}"${warp ? '' : ` aria-pressed="${site.id === picked}"`}><img src="/spawn/${site.id}.jpg" width="640" height="360" alt="" draggable="false"><strong>${site.name}</strong><small>${site.blurb}</small></button>`,
  ).join('');
}
