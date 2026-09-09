import {
  COUNTRIES,
  FARM_PLOTS,
  GULF_STOPS,
  inGulf,
  LANDINGS,
  MANY_HEARTHS,
  SETTLEMENTS,
  SPRINGS,
} from '../shared/gulf-region.mjs';
import { GATHERING_NEEDS, SEASONS } from '../shared/gulf-life.mjs';
import { interactionVisible } from '../shared/interactions.mjs';
import { CROPS, cropById, plotCrop, cropGrowMs, cropHarvestText } from '../shared/crops.mjs';
import { installPantryUI } from './pantry-ui.js';
import { installBarterUI } from './barter-ui.js';

const distance = (a, b) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : Infinity);
const stageName = { empty: '空き畑', planted: '水が必要', growing: '成長中', ripe: '収穫できる' };
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
export function gulfInteraction(state, me, collision) {
  if (!me || !inGulf(me.x, me.z)) return null;
  const visible = (p) => !collision || interactionVisible(collision, me, p);
  const stop = GULF_STOPS.find(
    (s) => distance(me, s) <= 8 && visible(s) && !me.gulf?.waymarks?.includes(s.id),
  );
  if (stop)
    return { action: 'gulfSurvey', targetId: stop.id, label: `${stop.name}を旅路に記録する` };
  const spring = SPRINGS.find((s) => distance(me, s) <= 5 && visible(s));
  if (spring && (me.inventory.water ?? 0) < 6)
    return { action: 'gulfWater', targetId: spring.id, label: '水袋を満たす（6回分）' };
  const spec = FARM_PLOTS.filter((p) => distance(me, p) <= 5 && visible(p)).sort(
    (a, b) => distance(me, a) - distance(me, b),
  )[0];
  const plot = spec && state.gulf?.plots.find((p) => p.id === spec.id);
  if (plot && plot.stage !== 'growing') {
    const crop = plotCrop(plot);
    return {
      action: { empty: 'gulfOpen', planted: 'gulfTend', ripe: 'gulfHarvest' }[plot.stage],
      targetId: spec.id,
      label: {
        empty: '育てる作物を選ぶ',
        planted: `${crop.name}に水をやる（水${crop.water}）`,
        ripe: `${cropHarvestText(crop)}を収穫する`,
      }[plot.stage],
    };
  }
  if (distance(me, MANY_HEARTHS) <= 9 && visible(MANY_HEARTHS) && !me.gulf?.welcomed)
    return { action: 'gulfWelcome', label: '湾の旅支度を受け取る（種6・ベリー3）' };
  const settlement = SETTLEMENTS.find((s) => distance(me, s) <= 9 && visible(s));
  if (settlement) return { action: 'gulfOpen', label: `${settlement.name}の炉を囲む` };
  return null;
}
export function installGulfUI(api) {
  const { player, state, available, action, openModal } = api;
  const pantry = installPantryUI(api, () => open());
  const barter = installBarterUI(api, () => open());
  let selected: string = MANY_HEARTHS.id,
    plotId = FARM_PLOTS[0].id,
    chosenCrop = 'berry',
    signature = '';
  $('#adventure-button').insertAdjacentHTML(
    'afterend',
    '<button id="gulf-button" class="adventure-launch gulf-launch"><span>◈ 三つの岸の湾</span><small id="gulf-status">国・畑・魚場</small></button>',
  );
  const at = (point, range = 9) => distance(player(), point) <= range;
  function open(requestedPlot?: string) {
    if (player() && inGulf(player().x, player().z)) {
      const nearest = [...SETTLEMENTS].sort(
        (a, b) => distance(player(), a) - distance(player(), b),
      )[0].id;
      if (nearest !== selected) {
        selected = nearest;
        plotId = FARM_PLOTS.filter((p) => p.settlementId === selected).sort(
          (a, b) => distance(player(), a) - distance(player(), b),
        )[0].id;
      }
    }
    const requested = FARM_PLOTS.find((p) => p.id === requestedPlot);
    if (requested) {
      selected = requested.settlementId;
      plotId = requested.id;
    }
    signature = '';
    openModal(
      `<div class="gulf-panel"><span class="eyebrow">THREE SHORES · A SHARED LIFE</span><h2>三つの国、ひとつの湾。</h2><p class="modal-intro">植え、育て、海を渡る。旅先で得たものを、多くの炉へ持ち帰ろう。</p><div id="gulf-summary" class="gulf-summary"></div><div class="gulf-tabs" role="group" aria-label="湾の集落">${SETTLEMENTS.map((s) => `<button data-gulf-tab="${s.id}">${s.name}</button>`).join('')}</div><section id="gulf-detail"></section><details class="gulf-lore"><summary>この世界について</summary><p>三つの国は、谷・尾根・海岸で暮らす人々の創作の国です。所属と種族は別で、ネアンデルタール人も他の種族も参加できます。国境を閉ざす壁はなく、集い場には誰でも入れます。</p><p>国、農耕、急速な作物の成長、通年の水場、湾の形はファンタジーです。地域ごとの採集、素材、道具、小舟と季節の集会に考古学の発想を使っています。</p><p>共同の畑は誰でも植え、手入れし、収穫できます。集い場では争いを持ち込まず、炉を囲んで話し合うという架空の取り決めがあります。現在の参加上限は運用上の制限で、国の人口ではありません。</p></details></div>`,
    );
    document.querySelectorAll<HTMLButtonElement>('[data-gulf-tab]').forEach(
      (button) =>
        (button.onclick = () => {
          selected = button.dataset.gulfTab;
          plotId = FARM_PLOTS.find((p) => p.settlementId === selected).id;
          signature = '';
          update();
        }),
    );
    update();
    if (requested) $('#gulf-crop-choice')?.focus();
  }
  function update() {
    pantry.update();
    barter.update();
    const me = player(),
      world = state(),
      country = COUNTRIES.find((c) => c.id === me?.gulf?.countryId);
    $('#gulf-status').textContent = barter.hint() || country?.name || '国・畑・魚場';
    if (!$('#gulf-detail')) return;
    const settlement = SETTLEMENTS.find((s) => s.id === selected),
      spec = FARM_PLOTS.find((p) => p.id === plotId);
    const plots = world.gulf?.plots ?? [],
      plot = plots.find((p) => p.id === plotId),
      inv = me?.inventory ?? {};
    const crop = plot && plot.stage !== 'empty' ? plotCrop(plot) : cropById(chosenCrop);
    const local = !!me && inGulf(me.x, me.z),
      nearCamp = at(settlement),
      nearHearth = at(MANY_HEARTHS);
    const season = SEASONS[Math.floor(((world.day ?? 1) - 1) / 3) % 4];
    const remaining =
      plot?.stage === 'growing'
        ? Math.max(0, Math.ceil((plot.readyAt - (world.serverTime ?? Date.now())) / 1000))
        : 0;
    const blocked =
      !available() ||
      !me ||
      !!me.downedUntil ||
      !!me.boatId ||
      !!me.mountId ||
      !!me.cookingEndsAt ||
      !!me.fishing ||
      !!me.coastalActivity;
    const sig = JSON.stringify([
      selected,
      plotId,
      chosenCrop,
      plots,
      inv,
      me?.gulf,
      world.gulf?.stores,
      world.gulf?.festivals,
      local,
      nearCamp,
      nearHearth,
      at(spec, 5),
      remaining,
      blocked,
      season.name,
      GULF_STOPS.map((s) => at(s, 8)),
    ]);
    if (sig === signature) return;
    signature = sig;
    const active = document.activeElement as HTMLElement;
    const focusId = $('#gulf-detail').contains(active) ? active.id : '';
    const focusedPlot = active?.dataset.plot;
    const wasPad = active?.classList.contains('gamepad-focus');
    const scrollTop = $<HTMLDialogElement>('#modal').scrollTop;
    $('#gulf-summary').textContent =
      `${season.name} · ${country?.name ?? '旅人（所属なし）'}　｜　訪問 ${me?.gulf?.visited.length ?? 0}/4 · 収穫 ${me?.gulf?.harvested ?? 0} · 黒曜石の採集 ${me?.gulf?.procured ?? 0}　｜　種 ${inv.seed ?? 0} · 水 ${inv.water ?? 0}/6 · 黒曜石 ${inv.obsidian ?? 0}`;
    document
      .querySelectorAll<HTMLButtonElement>('[data-gulf-tab]')
      .forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.gulfTab === selected)));
    const c = COUNTRIES.find((c) => c.id === selected),
      spring = SPRINGS.find((s) => s.id === `spring-${selected}`);
    const btn = (id, label, disabled = false, target = '') =>
      `<button class="button button-outline" id="${id}" ${blocked || disabled ? 'disabled' : ''} ${target ? `data-target="${target}"` : ''}>${label}</button>`;
    $('#gulf-detail').innerHTML =
      `<div class="gulf-banner" style="--gulf-color:${c?.color ?? '#d8ba78'}"><small>${c?.motto ?? '誰の旅も、ここで交わる'}</small><h3>${settlement.name}</h3><p>${c?.environment ?? '湾奥の浜と水場に近い共同の集い場。訪問者の天幕、作業の炉、畑、舟を引き上げる浜が集まる。'}</p></div>${c ? `<p class="gulf-story">${c.craft} ${c.custom}</p>` : '<p class="gulf-story">木材、実り、黒曜石を持ち寄り、宴を開こう。品を渡すだけでなく、種や技を教え合う場所。</p>'}<div class="gulf-actions">${c ? btn('gulf-join', me?.gulf?.countryId === c.id ? 'この国に所属中' : 'この国の仲間になる', !nearCamp || me?.gulf?.countryId === c.id) : btn('gulf-welcome', me?.gulf?.welcomed ? '旅支度は受取済み' : '旅支度を受け取る', !nearHearth || !!me?.gulf?.welcomed)}${btn('gulf-seeds', `ベリー2 → ${cropById(chosenCrop).seedName}2`, !nearCamp || (inv.berry ?? 0) < 2 || (inv[cropById(chosenCrop).seed] ?? 0) > 97)}</div>
      <div class="gulf-columns"><section class="gulf-card" id="gulf-farm-card"><h4>共同の畑 <small>12区画</small></h4><p>誰でも植え、育て、収穫できます。種は上の交換ボタンから、各集落の炉で用意できます。</p>
      <label class="crop-choice" for="gulf-crop-choice">次に植える作物・交換する種<select id="gulf-crop-choice">${CROPS.map((c) => `<option value="${c.id}" ${c.id === chosenCrop ? 'selected' : ''}>${c.name} · 種 ${inv[c.seed] ?? 0}</option>`).join('')}</select></label><p id="gulf-crop-guide">${cropById(chosenCrop).use} 水${cropById(chosenCrop).water} · 今の季節は${cropGrowMs(cropById(chosenCrop), season.growMs) / 1000}秒。</p>
      <div class="gulf-plots" role="group" aria-label="共同の畑">${FARM_PLOTS.filter(
        (p) => p.settlementId === selected,
      )
        .map((p, i) => {
          const stored = plots.find((v) => v.id === p.id),
            stage = stored?.stage ?? 'empty';
          const title = stage === 'empty' ? '空き畑' : plotCrop(stored).name;
          return `<button data-plot="${p.id}" class="stage-${stage}" aria-pressed="${p.id === plotId}" aria-label="畑${i + 1} ${title} ${stageName[stage]}"><b>${i + 1}</b><small>${title}</small><small>${stage === 'empty' ? '植えられる' : stageName[stage]}</small></button>`;
        })
        .join(
          '',
        )}</div><p id="gulf-plot-state">${crop.name} · ${stageName[plot?.stage ?? 'empty']}${remaining ? ` · あと ${remaining}秒` : ''}<br>収穫：${cropHarvestText(crop)}<br>${crop.seedName} ${inv[crop.seed] ?? 0} · 水 ${inv.water ?? 0}/6</p><div class="gulf-actions">${btn('gulf-farm', plot?.stage === 'planted' ? `水をやる（水${crop.water}）` : plot?.stage === 'ripe' ? `${crop.name}を収穫する` : `${crop.name}を植える（種1）`, !at(spec, 5) || plot?.stage === 'growing' || (plot?.stage === 'planted' ? (inv.water ?? 0) < crop.water : plot?.stage === 'ripe' ? (inv[crop.harvest] ?? 0) > 99 - crop.yield || (inv[crop.seed] ?? 0) > 97 : (inv[crop.seed] ?? 0) < 1))}${btn('gulf-water', '水袋を満たす', !at(spring, 5))}${btn('gulf-crop-food', '火根と香草の食事')}</div></section>
      <section class="gulf-card"><h4>持ち寄りと交換 <small>宴 ${world.gulf?.festivals ?? 0}回</small></h4><p>集い場の炉で交換・寄付できます。人数にかかわらず少しずつ準備できます。</p><div class="gulf-stores">${Object.entries(
        GATHERING_NEEDS,
      )
        .map(
          ([k, n]) =>
            `<div><span>${{ wood: '木材', berry: '食料', obsidian: '黒曜石' }[k]}</span><b>${world.gulf?.stores[k] ?? 0} / ${n}</b><progress max="${n}" value="${world.gulf?.stores[k] ?? 0}"></progress></div>`,
        )
        .join(
          '',
        )}</div><div class="gulf-actions">${btn('gulf-offer-wood', '木材2を届ける', !nearHearth)}${btn('gulf-offer-berry', 'ベリー3を届ける', !nearHearth)}${btn('gulf-offer-obsidian', '黒曜石1を届ける', !nearHearth)}${btn('gulf-exchange', '黒曜石2 → 木材6・種2', !nearHearth)}${btn('gulf-feast', '宴を囲む', !nearHearth || (world.gulf?.festivals ?? 0) <= (me?.gulf?.lastFeast ?? 0))}</div><p>黒曜石は西の尾根の露頭で採集。木材は舟や道具へ、種は次の畑へ。</p></section></div>
      <section class="gulf-routes"><h4>湾を巡る道</h4><p>五つの浜と二つの沖の魚場で釣ろう。焼き魚1を食料3として宴に持ち寄れます。</p><button id="gulf-fishing" class="button button-outline">魚場と釣り方</button><p>湾奥を回る陸路はいつでも使えます。浜で木材12から小舟を作り、Bで乗降。対岸への短い航路も使えます。</p><div class="gulf-actions">${LANDINGS.map((l) => `<span class="gulf-card">${l.name}</span>`).join('')}</div></section>`;
    $('#gulf-detail').insertAdjacentHTML(
      'beforeend',
      `<section class="gulf-routes"><h4>六つの休み場を巡る <small>${me?.gulf?.waymarks?.length ?? 0}/${GULF_STOPS.length}</small></h4><p>湾は1,480 × 1,340 m。炉のそばでE／×を使い、道を記録しよう。各地で水と採集資源を補給できます。</p><div class="gulf-stop-list">${GULF_STOPS.map((s) => `<article class="gulf-card"><h4>${s.name}${me?.gulf?.waymarks?.includes(s.id) ? ' · 記録済み' : ''}</h4><p>${s.description}</p><div class="gulf-actions">${btn(`trail-record-${s.id}`, '旅路を記録する', !at(s, 8) || me?.gulf?.waymarks?.includes(s.id))}</div></article>`).join('')}</div><p>すべて巡って集い場へ戻ると、次の旅の木材6・種4を一度受け取れます。</p>${btn('gulf-trail-reward', me?.gulf?.trailRewarded ? '旅路のお礼は受取済み' : '集い場で旅路を伝える', !nearHearth || !!me?.gulf?.trailRewarded || !GULF_STOPS.every((s) => me?.gulf?.waymarks?.includes(s.id)))}</section>`,
    );
    $('#gulf-fishing').insertAdjacentHTML(
      'afterend',
      ' <button id="gulf-weather" class="button button-outline">空と航路</button>',
    );
    $('#gulf-weather').onclick = () => $('#boat-weather').click();
    const bind = (id, fn) => {
      const node = $<HTMLButtonElement>('#' + id);
      if (node) node.onclick = fn;
    };
    bind('gulf-fishing', () => action('fishingOpen'));
    document
      .querySelector('#gulf-fishing')
      .insertAdjacentHTML(
        'afterend',
        '<button id="gulf-coastal" class="button button-outline">貝と石器の作り方</button><button id="gulf-residents" class="button button-outline">集落の人びと・今日の手伝い</button><button id="gulf-pantry" class="button button-outline">共同の食料置き場</button>',
      );
    bind('gulf-coastal', () => action('coastalOpen'));
    bind('gulf-residents', () => action('residentOpen'));
    bind('gulf-pantry', () => pantry.open(selected));
    $('#gulf-detail')
      .querySelector('#gulf-pantry')
      .insertAdjacentHTML(
        'afterend',
        '<button id="gulf-barter" class="button button-outline">旅人と物々交換</button>',
      );
    bind('gulf-barter', () => barter.open());

    bind('gulf-join', () => action('gulfJoin', selected));
    bind('gulf-welcome', () => action('gulfWelcome'));
    bind('gulf-seeds', () => action('gulfSeeds', undefined, chosenCrop));
    bind('gulf-crop-food', () => action('cropFoodOpen'));
    $<HTMLSelectElement>('#gulf-crop-choice').onchange = (event) => {
      chosenCrop = (event.target as HTMLSelectElement).value;
      update();
    };

    bind('gulf-water', () => action('gulfWater', spring.id));
    bind('gulf-farm', () =>
      action(
        plot?.stage === 'planted'
          ? 'gulfTend'
          : plot?.stage === 'ripe'
            ? 'gulfHarvest'
            : 'gulfPlant',
        plotId,
        chosenCrop,
      ),
    );
    for (const key of Object.keys(GATHERING_NEEDS))
      bind(`gulf-offer-${key}`, () => action('gulfOffer', key));
    bind('gulf-exchange', () => action('gulfExchange'));
    bind('gulf-feast', () => action('gulfFeast'));
    bind('gulf-trail-reward', () => action('gulfTrailReward'));
    for (const stop of GULF_STOPS) {
      bind(`trail-record-${stop.id}`, () => action('gulfSurvey', stop.id));
    }

    document.querySelectorAll<HTMLButtonElement>('[data-plot]').forEach(
      (b) =>
        (b.onclick = () => {
          plotId = b.dataset.plot;
          signature = '';
          update();
        }),
    );
    const replacement = focusId
      ? document.getElementById(focusId)
      : focusedPlot
        ? document.querySelector<HTMLElement>(`[data-plot="${focusedPlot}"]`)
        : null;
    if (replacement && !replacement.matches(':disabled')) {
      replacement.focus({ preventScroll: true });
      if (wasPad) replacement.classList.add('gamepad-focus');
    }
    $<HTMLDialogElement>('#modal').scrollTop = scrollTop;
  }
  $('#gulf-button').onclick = () => open();
  return { open, update };
}
