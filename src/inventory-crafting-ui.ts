import {
  INVENTORY_RECIPES,
  CRAFT_MATERIAL_NAMES,
  craftedCount,
  inventoryCraftReason,
} from '../shared/inventory-crafting.mjs';
import { icon } from './icons.js';
import { setAttr, setText } from './hud-dom.js';

/** This section lives inside the bag. Its nodes remain stable across snapshots. */
export function installInventoryCrafting({ player, world, now, connected, request }) {
  let pending: string | null = null;
  const root = () => document.querySelector<HTMLElement>('#inventory-crafting');
  function markup() {
    pending = null;
    return `<section id="inventory-crafting" aria-labelledby="inventory-crafting-title"><div class="inventory-section-heading"><h3 id="inventory-crafting-title">つくる</h3><span>材料：所持 / 必要</span></div><p id="inventory-craft-result" role="status" aria-live="polite" aria-atomic="true">完成品は持ち物に追加されます</p><div class="inventory-recipes">${INVENTORY_RECIPES.map((r) => `<article class="inventory-recipe" data-recipe="${r.id}"><span class="resource-icon">${icon(r.icon)}</span><div class="inventory-recipe-info"><h4 id="recipe-name-${r.id}">${r.name}<small data-craft-owned></small></h4><p class="inventory-recipe-note">${r.note}</p><p class="inventory-recipe-materials" id="recipe-materials-${r.id}"></p><p class="inventory-recipe-reason" id="recipe-reason-${r.id}"></p></div><button type="button" class="button button-accent" data-craft="${r.id}" aria-labelledby="recipe-name-${r.id} recipe-button-${r.id}" aria-describedby="recipe-materials-${r.id} recipe-reason-${r.id}" aria-disabled="true"><span id="recipe-button-${r.id}">つくる</span></button></article>`).join('')}</div></section>`;
  }
  function status(text: string, ok = false) {
    const el = root()?.querySelector<HTMLElement>('#inventory-craft-result');
    if (!el) return;
    el.textContent = text;
    el.dataset.tone = ok ? 'success' : 'info';
  }
  function update() {
    const section = root();
    if (!section?.closest('dialog[open]')) return;
    const me = player(),
      worldState = world(),
      currentTime = now(),
      available = connected();
    if (pending && !connected()) {
      pending = null;
      status('接続が切れました。再接続後に持ち物を確認してください。');
    }
    for (const recipe of INVENTORY_RECIPES) {
      const row = section.querySelector<HTMLElement>(`[data-recipe="${recipe.id}"]`)!;
      const reason = available
        ? inventoryCraftReason(worldState, me, recipe, currentTime)
        : '接続を待っています';
      const button = row.querySelector<HTMLButtonElement>('button')!;
      setAttr(button, 'aria-disabled', !!reason || !!pending);
      setAttr(button, 'aria-busy', pending === recipe.id);
      setText(
        button.querySelector('span')!,
        pending === recipe.id ? '確認中…' : reason === '所持済み' ? '所持済み' : 'つくる',
      );
      setText(row.querySelector('[data-craft-owned]')!, `所持 ${craftedCount(me, recipe)}`);
      setText(row.querySelector('.inventory-recipe-reason')!, reason);
      const materials = Object.entries(recipe.cost).map(([key, count]) => {
        const owned = me?.inventory?.[key] ?? 0;
        return `<span${owned < count ? ' class="material-short"' : ''}>${CRAFT_MATERIAL_NAMES[key]} <b>${owned}/${count}</b></span>`;
      });
      for (const [key, count] of Object.entries(recipe.tools ?? {})) {
        const owned = me?.inventory?.[key] ?? 0;
        materials.push(
          `<span${owned < count ? ' class="material-short"' : ''}>打ち石 ${owned}/${count}（消費なし）</span>`,
        );
      }
      const html = materials.join('');
      const materialNode = row.querySelector<HTMLElement>('.inventory-recipe-materials')!;
      if (materialNode.innerHTML !== html) materialNode.innerHTML = html;
    }
  }
  function bind() {
    for (const button of root()?.querySelectorAll<HTMLButtonElement>('[data-craft]') ?? []) {
      button.onclick = () => {
        if (pending) return;
        const recipe = INVENTORY_RECIPES.find((r) => r.id === button.dataset.craft)!;
        const reason = connected()
          ? inventoryCraftReason(world(), player(), recipe, now())
          : '接続を待っています';
        if (reason) {
          status(reason);
          return;
        }
        pending = recipe.id;
        update();
        request(recipe.id);
      };
    }
    update();
  }
  function result(message) {
    if (message.recipeId !== pending) return;
    pending = null;
    status(message.text, message.ok);
    update();
  }
  return { markup, bind, update, result };
}
