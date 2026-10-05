// Real prerecorded frames -> captureStream -> shipped CPU Worker -> game -> server.
// An isolated in-memory room is used. No webcam, user save or external connection.
import path from 'node:path';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createGameServer } from '../dist/server.mjs';
import { createExhibitionClient } from '../dist/infrastructure/node/exhibition-client.mjs';
import { checkBeginnerUI } from './qa-beginner-ui.mjs';
const beginnerUI = process.env.CHECK_BEGINNER_UI === '1';
const uiChecks = [];
const root = path.resolve(import.meta.dirname, '..');
const videoPath = path.resolve(process.argv[2]);
const out = path.resolve(process.argv[3] || 'output/playwright/left-hand-video-20261005/game');
await mkdir(out, { recursive: true });
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE ||
    'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
);
const game = createGameServer({
  host: '127.0.0.1',
  port: 0,
  exhibition: true,
  visibility: { hiddenCharacters: ['maruimo', 'howkey'], hideMae: true },
});
const address = await game.listen();
const client = createExhibitionClient({
  root,
  port: 0,
  config: {
    mode: 'lan',
    serverUrl: `ws://127.0.0.1:${address.port}/ws`,
    room: 'HANDVIDEO',
    guestName: '動画テスト',
  },
});
const local = await client.listen();
// Serve ranges over loopback instead of copying the entire movie into each CDP response.
const videoSize = (await stat(videoPath)).size;
const originalRequest = client.server.listeners('request')[0];
client.server.removeListener('request', originalRequest);
client.server.on('request', (req, res) => {
  if (new URL(req.url, 'http://localhost').pathname !== '/qa-video.mp4')
    return originalRequest(req, res);
  const range = /bytes=(\d+)-(\d*)/.exec(req.headers.range || '');
  const start = range ? Number(range[1]) : 0;
  const end = range?.[2] ? Math.min(Number(range[2]), videoSize - 1) : videoSize - 1;
  res.writeHead(range ? 206 : 200, {
    'Content-Type': 'video/mp4',
    'Accept-Ranges': 'bytes',
    'Content-Length': end - start + 1,
    ...(range ? { 'Content-Range': `bytes ${start}-${end}/${videoSize}` } : {}),
  });
  createReadStream(videoPath, { start, end }).pipe(res);
});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [],
  blocked = [],
  samples = [],
  screenshots = [];
