// Disposable QA hosts only. Placement and camera are preparation; commands use UI or
// the documented websocket protocol. No production server or user save is touched.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import WebSocket from 'ws';
import { createGameServer, createPersistentGameServer } from '../dist/server.mjs';
import { ALL_MASCOT_MODELS } from '../dist/shared/mascot-roster.mjs';
import { activeMascot, mascotBodies } from '../dist/shared/mascot-selection.mjs';
import { stopActor } from '../dist/shared/combat.mjs';
import { enterPreparedWorld } from './qa-game-entry.mjs';

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
export const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export async function until(check, label, timeout = 20000) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw Error(`Timed out: ${label}`);
    await sleep(40);
  }
}

export async function mascotQA({ out, retained = false, persistent = false, touch = true } = {}) {
  out ??= `output/playwright/mascot-regressions-${Date.now()}`;
  await mkdir(out, { recursive: true });
  const options = {
    host: '127.0.0.1',
    port: 0,
    persistentSessions: true,
    keepEmptyRooms: true,
    ...(retained ? { mascotModels: ALL_MASCOT_MODELS } : {}),
    ...(persistent ? { saveDirectory: `${out}/save`, saveIntervalMs: 60000 } : {}),
  };
  const create = () =>
    persistent ? createPersistentGameServer(options) : createGameServer(options);
  let game = await create();
  await game.listen();
  const { chromium } = await import(
    process.env.PLAYWRIGHT_MODULE ||
      'file:///C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs'
  );
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: true,
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const roomName = 'MASCOT-QA',
    viewers = [],
    peers = [],
    errors = [],
    checks = [],
    records = [];
  const room = () => game.rooms.get(roomName),
    body = (who) => activeMascot(room(), who.id);
  const base = () => `http://127.0.0.1:${game.address().port}`;
  const pass = (label) => {
    checks.push(label);
    console.log('PASS', label);
  };
  async function open(name, context) {
    context ??= await browser.newContext({
      viewport: { width: 1280, height: 800 },
      hasTouch: touch,
    });
    const page = await context.newPage(),
      seen = { id: null, session: null, state: {}, sent: [], states: [] };
    const who = {
      name,
      context,
      page,
      seen,
      get id() {
        return seen.id;
      },
      player: () => room().players.get(seen.id),
    };
    viewers.push(who);
    page.on('pageerror', (error) => errors.push(`${name}: ${error}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`${name}: ${message.text()}`);
    });
    page.on('websocket', (socket) => {
      socket.on('framesent', ({ payload }) => seen.sent.push(JSON.parse(String(payload))));
      socket.on('framereceived', ({ payload }) => {
        const message = JSON.parse(String(payload));
        if (message.type === 'welcome') {
          seen.id = message.id;
          seen.session = message.session;
        }
        if (message.type === 'state') {
          seen.state = message;
          seen.states.push(message);
          if (seen.states.length > 400) seen.states.shift();
        }
      });
    });
    await page.addInitScript((name) => {
      localStorage.setItem('cro-name', name);
      localStorage.setItem('cro-species', 'cro');
      localStorage.setItem('cro-gender', 'female');
      window.qaPad = {
        id: 'QA standard controller',
        index: 0,
        connected: false,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 18 }, () => ({ pressed: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', {
        value: () => (qaPad.connected ? [qaPad] : []),
      });
    }, name);
    if (retained)
      await page.route('**/shared/mascot-roster.mjs', async (route) => {
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replaceAll('enabled: false', 'enabled: true'),
        });
      });
    await page.route('**/src/world3d.js', async (route) => {
      const response = await route.fetch();
      await route.fulfill({
        response,
        body:
          (await response.text()) +
          `
const mascotQAFrame=WorldRenderer.prototype.render;
WorldRenderer.prototype.render=function(...args){
  const result=mascotQAFrame.apply(this,args);window.qa=this;window.qaThree=THREE;
  if(window.qaTarget){
    const id=qaTarget.id,r=this.companionRenderers.renderers.get(id),dot=this.orbBotRenderer.bots.get(id);
    const c=this.state.companions?.find(c=>c.id===id),b=this.state.orbBots?.find(b=>b.id===id||b.companionId===id);
    const actor=this.players.get(qaTarget.petter)?.actor;
    const pose=qaTarget.key==='524'?actor?.pettingPose:actor?.groundPettingPose;
    const d=r?.diagnostics()??this.orbBotRenderer.diagnostics().find(b=>b.id===id);
    if(d){window.qaFrames??=[];qaFrames.push({at:this.serverNow(),...d,mode:b?.mode,sequence:b?.sequence,
      petContactAt:c?.petContactAt??b?.petContactAt,petPlayerId:c?.petPlayerId??b?.petPlayerId,
      weight:pose?.weight??0,gap:pose?.contact.distanceTo(pose.requested)??null,
      heldWeight:this.players.get(b?.ownerId)?.actor?.orbBotPose.weight??0,
      hearts:d.hearts??dot?.hearts?.filter(h=>h.visible).length??0,
      facing:(r?.root??dot?.actor.root)?.rotation.y});if(qaFrames.length>1200)qaFrames.shift();}
  }
  return result;
};`,
      });
    });
    await page.goto(`${base()}/?room=${roomName}&autostart=1`);
    await enterPreparedWorld(page, false);
    await until(() => seen.id && room()?.players.has(seen.id), `${name} joins`);
    await page.waitForFunction(() => window.qa?.players.get(qa.selfId)?.actor);
    return who;
  }
  async function peer(name, session = '') {
    const seen = { id: null, session: null, state: {} };
    const socket = new WebSocket(
      `${base().replace('http:', 'ws:')}/ws?${new URLSearchParams({ room: roomName, name, resume: '1', session })}`,
    );
    socket.on('message', (bytes) => {
      const m = JSON.parse(String(bytes));
      if (m.type === 'welcome') {
        seen.id = m.id;
        seen.session = m.session;
      }
      if (m.type === 'state') seen.state = m;
    });
    const who = {
      socket,
      seen,
      get id() {
        return seen.id;
      },
      player: () => room().players.get(seen.id),
    };
    peers.push(who);
    await until(() => seen.id && room().players.has(seen.id), `${name} protocol join`);
    return who;
  }
  async function menu(who) {
    if (!(await who.page.locator('#modal').evaluate((el) => el.open)))
      await who.page.keyboard.press('Escape');
    await who.page.locator('[data-pause-tab="mascots"]').click();
  }
  async function closeMenu(who) {
    if (await who.page.locator('#modal').evaluate((el) => el.open))
      await who.page.keyboard.press('Escape');
    await who.page.locator('#world').focus();
  }
  async function choose(who, key) {
    if (who.player().mascot === key) {
      if (key !== null) await drawn(who, body(who).id);
      return body(who);
    }
    await menu(who);
    if (key === null) await who.page.locator('[data-mascot-none]').click();
    else await who.page.locator(`[data-mascot="${key}"]`).click();
    await until(() => who.player().mascot === key, `choose ${key}`);
    if (key !== null) await until(() => !!body(who), `arrive ${key}`);
    await closeMenu(who);
    await sleep(1100);
    if (key !== null) await drawn(who, body(who).id);
    return body(who);
  }
  async function drawn(who, id) {
    await until(
      () =>
        who.page.evaluate((id) => {
          const r = qa.companionRenderers.renderers.get(id) ?? qa.orbBotRenderer.bots.get(id);
          return !!(r?.root ?? r?.actor.root)?.visible;
        }, id),
      `draw ${id}`,
      60000,
    );
  }
  async function stage(who, at) {
    const p = who.player();
    stopActor(p);
    assert.ok(room().collision.free(at, p.radius), 'QA stage is collision-free');
    Object.assign(p, at, { warpSequence: (p.warpSequence ?? 0) + 1 });
    await sleep(400);
  }
  async function beside(who, c) {
    for (const direction of [1, -1]) {
      const at = { x: c.x + direction * 1.1, z: c.z, facing: (-direction * Math.PI) / 2 };
      if (!room().collision.free(at, who.player().radius)) continue;
      await stage(who, at);
      await sleep(1000);
      const next = { x: c.x + direction * 1.1, z: c.z, facing: (-direction * Math.PI) / 2 };
      if (!room().collision.free(next, who.player().radius)) continue;
      await stage(who, next);
      await who.page.evaluate(
        ({ x, z }) => {
          const p = qa.state.players.find((p) => p.id === qa.selfId);
          qa.yaw = Math.atan2(p.x - x, p.z - z);
          qa.pitch = 0.3;
          qa.targetDistance = 3.7;
        },
        { x: c.x, z: c.z },
      );
      return;
    }
    throw Error('No safe pet approach');
  }
  async function record(c, petter) {
    const target = { id: c.id, key: c.key ?? c.kind, petter: petter.id };
    for (const who of viewers.filter((w) => !w.page.isClosed()))
      await who.page.evaluate((target) => {
        window.qaTarget = target;
        window.qaFrames = [];
      }, target);
  }
  const frames = (who) => who.page.evaluate(() => window.qaFrames ?? []);
  async function snapshot(label) {
    for (const who of viewers.filter((w) => !w.page.isClosed()))
      await who.page.screenshot({ path: `${out}/${label}-${who.name}.png` });
  }
  async function finish(error) {
    if (error)
      for (const who of viewers.filter((w) => !w.page.isClosed()))
        await writeFile(
          `${out}/failure-frames-${who.name}.json`,
          JSON.stringify(await frames(who)),
        );
    await writeFile(
      `${out}/result.json`,
      JSON.stringify(
        {
          passed: !error && errors.length === 0,
          checks,
          errors,
          records,
          error: error?.stack,
          conditions: {
            chrome: true,
            headless: true,
            positionAndCameraFixtures: true,
            physicalGamepad: false,
            physicalPhone: false,
          },
        },
        null,
        2,
      ),
    );
    for (const p of peers) p.socket.terminate();
    await browser.close();
    await game.close();
  }
  return {
    out,
    room,
    game: () => game,
    browser,
    viewers,
    peers,
    errors,
    checks,
    records,
    body,
    bodies: () => mascotBodies(room()),
    open,
    peer,
    menu,
    closeMenu,
    choose,
    drawn,
    stage,
    beside,
    record,
    frames,
    snapshot,
    pass,
    finish,
    base,
    async restart() {
      for (const p of peers) p.socket.terminate();
      for (const w of viewers) if (!w.page.isClosed()) await w.page.close();
      await game.close();
      game = await create();
      await game.listen();
    },
  };
}
