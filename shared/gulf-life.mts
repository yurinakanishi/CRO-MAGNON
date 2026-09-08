import {
  GULF,
  GULF_STOPS,
  COUNTRIES,
  FARM_PLOTS,
  MANY_HEARTHS,
  SETTLEMENTS,
  SPRINGS,
} from './gulf-region.mjs';
import { interactionVisible } from './interactions.mjs';
import type { GulfProgress, GulfState } from './gulf-types.mjs';
import { createShoals } from './fishing-sites.mjs';
import { createShellBeds, createMiddens } from './coastal-sites.mjs';
import {
  CROP_INVENTORY,
  cropById,
  plotCrop,
  cropGrowMs,
  cropHarvestText,
  ROOT_RECIPES,
} from './crops.mjs';
export const GATHERING_NEEDS = Object.freeze({ wood: 8, berry: 12, obsidian: 4 });
export const SEASONS = [
  { name: '芽吹き', growMs: 180000 },
  { name: '夏の集い', growMs: 150000 },
  { name: '実り', growMs: 180000 },
  { name: '冬の炉', growMs: 240000 },
];
export const gulfSeason = (now: number, createdAt: number) =>
  SEASONS[Math.floor(Math.max(0, now - createdAt) / 720000) % 4];
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const count = (n, max = 999999) =>
  Number.isFinite(n) ? Math.max(0, Math.min(max, Math.floor(n))) : 0;
