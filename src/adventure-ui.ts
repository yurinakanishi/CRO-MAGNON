import {
  ADVENTURE_REGIONS,
  regionAt,
  regionById,
  adventureProgress,
  regionComplete,
  travelSeals,
  riftNear,
  RIFTS,
} from '../shared/adventure-regions.mjs';
const labels = { stone: '石', wood: '木材', berry: 'ベリー', cookedMeat: '焼き肉' };
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function adventureInteraction(player, collision) {
  const rift = riftNear(player);
  if (rift && (!collision || collision.segmentFree(player, rift, 0.12)))
    return {
      action: 'rift',
      targetId: rift.id,
      label: rift.exit
        ? '地上へ戻る'
        : travelSeals(player) >= 3
          ? '裂け目から影の世界へ'
          : '裂け目を調べる（旅の証3つ）',
    };
  const region = player && regionAt(player.x, player.z);
  if (
    region &&
    distance(player, region.camp) <= 5 &&
    (!collision || collision.segmentFree(player, region.camp, 0.12))
  ) {
    if (regionComplete(player, region) && !adventureProgress(player, region.id).claimed)
      return { action: 'claimAdventure', targetId: region.id, label: '地域の依頼を報告する' };
    if (player.energy < 100) return { action: 'rest', label: '焚き火で休む（元気 +35）' };
  }
  return null;
}
export function installAdventureUI(api) {
  const { player, state, openModal, goTo, action, send, stopInput, available, notify } = api;
  let selected = 'high-pass',
    signature = '';
  document
    .querySelector<HTMLElement>('.map-hud .connection')
    .insertAdjacentHTML(
      'afterend',
      '<button id="adventure-button" class="adventure-launch"><span>✧ 探索手帳</span><small id="adventure-count">6つの新しい旅</small></button>',
    );
  const close = () => document.querySelector<HTMLDialogElement>('#modal').close();
  function travel(region) {
    if (!available()) return;
    const me = player();
    if (me?.mountId || me?.boatId) return notify('船やマンモスから降りてから遠征しよう。');
    stopInput();
    send({ type: 'expedition', destination: region.id });
    close();
  }
  function nextObjective(region) {
    const p = adventureProgress(player(), region.id);
    const next = region.checkpoints.find((c) => !p.visited.includes(c.id));
    if (next) return next;
    if (p.gathered < region.amount) {
      const resource = state()
        .resources.filter(
          (r) => r.regionId === region.id && r.type === region.material && r.amount > 0,
        )
        .sort((a, b) => distance(player(), a) - distance(player(), b))[0];
      if (resource)
        return { x: resource.x - 1.8, z: resource.z, name: `${labels[region.material]}の採集地点` };
      return { ...region.camp, name: '資源の再生を待つ野営地' };
    }
    if (p.kills < region.kills) {
      const enemy = state().enemies?.find(
        (e) =>
          e.id.startsWith(`guardian-${region.id}-`) &&
          !(p.defeated ?? []).includes(e.id) &&
          e.phase === 'alive',
      );
      if (enemy) return { x: enemy.x, z: enemy.z + 3, name: enemy.name };
      return { ...region.camp, name: '番人の帰還を待つ野営地' };
    }
    return { ...region.camp, name: '報告する野営地' };
  }
  function open(id?) {
    selected = regionById(id)?.id ?? regionAt(player()?.x, player()?.z)?.id ?? selected;
    signature = '';
    openModal(
      `<div class="adventure-heading"><span class="eyebrow">BEYOND THE FIRST FIRE</span><h2>まだ見ぬ世界へ。</h2><p class="modal-intro">山の向こう、谷の奥、裂け目の先。旅の証を3つ集めて、影の世界を開こう。</p><div id="adventure-summary" class="adventure-summary"></div></div><div class="adventure-browser"><nav class="adventure-regions" aria-label="探索地域">${ADVENTURE_REGIONS.map((r) => `<button data-region="${r.id}" style="--region-color:${r.color}"><small>${r.kind}</small><strong>${r.name}</strong><span data-region-status="${r.id}">未発見</span></button>`).join('')}</nav><section id="adventure-detail" aria-live="polite"></section></div><p class="form-note">地上の地域へは遠征できます。道標は近づくと記録。討伐は24 m以内の仲間も達成。報酬は各地域で一度だけ受け取れます。</p>`,
    );
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-region]'))
      button.onclick = () => {
        selected = button.dataset.region;
        signature = '';
        update();
      };
    update();
  }
  function update() {
    const me = player(),
      seals = travelSeals(me),
      found = Object.keys(me?.adventure?.regions ?? {}).length,
      region = regionById(selected);
    document.querySelector<HTMLButtonElement>('#adventure-count').textContent =
      `発見 ${found}/6 · 旅の証 ${seals}/5`;
    if (!document.querySelector<HTMLButtonElement>('#adventure-detail')) return;
    document.querySelector<HTMLButtonElement>('#adventure-summary').textContent = adventureProgress(
      me,
      'shadow-realm',
    ).claimed
      ? '✦ 境界を渡る者 · 影の庭を踏破'
      : `発見 ${found}/6　旅の証 ${seals}/5　${seals >= 3 ? '✧ 影の世界へ進めます' : '裂け目の解放まで あと' + (3 - seals) + '地域'}`;
    for (const button of document.querySelectorAll<HTMLButtonElement>('[data-region]')) {
      const id = button.dataset.region,
        p = adventureProgress(me, id);
      button.setAttribute('aria-pressed', String(id === selected));
      button.querySelector<HTMLButtonElement>('[data-region-status]').textContent = p.claimed
        ? '✓ 達成'
        : me?.adventure?.regions[id]
          ? '探索中'
          : id === 'shadow-realm' && seals < 3
            ? '旅の証 3つで解放'
            : '未発見';
    }
    const p = adventureProgress(me, region.id),
      here = !!me && regionAt(me.x, me.z)?.id === region.id;
    const atCamp = here && distance(me, region.camp) <= 5,
      nearRift = riftNear(me),
      ready = regionComplete(me, region),
      blocked = !available() || !me || !!me.downedUntil || !!me.mountId || !!me.boatId;
    const sig = JSON.stringify([selected, p, here, atCamp, nearRift?.id, ready, blocked, seals]);
    if (sig === signature) return;
    signature = sig;
    const root = document.querySelector<HTMLButtonElement>('#adventure-detail');
    const next = nextObjective(region);
    root.innerHTML = `<div class="adventure-panorama scene-${region.id}" aria-hidden="true"><span>${region.kind}</span><b>${region.realm ? '✧' : '△'}</b></div><small class="eyebrow">${region.kind} · ${region.kills ? '番人との遭遇あり' : '穏やかな探索'}</small><h3>${region.name}</h3><p>${region.description}</p><blockquote>${region.story}</blockquote><div class="adventure-checks">${region.checkpoints.map((c) => `<div class="${p.visited.includes(c.id) ? 'complete' : ''}">${p.visited.includes(c.id) ? '✓' : '○'} ${c.name}</div>`).join('')}${region.amount ? `<div class="${p.gathered >= region.amount ? 'complete' : ''}">${labels[region.material]}を現地で採集 <b>${p.gathered}/${region.amount}</b></div>` : ''}${region.kills ? `<div class="${p.kills >= region.kills ? 'complete' : ''}">番人を討伐 <b>${p.kills}/${region.kills}</b></div>` : ''}</div><p class="adventure-reward">報酬：${region.realm ? '称号「境界を渡る者」' : '旅の証 ×1'} · ${Object.entries(
      region.reward,
    )
      .map(([k, v]) => `${labels[k]} ×${v}`)
      .join(
        ' · ',
      )}</p><div class="adventure-actions"><button id="adventure-travel" class="button button-accent">${here ? '次の目標へ' : region.realm ? (seals >= 3 ? '星の裂け目へ' : '旅の証を3つ集めよう') : 'この地域へ遠征'}</button><button id="adventure-camp" class="button button-outline">${p.claimed ? '野営地へ' : ready ? '報告する' : '野営地へ'}</button><button id="adventure-rest" class="button button-outline">休息 +35</button></div><small class="adventure-next">${here ? `次：${next.name} · ${Math.round(distance(me, next))} m` : '現地で歩いて道標を探そう。'}${region.realm && !here ? ' 石の森の裂け目から入れます。' : ''}</small>`;
    const travelButton = root.querySelector<HTMLButtonElement>('#adventure-travel');
    travelButton.disabled = blocked || (region.realm && !here && seals < 3);
    travelButton.onclick = () => {
      if (here) {
        goTo(next.x, next.z, next.name);
      } else if (region.realm) {
        const rift = here ? RIFTS[1] : RIFTS[0];
        if (nearRift?.id === rift.id) {
          action('rift', rift.id);
          close();
        } else if (!here && regionAt(me.x, me.z)?.id !== 'stone-forest')
          travel(regionById('stone-forest'));
        else goTo(rift.x, rift.z, rift.name);
      } else if (here) goTo(next.x, next.z, next.name);
      else travel(region);
    };
    const campButton = root.querySelector<HTMLButtonElement>('#adventure-camp');
    campButton.disabled = blocked || !here;
    campButton.onclick = () => {
      if (atCamp && ready && !p.claimed) {
        action('claimAdventure', region.id);
      } else goTo(region.camp.x, region.camp.z, `${region.name}の野営地`);
    };
    const rest = root.querySelector<HTMLButtonElement>('#adventure-rest');
    rest.disabled = blocked || !atCamp;
    rest.onclick = () => action('rest');
    if (region.realm && here) {
      const exit = document.createElement('button');
      exit.id = 'adventure-exit';
      exit.className = 'button button-outline';
      exit.textContent = '地上へ戻る';
      exit.disabled = blocked;
      exit.onclick = () => {
        if (nearRift?.exit) {
          action('rift', nearRift.id);
          close();
        } else goTo(RIFTS[1].x, RIFTS[1].z, RIFTS[1].name);
      };
      root.querySelector<HTMLButtonElement>('.adventure-actions').append(exit);
    }
  }
  document.querySelector<HTMLButtonElement>('#adventure-button').onclick = () => open();
  return { open, update };
}
