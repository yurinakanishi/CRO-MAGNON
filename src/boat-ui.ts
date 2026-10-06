import {
  BOATING,
  carriedBoats,
  launchPoint,
  reachableBoat,
  SeaCollision,
} from '../shared/boats.mjs';
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
  const seaCollision = renderer.collision && new SeaCollision(renderer.collision);
  const boatWorld = () => ({
    collision: renderer.collision,
    shoreCollision,
    seaCollision,
    boats: state().boats || [],
  });
  const blocked = () => {
    const p = player(),
      now = state().serverTime ?? 0;
    return (
      !available() ||
      !p ||
      !!p.downedUntil ||
      !!p.mountId ||
      !!p.carrierId ||
      !!p.passengerId ||
      !!p.cookingEndsAt ||
      !!p.fishing ||
      !!p.coastalActivity ||
      jumpProgress(p, now) !== null ||
      !!(p.attackSequence && now - p.attackAt < attackProfile(p).durationMs)
    );
  };
  let launchKey = '',
    checkedAt = 0,
    cachedLaunch = null;
  function launchReason() {
    const p = player(),
      world = boatWorld();
    if (blocked() || p?.boatId) return '今は船を出せません。';
    if (!carriedBoats(p)) return '丸木舟を持っていません。';
    if (world.boats.length >= BOATING.maxBoats) return '水面の船がいっぱいです。';
    if (!world.collision || !seaCollision) return '水辺を確認しています。';
    // Cache between movement updates; also refresh for changing resource collisions.
    const key = JSON.stringify([
      p.x,
      p.z,
      p.radius,
      world.boats.map((b) => [b.id, b.x, b.z, b.riderId, b.mooring]),
    ]);
    if (key !== launchKey || Date.now() - checkedAt >= 200) {
      launchKey = key;
      checkedAt = Date.now();
      cachedLaunch = launchPoint(world, p);
    }
    return cachedLaunch ? '' : '船を浮かべられる海岸に近づこう。';
  }
  const wrap = document.querySelector('.hotbar-wrap');
  wrap.insertAdjacentHTML(
    'afterbegin',
    `<div class="boat-controls"><button id="boat-launch" class="hunt-button" hidden>船を出す</button><button id="boat-board" class="hunt-button" hidden><kbd>B</kbd><span>船に乗る</span></button><button id="boat-recover" class="hunt-button" hidden>船を回収</button><small id="boat-hint" hidden></small></div>`,
  );
  const $ = (s) => document.querySelector(s);
  $('#boat-launch').onclick = () => action('launchBoat');
  $('#boat-board').onclick = () => action('boardBoat');
  $('#boat-recover').onclick = () => {
    const boat = reachableBoat(boatWorld(), player());
    if (boat) action('recoverBoat', boat.id);
  };
  return {
    launchReason,
    update() {
      const p = player(),
        aboard = !!p?.boatId,
        disabled = blocked(),
        near = !disabled && !aboard && reachableBoat(boatWorld(), p),
        count = carriedBoats(p);
      $('#boat-board').disabled = disabled || (!aboard && !near);
      $('#boat-board').hidden = !aboard && !near;
      $('#boat-board span').textContent = aboard ? '岸へ降りる' : '船に乗る';
      $('#boat-launch').hidden = aboard || !count;
      $('#boat-launch').disabled = !!launchReason();
      $('#boat-recover').hidden = !near || aboard;
      $('#boat-recover').disabled = disabled || !near || count >= BOATING.inventoryLimit;
      // The board button already names its key and action, so the hint never repeats it.
      const hint = aboard
        ? 'WASDで操船 · 2回押しで速く'
        : near
          ? ''
          : count
            ? `丸木舟 ${count}隻を持っています · 水辺で船を出そう`
            : '';
      $('#boat-hint').textContent = hint;
      $('#boat-hint').hidden = !hint;
      wrap.classList.toggle('boating', aboard);
      const canvas = $('#world');
      canvas.dataset.boatId = p?.boatId || '';
      canvas.dataset.boatingVersion = String(state().boatingVersion || 0);
    },
  };
}
