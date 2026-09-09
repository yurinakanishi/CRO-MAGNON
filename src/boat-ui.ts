import { BOATING } from '../shared/boats.mjs';
import { installMaritimeUI } from './maritime-ui.js';
import { CollisionWorld } from '../shared/collision.mjs';
import { attackProfile } from '../shared/combat-profiles.mjs';
import { jumpProgress } from '../shared/jumping.mjs';

export function installBoatControls(api) {
  const { player, state, available, action, renderer } = api;
  const shoreCollision =
    renderer.collision &&
    new CollisionWorld(renderer.collision.obstacles, {
      active: renderer.collision.active,
      coast: false,
    });
  const wrap = document.querySelector('.hotbar-wrap');
  wrap.insertAdjacentHTML(
    'afterbegin',
    `<div class="boat-controls"><button id="boat-craft" class="hunt-button">船をつくる <small>木材12</small></button><button id="boat-board" class="hunt-button"><kbd>B</kbd><span>船に乗る</span></button><small id="boat-hint">1隻に1人 · 海岸でつくろう</small></div>`,
  );
  const $ = (s) => document.querySelector(s);
  const maritimeUI = installMaritimeUI(api);
  $('#boat-craft').onclick = () => action('craftBoat');
  $('#boat-board').onclick = () => action('boardBoat');
  return {
    update() {
      maritimeUI.update();
      const p = player(),
        aboard = !!p?.boatId,
        disabled = !available() || !p || !!p.downedUntil;
      const now = state().serverTime ?? 0;
      const near =
        p &&
        !p.cookingEndsAt &&
        jumpProgress(p, now) === null &&
        !(p.attackSequence && now - p.attackAt < attackProfile(p).durationMs) &&
        renderer.collision?.free(p, p.radius) &&
        (state().boats || [])
          .filter((b) => !b.riderId)
          .some(
            (b) =>
              Math.hypot(b.x - p.x, b.z - p.z) <= BOATING.reach &&
              shoreCollision?.segmentFree(p, b, 0.2),
          );
      $('#boat-board').disabled = disabled || !!p?.mountId || (!aboard && !near);
      $('#boat-board').hidden = !aboard && !near;
      $('#boat-board span').textContent = aboard ? '岸へ降りる' : '船に乗る';
      $('#boat-craft').disabled =
        disabled ||
        aboard ||
        !!p?.mountId ||
        !!p?.cookingEndsAt ||
        (p?.inventory.wood ?? 0) < BOATING.wood;
      $('#boat-hint').textContent = aboard
        ? 'WASDで操船 · 2回押しで速く · 岸で B'
        : near
          ? document.body.classList.contains('using-gamepad')
            ? '△ を押すと船に乗れます'
            : 'B を押すと船に乗れます'
          : `部屋で共有 ${(state().boats || []).length}/${BOATING.maxBoats}隻 · 自分で岸まで歩いてつくろう`;
      wrap.classList.toggle('boating', aboard);
      const canvas = $('#world');
      canvas.dataset.boatId = p?.boatId || '';
      canvas.dataset.boatingVersion = String(state().boatingVersion || 0);
    },
  };
}
