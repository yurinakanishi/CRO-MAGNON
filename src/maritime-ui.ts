import { LANDINGS, inGulf } from '../shared/gulf-region.mjs';
import { SEA_WEATHER, currentDirection, seaConditions } from '../shared/maritime-weather.mjs';
import { initializeBoats, launchPoint } from '../shared/boats.mjs';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector<T>(s);
export function installMaritimeUI({ player, state, available, openModal, goTo, renderer, notify }) {
  $('.boat-controls').insertAdjacentHTML(
    'beforeend',
    '<button id="boat-weather" class="hunt-button">空と航路</button>',
  );
  function open() {
    openModal(`<div class="gulf-panel" id="sea-panel"><span class="eyebrow">三つの岸の湾</span><h2>空を見て、帰る岸を決める。</h2>
      <div class="gulf-banner"><h3 id="sea-now"></h3><p id="sea-next"></p><p id="sea-advice"></p></div>
      <div class="gulf-columns"><section class="gulf-card"><h4>湾奥と岸沿い</h4><p>岸近くは風と流れの影響が小さく、雨風でも進みやすい。長い横断を避けるなら、集い場の浜を経由しよう。</p></section>
      <section class="gulf-card"><h4>対岸と外湾</h4><p>対岸への横断は近道。沖へ出るほど流れの向きで速さが変わる。雨風では遅く、海霧では遠い岸が見えにくい。</p></section></div>
      <p id="sea-local"></p><p>漕ぐのをやめると、その場で留まります。メニューや釣りの間も漂流しません。陸にいるときは湾奥を回る道も使えます。</p>
      <div class="gulf-actions"><button class="button button-accent" id="sea-map">湾の地図を見る</button></div>
      <h3>次の上陸地</h3><p id="sea-landing-help"></p><div class="gulf-actions">${LANDINGS.map((l) => `<button class="button button-outline" id="sea-go-${l.id}">${l.name}</button>`).join('')}</div>
      <details class="gulf-lore"><summary>この世界について</summary><p>天候の周期、流れ、次の空模様の見通しは創作です。漕ぎ手が舟をその場に保つ操作を省略しています。</p></details></div>`);
    $('#sea-map').onclick = () => {
      $<HTMLDialogElement>('#modal').close();
      $('#map-button').click();
      $('#map-gulf').click();
    };
    for (const landing of LANDINGS)
      $(`#sea-go-${landing.id}`).onclick = () => {
        const p = player();
        if (!p || !available() || !inGulf(p.x, p.z) || p.downedUntil || p.mountId) return;
        let destination = { x: landing.x, z: landing.z };
        if (p.boatId) {
          const room = { collision: renderer.collision, boats: state().boats ?? [] };
          initializeBoats(room);
          room.boats = state().boats ?? [];
          const afloat = launchPoint(room, { ...landing, radius: p.radius });
          if (!afloat) {
            notify('この浜には今、舟を寄せられません。別の上陸地を選ぼう。');
            return;
          }
          destination = afloat;
        }
        $<HTMLDialogElement>('#modal').close();
        goTo(destination.x, destination.z, landing.name);
      };
    update();
  }
  function update() {
    const world = state(),
      p = player(),
      weather = world.maritime;
    const button = $<HTMLButtonElement>('#boat-weather');
    button.hidden = !p || !inGulf(p.x, p.z);
    button.disabled = !available() || !weather;
    button.textContent = weather ? `${SEA_WEATHER[weather.kind].name} · 空と航路` : '空と航路';
    if (!$('#sea-panel')) return;
    if (!weather) {
      $('#sea-now').textContent = '空模様を確認しています';
      return;
    }
    const seconds = Math.max(0, Math.ceil((weather.changesAt - world.serverTime) / 1000));
    $('#sea-now').textContent = `${SEA_WEATHER[weather.kind].name} · ${currentDirection(weather)}`;
    $('#sea-next').textContent = `次は${SEA_WEATHER[weather.next].name} · あと${seconds}秒`;
    $('#sea-advice').textContent = SEA_WEATHER[weather.kind].advice;
    const local = p && inGulf(p.x, p.z);
    const exposure = p ? seaConditions(weather, p.x, p.z).exposure : 0;
    $('#sea-local').textContent = !local
      ? 'これは三つの岸の湾の空模様です。'
      : !p.boatId
        ? '浜から出る前に、次の上陸地を確かめよう。'
        : exposure < 0.35
          ? '今の場所：波と流れの影響が小さい水面。'
          : '今の場所：沖の流れの影響を受ける水面。';
    $('#sea-landing-help').textContent = p?.boatId
      ? '選んだ浜の水際へ漕いで向かいます。到着したら乗降操作で岸へ降りよう。'
      : '選んだ浜へ、陸を歩いて向かいます。';
    for (const landing of LANDINGS)
      $<HTMLButtonElement>(`#sea-go-${landing.id}`).disabled =
        !available() || !local || !!p?.downedUntil || !!p?.mountId;
  }
  $('#boat-weather').onclick = open;
  return { open, update };
}
