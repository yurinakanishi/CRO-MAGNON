// Private loopback QA: real inputs and game ticks, with per-frame read-only observations.
import { readFile } from 'node:fs/promises';
import { createGameServer } from '../dist/server.mjs';
const port = Number(process.env.PORT || 3023);
const game = createGameServer({ port, host: '127.0.0.1' });
const original = game.server.listeners('request')[0];
game.server.removeListener('request', original);
game.server.on('request', async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname === '/multiplayer-config.json') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(
      JSON.stringify({ mode: 'lan', serverUrl: `ws://127.0.0.1:${port}/ws`, room: 'SMOOTH-QA' }),
    );
  } else if (url.pathname === '/') {
    const html = await readFile(new URL('../public/index.html', import.meta.url), 'utf8');
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
    res.end(html.replace('src="/src/main.js"', 'src="/motion-observer.js"'));
  } else if (url.pathname === '/motion-observer.js') {
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(`
      const { WorldRenderer } = await import('/src/world3d.js');
      window.motionQa = { frames: [], label: 'loading', renderer: null };
      const render = WorldRenderer.prototype.render;
      WorldRenderer.prototype.render = function(time, dt) {
        window.motionQa.renderer = this;
        const before = this.nextShadowUpdate;
        const started = performance.now();
        const result = render.call(this, time, dt);
        const e = this.players.get(this.selfId), a = e?.actor?.animation;
        if (a) window.motionQa.frames.push({
          label: window.motionQa.label, t: time, dt, cost: performance.now()-started,
          x:e.model.position.x, z:e.model.position.z, yaw:e.model.rotation.y,
          clip:a.name, speed:a.speed, phase:a.current?.time, visible:e.model.visible,
          facing:this.predictedMotion?.facing ?? e.state.facing,
          serverSpeed:e.state.speed, serverX:e.state.x, serverZ:e.state.z,
          packet:this.prediction.receivedAt, shadow:this.renderer.shadowMap.autoUpdate || this.nextShadowUpdate !== before,
          predicted:this.prediction.enabled,
        });
        if (window.motionQa.frames.length > 12000) window.motionQa.frames.shift();
        return result;
      };
      await import('/src/main.js');
    `);
  } else original(req, res);
});
await game.listen();
console.log(`Movement QA http://127.0.0.1:${port} PID ${process.pid}`);
process.on('SIGINT', async () => {
  await game.close();
  process.exit();
});
process.on('SIGTERM', async () => {
  await game.close();
  process.exit();
});