export function createGulfState(saved?): GulfState {
  return {
    shellBeds: createShellBeds(saved?.shellBeds),
    middens: createMiddens(saved?.middens),
    shoals: createShoals(saved?.shoals),
    version: GULF.version,
    plots: FARM_PLOTS.map((p) => {
      const old = saved?.plots?.find?.((s) => s.id === p.id);
      const stage = ['planted', 'growing', 'ripe'].includes(old?.stage) ? old.stage : 'empty';
      return {
        id: p.id,
        stage,
        cropId: plotCrop(old).id,
        readyAt: count(old?.readyAt, Number.MAX_SAFE_INTEGER),
      };
    }),
    stores: {
      wood: count(saved?.stores?.wood, 8),
      berry: count(saved?.stores?.berry, 12),
      obsidian: count(saved?.stores?.obsidian, 4),
    },
    festivals: count(saved?.festivals),
  };
}
export function ensureGulfPlayer(player): GulfProgress {
  for (const key of [
    ...CROP_INVENTORY,
    'rawShellfish',
    'cookedShellfish',
    'shells',
    'obsidianBlade',
  ])
    player.inventory[key] = count(player.inventory[key], 99);
  player.spearHead = player.spearHead === 'obsidian' ? 'obsidian' : 'wood';
  player.inventory.rawFish ??= 0;
  player.inventory.cookedFish ??= 0;
  player.inventory.obsidian ??= 0;
  player.inventory.seed ??= 0;
  player.inventory.water ??= 0;
  if (!player.gulf)
    player.gulf = {
      countryId: null,
      welcomed: false,
      visited: [],
      harvested: 0,
      procured: 0,
      delivered: 0,
      lastFeast: 0,
    };
  player.gulf.fishingKit ??= false;
  player.gulf.shellfishGathered ??= 0;
  player.gulf.shellsReturned ??= 0;
  player.gulf.bladesKnapped ??= 0;
  player.gulf.fishCaught ??= 0;
  player.gulf.fishShared ??= 0;
  player.gulf.waymarks ??= [];
  player.gulf.trailRewarded ??= false;
  return player.gulf;
}
export function updateGulf(room, now): boolean {
  room.gulf ??= createGulfState();
  let changed = false;
  for (const plot of room.gulf.plots)
    if (plot.stage === 'growing' && now >= plot.readyAt) {
      plot.stage = 'ripe';
      changed = true;
    }
  for (const player of room.players.values()) {
    const progress = ensureGulfPlayer(player);
    for (const s of SETTLEMENTS)
      if (!progress.visited.includes(s.id) && distance(player, s) <= 12) {
        progress.visited.push(s.id);
        changed = true;
      }
  }
  return changed;
}
export function handleGulfAction(room, player, message, now = Date.now()) {
  if (!message.action.startsWith('gulf')) return null;
  const fail = (text) => ({ ok: false, text });
  const ok = (text) => ({ ok: true, text });
  if (player.downedUntil || player.mountId || player.boatId)
    return fail('地上で動ける状態になってから行おう。');
  if (player.cookingEndsAt) return fail('調理を終えてから行おう。');
  const progress = ensureGulfPlayer(player),
    inv = player.inventory;
  room.gulf ??= createGulfState();
  const near = (point, range = 5) =>
    point && distance(player, point) <= range && interactionVisible(room.collision, player, point);
  const atHearth = near(MANY_HEARTHS, 9);
  const settlement = SETTLEMENTS.find((s) => near(s, 9));
  const action = message.action;
  if (action === 'gulfSurvey') {
    const stop = GULF_STOPS.find((s) => s.id === message.targetId);
    if (!stop || !near(stop, 8)) return fail('道の休み場の炉へ近づこう。');
    if (progress.waymarks.includes(stop.id)) return fail('この休み場は記録済みです。');
    progress.waymarks.push(stop.id);
    return ok(
      `${stop.name}を旅路に記録した。${progress.waymarks.length}/${GULF_STOPS.length}か所。`,
    );
  }
  if (action === 'gulfTrailReward') {
    if (!atHearth) return fail('集い場の炉へ戻って、旅路を伝えよう。');
    if (progress.trailRewarded) return fail('旅路のお礼は受け取り済みです。');
    if (!GULF_STOPS.every((s) => progress.waymarks.includes(s.id)))
      return fail('六つの休み場を訪れ、炉のそばで記録しよう。');
    if (inv.wood > 93 || inv.seed > 95) return fail('木材6・種4を入れる空きを作ろう。');
    inv.wood += 6;
    inv.seed += 4;
    progress.trailRewarded = true;
    return ok('六つの旅路を伝えた。次の旅のために、木材6・種4を受け取った。');
  }
  if (action === 'gulfWelcome') {
    if (!atHearth) return fail('集い場の大きな炉に近づこう。');
    if (progress.welcomed) return fail('旅支度は受け取り済み。ベリー2個から種を取り分けられます。');
    if (inv.seed > 93 || inv.berry > 96) return fail('種とベリーを入れる空きを作ろう。');
    progress.welcomed = true;
    inv.seed += 6;
    inv.berry += 3;
    return ok('湾へようこそ。種6・ベリー3を受け取った。畑、水場、三つの国を訪ねよう。');
  }
  if (action === 'gulfJoin') {
    const country = COUNTRIES.find((c) => c.id === message.targetId);
    if (!country || !near(country, 9)) return fail('その国の炉を訪ねて、仲間入りしよう。');
    if (progress.countryId === country.id) return fail('すでにこの国の仲間です。');
    progress.countryId = country.id;
    return ok(`${country.name}の仲間になった。種族を問わず、三つの国と集い場を訪ねられます。`);
  }
  if (action === 'gulfSeeds') {
    if (!settlement) return fail('どの国でも、炉のそばで種を取り分けられます。');
    const crop = cropById(message.cropId === undefined ? 'berry' : message.cropId);
    if (!crop) return fail('その作物の種はありません。');
    if (inv.berry < 2 || inv[crop.seed] > 97)
      return fail(`ベリー2個と、${crop.seedName}2個分の空きが必要です。`);
    inv.berry -= 2;
    inv[crop.seed] += 2;
    return ok(
      crop.id === 'berry'
        ? 'ベリー2個から、植える種を2個取り分けた。'
        : `ベリー2を渡し、${crop.seedName}2と交換した。どの集落の畑でも育てられます。`,
    );
  }
  if (action === 'gulfWater') {
    if (!SPRINGS.some((s) => near(s, 5))) return fail('石で囲った水場に近づこう。');
    if (inv.water >= 6) return fail('水袋はいっぱいです。畑に水をやろう。');
    inv.water = 6;
    return ok('水袋を満たした（水6）。火根草には水2、ベリーと香り草には水1。');
  }
  if (['gulfPlant', 'gulfTend', 'gulfHarvest'].includes(action)) {
    const spec = FARM_PLOTS.find((p) => p.id === message.targetId);
    if (!near(spec)) return fail('手入れする畑に近づこう。');
    const plot = room.gulf.plots.find((p) => p.id === spec.id);
    const crop = plotCrop(plot);
    if (plot.stage === 'growing' && now >= plot.readyAt) plot.stage = 'ripe';
    if (action === 'gulfPlant') {
      if (plot.stage !== 'empty') return fail('この区画にはすでに植えられています。');
      const chosen = cropById(message.cropId === undefined ? 'berry' : message.cropId);
      if (!chosen) return fail('その作物は植えられません。');
      if (inv[chosen.seed] < 1)
        return fail(`${chosen.seedName}が必要です。集落の炉で種を用意しよう。`);
      inv[chosen.seed]--;
      plot.cropId = chosen.id;
      plot.stage = 'planted';
      plot.readyAt = 0;
      return ok(`${chosen.name}を植えた。水${chosen.water}を運んで、この畑に水をやろう。`);
    }
    if (action === 'gulfTend') {
      if (plot.stage !== 'planted') return fail('種を植えた区画に一度、水をやれます。');
      if (inv.water < crop.water)
        return fail(`${crop.name}には水${crop.water}が必要です。近くの水場で水を汲もう。`);
      inv.water -= crop.water;
      plot.stage = 'growing';
      const duration = cropGrowMs(crop, gulfSeason(now, room.createdAt).growMs);
      plot.readyAt = now + duration;
      return ok(`${crop.name}に水をやった。${duration / 1000}秒で実ります。仲間も収穫できます。`);
    }
    if (plot.stage !== 'ripe') return fail('まだ実っていません。水をやり、成長を待とう。');
    if (inv[crop.harvest] > 99 - crop.yield || inv[crop.seed] > 97)
      return fail(`${cropHarvestText(crop)}を入れる空きを作ろう。畑はそのまま残ります。`);
    inv[crop.harvest] += crop.yield;
    inv[crop.seed] += 2;
    progress.harvested++;
    plot.stage = 'empty';
    plot.readyAt = 0;
    return ok(`収穫：${cropHarvestText(crop)}。空いた畑へ植え直せます。`);
  }
  if (action === 'gulfExchange') {
    if (!atHearth) return fail('集い場の炉で交換しよう。');
    if (inv.obsidian < 2 || inv.wood > 93 || inv.seed > 97)
      return fail('黒曜石2個と、木材6・種2の空きが必要です。');
    inv.obsidian -= 2;
    inv.wood += 6;
    inv.seed += 2;
    return ok('黒曜石2を渡し、舟や道具に使える木材6・種2と交換した。');
  }
  const rootFood = ROOT_RECIPES.find((recipe) => recipe.offerAction === action);
  if (action === 'gulfOffer' || action === 'gulfOfferFish' || rootFood) {
    if (!atHearth) return fail('集い場の炉へ持ち寄ろう。');
    const fish = action === 'gulfOfferFish';
    const key = fish || rootFood ? 'berry' : message.targetId;
    if (!Object.hasOwn(GATHERING_NEEDS, key)) return fail('持ち寄る品が見つかりません。');
    const amount = { wood: 2, berry: 3, obsidian: 1 }[key];
    if (room.gulf.stores[key] >= GATHERING_NEEDS[key])
      return fail('この品はそろいました。他の品を持ち寄ろう。');
    const item = rootFood ? rootFood.output : fish ? 'cookedFish' : key,
      cost = fish || rootFood ? 1 : amount;
    if (inv[item] < cost) return fail('持ち寄る品が足りません。');
    inv[item] -= cost;
    room.gulf.stores[key] = Math.min(GATHERING_NEEDS[key], room.gulf.stores[key] + amount);
    if (fish) progress.fishShared++;
    progress.delivered++;
    if (Object.entries(GATHERING_NEEDS).every(([k, n]) => room.gulf.stores[k] >= n)) {
      room.gulf.festivals++;
      room.gulf.stores = { wood: 0, berry: 0, obsidian: 0 };
      return ok('みんなの品がそろい、集いの宴が始まった！ 炉で食事と次の種を受け取ろう。');
    }
    return ok('集いの炉へ品を届けた。三つの国の誰でも、宴を準備できます。');
  }
  if (action === 'gulfFeast') {
    if (!atHearth) return fail('集い場の炉へ戻ろう。');
    if (room.gulf.festivals <= progress.lastFeast)
      return fail('次の宴へ、木材・食料（ベリー・焼き魚・焼き根）・黒曜石を持ち寄ろう。');
    if (inv.seed > 97 || inv.berry > 96) return fail('ベリー3・種2の空きを作ろう。');
    inv.seed += 2;
    inv.berry += 3;
    player.energy = Math.min(100, player.energy + 35);
    progress.lastFeast = room.gulf.festivals;
    return ok('宴を囲んだ。元気+35・ベリー3・種2。次の旅と畑へ。');
  }
  return fail('その湾の行動は使えません。');
}
