// Only the loopback QA host serves this instrumentation.
const slot = new URLSearchParams(location.search).get('slot') === 'B' ? 'B' : 'A';
const name = 'Downed ' + slot;
localStorage.setItem('cro-name', name);
localStorage.setItem('cro-species', slot === 'A' ? 'bear' : 'ape');
localStorage.setItem('cro-gender', slot === 'A' ? 'female' : 'male');
const errors = [],
  samples = [];
let world;
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));
const { WorldRenderer } = await import('/src/world3d.js');
const render = WorldRenderer.prototype.render;
WorldRenderer.prototype.render = function (...args) {
  world = this;
  const result = render.apply(this, args);
  if (!samples.length || performance.now() - samples.at(-1).localAt > 60) {
    samples.push({
      localAt: performance.now(),
      at: this.serverNow(),
      actors: [...this.players.values()]
        .filter((e) => e.actor)
        .map((e) => ({
          name: e.state.name,
          key: e.actor.asset.modelKey,
          clip: e.actor.animation.name,
          time: e.actor.animation.current?.time,
          downedUntil: e.state.downedUntil,
          hurtAt: e.state.hurtAt,
          energy: e.state.energy,
          x: e.model.position.x,
          z: e.model.position.z,
          sha256: e.actor.asset.sha256,
        })),
    });
    if (samples.length > 2000) samples.shift();
  }
  return result;
};
await import('/src/main.js');
const panel = document.createElement('aside');
panel.style.cssText =
  'position:fixed;left:8px;top:100px;z-index:500;background:white;color:#111;padding:8px;font:13px system-ui';
panel.innerHTML =
  '<b>崩れ落ちる動作 QA</b><br><button id="hit">被弾から回復まで検査</button><button id="save">観測を保存</button><output>待機中</output>';
document.body.append(panel);
panel.querySelector('#hit').onclick = async () => {
  panel.querySelector('output').textContent = await (
    await fetch('/downed-hit?' + new URLSearchParams({ name }), { method: 'POST' })
  ).text();
};
panel.querySelector('#save').onclick = async () => {
  panel.querySelector('output').textContent = await (
    await fetch('/downed-report/' + slot, {
      method: 'POST',
      body: JSON.stringify({ slot, errors, samples }),
    })
  ).text();
};
