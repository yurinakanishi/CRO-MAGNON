// This module is served only by scripts/qa-creature-motion.mjs, never production.
const slot = new URLSearchParams(location.search).get('qa') === 'b' ? 'b' : 'a';
const name = slot === 'a' ? 'Motion A' : 'Motion B';
localStorage.setItem('cro-name', name);
localStorage.setItem('cro-species', slot === 'a' ? 'bear' : 'cat');
localStorage.setItem('cro-gender', 'female');
const samples = [],
  errors = [],
  actions = [];
window.addEventListener('error', (e) => errors.push(String(e.error || e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
const { WorldRenderer } = await import('/src/world3d.js');
const render = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) {
  const result = render.apply(this, args);
  if (!samples.length || performance.now() - samples.at(-1).localAt > 80) {
    samples.push({
      localAt: performance.now(),
      at: this.serverNow(),
      self: this.selfId,
      actors: [...this.players.values()]
        .filter((e) => e.actor)
        .map((e) => ({
          id: e.state.id,
          name: e.state.name,
          x: e.model.position.x,
          y: e.model.position.y,
          z: e.model.position.z,
          clip: e.actor.animation.name,
          jumpAt: e.state.jumpAt,
          jumpSequence: e.state.jumpSequence,
          mountId: e.state.mountId,
          hash: e.actor.asset.sha256,
        })),
    });
    if (samples.length > 2000) samples.shift();
  }
  return result;
};
await import('/src/main.js');
const panel = document.createElement('aside');
panel.style.cssText =
  'position:fixed;left:5px;top:105px;z-index:200;background:#fff;color:#111;padding:6px;max-width:250px;font:12px system-ui';
panel.innerHTML =
  '<b>動作QA（入力は模擬）</b><br><button id="qa-cycle">歩行→走行→ジャンプ→攻撃</button><br><button id="qa-near">マンモス近接の準備値</button><button id="qa-save">観測を保存</button><output id="qa-status">待機中</output>';
document.body.append(panel);
const status = panel.querySelector('output'),
  wait = (ms) => new Promise((r) => setTimeout(r, ms));
function key(type, key, code) {
  document
    .querySelector('#world')
    .dispatchEvent(new KeyboardEvent(type, { key, code, bubbles: true }));
}
panel.querySelector('#qa-cycle').onclick = async () => {
  const world = document.querySelector('#world');
  world.focus();
  actions.push({ at: Date.now(), kind: 'simulated-keyboard-cycle' });
  status.textContent = '歩行中';
  key('keydown', 'w', 'KeyW');
  await wait(1600);
  key('keyup', 'w', 'KeyW');
  await wait(120);
  key('keydown', 'w', 'KeyW');
  await wait(60);
  key('keyup', 'w', 'KeyW');
  await wait(60);
  key('keydown', 'w', 'KeyW');
  status.textContent = '走行中';
  await wait(1600);
  key('keyup', 'w', 'KeyW');
  await wait(600);
  key('keydown', ' ', 'Space');
  await wait(80);
  key('keyup', ' ', 'Space');
  status.textContent = 'ジャンプ';
  await wait(1000);
  key('keydown', 'f', 'KeyF');
  await wait(80);
  key('keyup', 'f', 'KeyF');
  status.textContent = '攻撃';
  await wait(1200);
  key('keydown', 'g', 'KeyG');
  key('keyup', 'g', 'KeyG');
  await wait(2200);
  status.textContent = '一連の入力が完了';
};
panel.querySelector('#qa-near').onclick = async () => {
  const r = await fetch('/motion-fixture', { method: 'POST', body: JSON.stringify({ name }) });
  status.textContent = await r.text();
  document.querySelector('#world').focus();
};
panel.querySelector('#qa-save').onclick = async () => {
  const report = {
    at: new Date().toISOString(),
    name,
    fixtures:
      'Profile and keyboard input are simulated; other three peers use WebSocket. Optional near-mammoth position is server-side preparation.',
    errors,
    actions,
    samples,
    dom: document.querySelector('#world').dataset,
  };
  await fetch(`/motion-report/${slot}.json`, { method: 'POST', body: JSON.stringify(report) });
  status.textContent = `保存完了 ${samples.length}観測 / ${errors.length}エラー`;
};
