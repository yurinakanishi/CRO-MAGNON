import { BOATING } from './boats.mjs';
import { COASTAL } from './coastal-sites.mjs';
import { ROOT_RECIPES } from './crops.mjs';
import { characterModel } from './characters.mjs';
import { attackProfile } from './combat-profiles.mjs';
import { jumpProgress } from './jumping.mjs';
import { HUNTING, usableCookingFire } from './hunting.mjs';
import { ensureGulfPlayer } from './gulf-life.mjs';

export interface InventoryRecipe {
  id: string;
  name: string;
  icon: string;
  cost: Record<string, number>;
  output?: string;
  equipment?: 'axe' | 'spear';
  fire?: boolean;
  note: string;
  tools?: Record<string, number>;
}

export const INVENTORY_RECIPES: readonly InventoryRecipe[] = [
  {
    id: 'axe',
    name: '石斧',
    icon: 'axe',
    cost: { wood: 3, stone: 2 },
    equipment: 'axe',
    note: '木材・石の採集量が2倍',
  },
  {
    id: 'boat',
    name: '丸木舟',
    icon: 'boat',
    cost: { wood: BOATING.wood },
    output: 'boat',
    note: '持ち運んで、水辺で出せる',
  },
  {
    id: 'blade',
    name: '黒曜石の刃',
    icon: 'blade',
    cost: { obsidian: COASTAL.obsidianCost },
    tools: { stone: 1 },
    output: 'obsidianBlade',
    note: '黒曜石の槍の材料',
  },
  {
    id: 'spear',
    name: '黒曜石の槍',
    icon: 'spear',
    cost: { obsidianBlade: 1, wood: COASTAL.haftWood },
    equipment: 'spear',
    note: '木槍を強化・攻撃力2倍',
  },
  {
    id: 'meat',
    name: '焼き肉',
    icon: 'meat',
    cost: { rawMeat: 1 },
    output: 'cookedMeat',
    fire: true,
    note: `HP +${HUNTING.cookedMeatEnergy}`,
  },
  {
    id: 'fish',
    name: '焼き魚',
    icon: 'wave',
    cost: { rawFish: 1 },
    output: 'cookedFish',
    fire: true,
    note: 'HP +30',
  },
  {
    id: 'shellfish',
    name: '焼いた貝',
    icon: 'shell',
    cost: { rawShellfish: 1 },
    output: 'cookedShellfish',
    fire: true,
    note: 'HP +20',
  },
  ...ROOT_RECIPES.map((recipe) => ({
    id: recipe.kind,
    name: recipe.name,
    icon: recipe.output,
    cost: Object.fromEntries(Object.entries(recipe.ingredients).filter(([, n]) => n > 0)),
    output: recipe.output,
    fire: true,
    note: `HP +${recipe.energy}`,
  })),
];

export const CRAFT_MATERIAL_NAMES: Record<string, string> = {
  wood: '木材',
  stone: '石',
  obsidian: '黒曜石',
  obsidianBlade: '黒曜石の刃',
  rawMeat: '生肉',
  rawFish: '生魚',
  rawShellfish: '生の貝',
  rawRoot: '火根',
  herb: '香草',
};

export function craftedCount(player, recipe: InventoryRecipe): number {
  if (recipe.equipment === 'axe') return player?.tool ? 1 : 0;
  if (recipe.equipment === 'spear') return player?.spearHead === 'obsidian' ? 1 : 0;
  return player?.inventory?.[recipe.output!] ?? 0;
}

/** Shared checks keep the recipe UI and the authoritative transaction in agreement. */
export function inventoryCraftReason(room, player, recipe: InventoryRecipe, now: number): string {
  if (!player) return '接続を待っています';
  if (player.downedUntil) return '回復を待っています';
  if (player.mountId || player.boatId || player.carrierId || player.passengerId)
    return '地上に降りると作れます';
  if (
    player.cookingEndsAt ||
    player.fishing ||
    player.coastalActivity ||
    jumpProgress(player, now) !== null ||
    (player.attackSequence && now - player.attackAt < attackProfile(player).durationMs)
  )
    return '今の動作が終わると作れます';
  if (recipe.equipment === 'spear' && characterModel(player).weapon)
    return '木槍を使うキャラクター用';
  if (recipe.equipment && craftedCount(player, recipe)) return '所持済み';
  if (!recipe.equipment && craftedCount(player, recipe) >= HUNTING.inventoryLimit)
    return '所持数が上限です';
  if (recipe.fire && !usableCookingFire(room, player, room.collision))
    return '焚き火のそばで作れます';
  const missing = Object.entries(recipe.cost)
    .filter(([key, n]) => (player.inventory[key] ?? 0) < n)
    .map(([key, n]) => `${CRAFT_MATERIAL_NAMES[key]} あと${n - (player.inventory[key] ?? 0)}`);
  if (missing.length) return missing.join('・');
  if (Object.entries(recipe.tools ?? {}).some(([key, n]) => (player.inventory[key] ?? 0) < n))
    return '打ち石に使う石が1個必要です';
  return '';
}

/** No world task or timer: validate everything before spending any materials. */
export function craftInventory(room, player, id: unknown, now: number) {
  const recipe = INVENTORY_RECIPES.find((entry) => entry.id === id);
  if (!recipe) return { ok: false, text: 'この品は作れません。' };
  const reason = inventoryCraftReason(room, player, recipe, now);
  if (reason) return { ok: false, text: reason };
  for (const [key, n] of Object.entries(recipe.cost)) player.inventory[key] -= n;
  if (recipe.equipment === 'axe') player.tool = true;
  else if (recipe.equipment === 'spear') player.spearHead = 'obsidian';
  else player.inventory[recipe.output!] = craftedCount(player, recipe) + 1;
  if (recipe.id === 'blade') {
    ensureGulfPlayer(player).bladesKnapped++;
    player.energy = Math.max(0, player.energy - 2);
  }
  return { ok: true, text: `${recipe.name}を持ち物に追加しました。` };
}
