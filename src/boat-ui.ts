import { BOATING, launchPoint, initializeBoats } from '../shared/boats.mjs';
import { coastDistance, landmassAt } from '../shared/paleo-geography.mjs';

export function installBoatControls({ player, state, available, action, goTo, notify, renderer }) {
  const wrap = document.querySelector('.hotbar-wrap');
  wrap.insertAdjacentHTML(
    'afterbegin',
    `<div class="boat-controls"><button id="boat-shore" class="hunt-button">海岸へ</button><button id="boat-craft" class="hunt-button">船をつくる <small>木材12</small></button><button id="boat-board" class="hunt-button"><kbd>B</kbd><span>船に乗る</span></button><small id="boat-hint">1隻に1人 · 海岸でつくろう</small></div>`,
  );
  const $ = (s) => document.querySelector(s);
  $('#boat-craft').onclick = () => action('craftBoat');
  $('#boat-board').onclick = () => action('boardBoat');
  $('#boat-shore').onclick = () => {
    const p = player();
    if (!p) return;
    const room = { collision: renderer.collision, boats: [] };
    initializeBoats(room);
    room.boats = state().boats || [];
    const landmass = landmassAt(p.x, p.z);
    let best = null,
      score = Infinity;
    for (let x = p.x - 128; x <= p.x + 128; x += 2)
      for (let z = p.z - 128; z <= p.z + 128; z += 2) {
        const d = Math.hypot(x - p.x, z - p.z),
          coast = coastDistance(x, z);
        if (d >= score || coast < 0.4 || coast > 1.5 || landmassAt(x, z) !== landmass) continue;
        const q = { x, z, radius: p.radius };
        if (launchPoint(room, q)) {
          best = q;
          score = d;
        }
      }
    if (best) {
      if ($('#run-button').getAttribute('aria-pressed') !== 'true') $('#run-button').click();
      goTo(best.x, best.z, '船を作れる海岸');
    } else notify('近くに船を作れる海岸がありません。世界地図で海に近い場所へ移動しよう。');
  };
  return {
    update() {
      const p = player(),
        aboard = !!p?.boatId,
        disabled = !available() || !p || !!p.downedUntil;
      const near =
        p &&
        (state().boats || [])
          .filter((b) => !b.riderId)
          .some((b) => Math.hypot(b.x - p.x, b.z - p.z) <= BOATING.reach);
      $('#boat-board').disabled = disabled || !!p?.mountId || (!aboard && !near);
      $('#boat-board span').textContent = aboard ? '岸へ降りる' : '船に乗る';
      $('#boat-craft').disabled =
        disabled ||
        aboard ||
        !!p?.mountId ||
        !!p?.cookingEndsAt ||
        (p?.inventory.wood ?? 0) < BOATING.wood;
      $('#boat-shore').disabled = disabled || aboard || !!p?.mountId;
      $('#boat-hint').textContent = aboard
        ? 'WASD / 海面クリックで操船 · 2回押しで速く · 岸で B'
        : `部屋で共有 ${(state().boats || []).length}/${BOATING.maxBoats}隻 · 岸でつくろう`;
      wrap.classList.toggle('boating', aboard);
      const canvas = $('#world');
      canvas.dataset.boatId = p?.boatId || '';
      canvas.dataset.boatingVersion = String(state().boatingVersion || 0);
    },
  };
}