let context, page;
try {
  context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
  });
  page = await context.newPage();
  page.on('pageerror', (e) => errors.push(String(e)));
  const main = await readFile(path.join(root, 'dist/src/main.js'), 'utf8');
  await page.route('**/*', async (route) => {
    const u = new URL(route.request().url());
    if (u.hostname !== '127.0.0.1') {
      blocked.push(u.href);
      return route.abort();
    }
    if (u.pathname === '/src/main.js')
      return route.fulfill({
        contentType: 'text/javascript',
        body:
          main +
          `
      window.reviewDraws = 0;
      const reviewRender = renderer.renderer.render.bind(renderer.renderer);
      renderer.renderer.render = (...args) => { reviewRender(...args); window.reviewDraws++; };
      export function handVideoReview() {
        const i = motionControls.input;
        return { ...motionDiagnostics(), forward: i.forward, turn: i.turn, edgeHolding: i.edgeHolding,
          heading: assistedNavigation.heading, cameraYaw: renderer.yaw,
          intent: i.read(performance.now()), reason: i.reason,
          me: player() && { x: player().x, z: player().z, facing: player().facing } };
      }
      export function beginnerCameraReview() {
        return { yaw: renderer.yaw, pitch: renderer.pitch, distance: renderer.targetDistance,
          heading: assistedNavigation.heading, manual: renderer.manualCameraAllowed(), viewing: renderer.viewingCompanion };
      }
      export function startHandReviewCapture() {
        const canvas = document.createElement('canvas'); canvas.width = 960; canvas.height = 600;
        const ctx = canvas.getContext('2d'), chunks = [];
        const stream = canvas.captureStream(20);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 1800000 });
        const render = renderer.renderer.render.bind(renderer.renderer);
        renderer.renderer.render = (...args) => {
          render(...args);
          ctx.drawImage(renderer.renderer.domElement, 0, 0, 960, 600);
          ctx.save(); ctx.translate(284, 424); ctx.scale(-1, 1);
          ctx.drawImage(window.reviewVideo, 0, 0, 268, 151); ctx.restore();
          ctx.fillStyle = 'rgba(0,0,0,.7)'; ctx.fillRect(0, 0, 960, 64);
          ctx.fillStyle = 'white'; ctx.font = '20px sans-serif';
          const i = motionControls.input;
          ctx.fillText('提供動画で検証 · 実際のゲームとCPU認識', 16, 25);
          ctx.fillText(window.reviewVideo.currentTime.toFixed(1) + ' 秒  前後 ' + i.forward.toFixed(2) + '  旋回 ' + i.turn.toFixed(2) + '  ' + i.state, 16, 52);
        };
        recorder.ondataavailable = (e) => chunks.push(e.data);
        recorder.start(1000);
        window.finishReviewCapture = () => new Promise((resolve) => {
          recorder.onstop = () => {
            renderer.renderer.render = render; stream.getTracks().forEach(t => t.stop());
            const reader = new FileReader(); reader.onload = () => resolve(reader.result.split(',')[1]);
            reader.readAsDataURL(new Blob(chunks, { type: 'video/webm' }));
          };
          recorder.stop();
        });
      }`,
      });
    return route.continue();
  });
  await page.addInitScript((beginnerUI) => {
    localStorage.setItem('cro-graphics-quality', 'low');
    if (beginnerUI) localStorage.setItem('cro-magnon-assisted-controls-v1', 'on');
    navigator.getGamepads = () => (window.qaPad ? [window.qaPad] : []);
    window.qaCommands = [];
    const WS = window.WebSocket;
    window.WebSocket = class extends WS {
      send(raw) {
        window.qaCommands.push({
          at: performance.now(),
          t: window.reviewVideo?.currentTime,
          command: JSON.parse(raw),
        });
        super.send(raw);
      }
    };
    navigator.mediaDevices.enumerateDevices = async () => [];
    navigator.mediaDevices.getUserMedia = async () => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.src = '/qa-video.mp4';
      await new Promise((resolve, reject) => {
        v.onloadeddata = resolve;
        v.onerror = reject;
      });
      await new Promise((resolve) => {
        v.onseeked = resolve;
        v.currentTime = 2.006667;
      });
      const c = document.createElement('canvas');
      c.width = 640;
      c.height = 360;
      const ctx = c.getContext('2d');
      const draw = () => ctx.drawImage(v, 0, 0, c.width, c.height);
      draw();
      window.reviewTimer = setInterval(draw, 1000 / 30);
      window.reviewVideo = v;
      return c.captureStream(30);
    };
  }, beginnerUI);
  await page.goto(`http://127.0.0.1:${local.port}`);
  await page.locator('#title-start').click();
  await page.locator('#setup-form input[value="cro-female"]').focus();
  await page.keyboard.press('Enter');
  await page.locator('[data-choose-spawn="camp"]').click();
  await page
    .locator('#world[data-world-asset="ready"][data-character-asset="ready"]')
    .waitFor({ timeout: 120000 });
  console.log('Game ready; starting real video captureStream + CPU Worker');
  // Keep the existing camp and collision geometry; relocate this disposable QA actor only.
  const room = game.rooms.get('HANDVIDEO');
  const p = [...room.players.values()][0];
  p.x = 50;
  p.z = 63;
  p.facing = 0;
  if (beginnerUI) uiChecks.push(await checkBeginnerUI(page, out, 'camera'));
  await page.locator('#motion-open').click();
  if (beginnerUI) uiChecks.push(await checkBeginnerUI(page, out, 'setup'));
  await page.locator('#motion-controls[data-state="ACTIVE"]').waitFor({ timeout: 45000 });
  console.log('Calibrated from held real 2.0 s frame');
  if (beginnerUI) uiChecks.push(await checkBeginnerUI(page, out, 'play'));
  await page.evaluate(async (record) => {
    window.reviewApi = await import('/src/main.js');
    window.reviewSamples = [];
    window.reviewVideo.currentTime = 0.5;
    await window.reviewVideo.play();
    if (record) window.reviewApi.startHandReviewCapture();
    window.reviewSampleTimer = setInterval(() => {
      window.reviewSamples.push({
        at: performance.now(),
        t: window.reviewVideo.currentTime,
        ...window.reviewApi.handVideoReview(),
      });
    }, 50);
  }, process.env.RECORD_VIDEO === '1');
  for (const t of [5.2, 8.0, 13.0, 16.0, 19.0, 23.0, 25.8, 29.5, 33.0, 36.5]) {
    await page.waitForFunction((t) => window.reviewVideo.currentTime >= t, t, { timeout: 20000 });
    const name = `frame-${String(t).replace('.', '-')}.png`;
    await page.screenshot({ path: path.join(out, name) });
    screenshots.push(name);
    console.log(
      JSON.stringify(
        await page.evaluate(() => ({
          t: window.reviewVideo.currentTime,
          ...window.reviewApi.handVideoReview(),
        })),
      ),
    );
  }
  const result = await page.evaluate(() => {
    clearInterval(window.reviewSampleTimer);
    return {
      samples: window.reviewSamples,
      commands: window.qaCommands,
      diagnostics: window.reviewApi.handVideoReview(),
    };
  });
  samples.push(...result.samples);
  if (process.env.RECORD_VIDEO === '1') {
    const recorded = await page.evaluate(() => window.finishReviewCapture());
    await writeFile(path.join(out, 'game-review.webm'), Buffer.from(recorded, 'base64'));
  }
  await writeFile(
    path.join(out, 'result.json'),
    JSON.stringify({
      ...result,
      uiChecks,
      errors,
      blocked,
      screenshots,
      calibration:
        'Real 2.006667 s video frame held during setup; video then played at normal speed.',
      environment:
        'Isolated in-memory server, real CPU worker and game, lightweight graphics, 1280x800.',
    }),
  );
  await page.locator('#motion-quick-stop').click();
  await page.evaluate(() => {
    clearInterval(window.reviewTimer);
    window.reviewVideo.pause();
  });
} catch (error) {
  if (page) {
    await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {});
    await writeFile(
      path.join(out, 'failure.json'),
      JSON.stringify({
        error: String(error),
        errors,
        blocked,
        text: await page
          .locator('body')
          .innerText()
          .catch(() => ''),
      }),
    );
  }
  throw error;
} finally {
  await context?.close().catch(() => {});
  await browser.close().catch(() => {});
  await client.close();
  await game.close();
}
console.log(JSON.stringify({ out, samples: samples.length, errors, blocked }));
