import { DurableObject } from 'cloudflare:workers';
import { createGameCore } from '../shared/game-core.mjs';
import { WORLD } from '../shared/world.mjs';
import { GameSocket } from './socket-adapter.mjs';
import { freshBudget, reserve, utcDay, nextDay } from './free-budget.mjs';

const ROOM = 'EMBER';
const unavailable = '無料の利用上限に達したか、保存サービスが利用できません。ゲームを停止しました。時間をおいて再接続してください。';
const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export class FreeGameRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sockets = new Set(); this.chain = Promise.resolve();
    this.timer = null; this.ticking = false; this.blocked = null;
    this.messageCredit = 0; this.activeUntil = 0; this.lastSave = 0;
    this.game = createGameCore({ resumeGraceMs: 7 * 86400000, keepEmptyRooms: true, maxSavedSessions: 100 });
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS checkpoint (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL)');
      const rows = ctx.storage.sql.exec('SELECT data FROM checkpoint WHERE id = 1').toArray();
      const saved = rows.length ? JSON.parse(rows[0].data) : null;
      this.budget = saved?.budget || freshBudget();
      if (saved?.game) this.game.importState(saved.game);
    });
  }

  enqueue(operation) {
    const result = this.chain.then(operation);
    this.chain = result.catch(() => this.stop('SAVE_UNAVAILABLE'));
    return result;
  }

  rollDay() {
    if (this.budget.day !== utcDay()) {
      this.budget = freshBudget(); this.messageCredit = 0; this.activeUntil = 0;
      if (this.blocked === 'FREE_LIMIT') this.blocked = null;
    }
  }

  async persist() {
    if (!reserve(this.budget, 'writes', 1)) throw new Error('FREE_LIMIT');
    const data = JSON.stringify({ budget: this.budget, game: this.game.exportState() });
    if (new TextEncoder().encode(data).length > 1500000) throw new Error('SAVE_TOO_LARGE');
    this.ctx.storage.sql.exec('INSERT INTO checkpoint (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data', data);
    await this.ctx.storage.sync();
    this.lastSave = Date.now();
  }

  flush() { for (const socket of this.sockets) socket.flush(); }

  stop(code = 'FREE_LIMIT') {
    this.blocked = code;
    clearInterval(this.timer); this.timer = null;
    for (const socket of this.sockets) {
      // Never release queued state/acknowledgements from an unsuccessful save.
      socket.pending.length = 0;
      try { socket.ws.send(JSON.stringify({ type: 'error', code, text: unavailable })); socket.ws.close(4008, 'Service paused'); } catch {}
    }
  }

  reserveMinute() {
    if (Date.now() < this.activeUntil) return false;
    if (!reserve(this.budget, 'activeMs', 60000)) throw new Error('FREE_LIMIT');
    this.activeUntil = Date.now() + 60000;
    return true;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (this.ticking || this.blocked) return;
      this.ticking = true;
      void this.enqueue(async () => {
        if (this.blocked || !this.sockets.size) return;
        this.rollDay();
        const reserved = this.reserveMinute();
        if (reserved) await this.persist(); // Reserve usage before running it.
        this.game.tick();
        // Inventory, camp, combat and resource changes are detected separately
        // from high-frequency movement. Persist before delivering their effects.
        const critical = this.criticalState();
        if (critical !== this.lastCritical || Date.now() - this.lastSave >= 30000) {
          await this.persist(); this.lastCritical = critical;
        }
        this.flush();
      }).catch(error => this.stop(error.message === 'FREE_LIMIT' ? 'FREE_LIMIT' : 'SAVE_UNAVAILABLE'))
        .finally(() => { this.ticking = false; });
    }, 50);
  }

  criticalState() {
    const room = this.game.rooms.get(ROOM);
    if (!room) return '';
    return JSON.stringify({ camp: room.camp, resources: room.resources.map(r => r.amount),
      players: [...room.players.values()].map(p => [p.id, p.inventory, p.tool, p.gathered, p.defeatSequence]),
      animals: room.animals.map(a => [a.id, a.phase, a.health, a.meatRemaining]),
      enemies: room.enemies.map(a => [a.id, a.phase, a.health]) });
  }

  async fetch(request) {
    return this.enqueue(async () => {
      this.rollDay();
      if (this.blocked) return json({ ok: false, code: this.blocked, text: unavailable, retryAt: nextDay() }, 503);
      const url = new URL(request.url);
      if (url.pathname === '/api/status') return json({ ok: true, room: ROOM,
        players: this.game.rooms.get(ROOM)?.players.size || 0, maxPlayers: 5 });
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ ok: false }, 426);
      if (!reserve(this.budget, 'connections', 1)) { this.stop(); return json({ ok: false, text: unavailable }, 503); }
      this.reserveMinute();
      await this.persist();
      const pair = new WebSocketPair();
      const ws = pair[1]; ws.accept();
      const socket = new GameSocket(ws);
      this.sockets.add(socket);
      ws.addEventListener('message', event => {
        void this.enqueue(async () => {
          if (this.blocked || !this.sockets.has(socket)) return;
          this.rollDay();
          if (this.messageCredit <= 0) {
            if (!reserve(this.budget, 'messages', 1000)) { this.stop(); return; }
            await this.persist(); this.messageCredit = 1000;
          }
          this.messageCredit--;
          if (typeof event.data !== 'string' || new TextEncoder().encode(event.data).length > 2048) {
            socket.close(1009, 'Message too large'); return;
          }
          socket.lastMessage = Date.now();
          socket.emit('message', event.data, false);
          const critical = this.criticalState();
          if (critical !== this.lastCritical) { await this.persist(); this.lastCritical = critical; }
          this.flush();
        }).catch(error => this.stop(error.message === 'FREE_LIMIT' ? 'FREE_LIMIT' : 'SAVE_UNAVAILABLE'));
      });
      const disconnect = () => {
        void this.enqueue(async () => {
          if (!this.sockets.delete(socket)) return;
          socket.emit('close');
          if (!this.sockets.size) { clearInterval(this.timer); this.timer = null; }
          if (!this.blocked) { await this.persist(); this.lastCritical = this.criticalState(); this.flush(); }
        }).catch(() => this.stop('SAVE_UNAVAILABLE'));
      };
      ws.addEventListener('close', disconnect); ws.addEventListener('error', disconnect);
      // Public launch has exactly one room; reject arbitrary room creation at the edge.
      this.game.connect(socket, url.searchParams);
      await this.persist(); this.lastCritical = this.criticalState(); this.flush();
      this.start();
      return new Response(null, { status: 101, webSocket: pair[0] });
    }).catch(error => {
      this.stop(error.message === 'FREE_LIMIT' ? 'FREE_LIMIT' : 'SAVE_UNAVAILABLE');
      return json({ ok: false, code: this.blocked, text: unavailable, retryAt: nextDay() }, 503);
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') return json({ ok: true, hosting: 'cloudflare-free', worldVersion: WORLD.version, maxPlayers: 5, room: ROOM });
    if (url.pathname === '/api/network') return json({ urls: [], localUrl: url.origin });
    if (url.pathname === '/ws' || url.pathname === '/api/status') {
      if (env.SERVICE_ENABLED !== 'true') return json({ ok: false, text: '現在メンテナンス中です。' }, 503);
      if (request.method !== 'GET') return json({ ok: false }, 405);
      if (url.pathname === '/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ ok: false }, 426);
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ ok: false }, 403);
        const room = url.searchParams.get('room') || ROOM;
        if (room !== ROOM) return json({ ok: false, text: '無料公開版の部屋名は EMBER です。' }, 400);
        if (url.search.length > 1000) return json({ ok: false }, 400);
      }
      try { return await env.GAME.getByName(ROOM, { locationHint: 'apac' }).fetch(request); }
      catch { return json({ ok: false, code: 'FREE_LIMIT', text: unavailable, retryAt: nextDay() }, 503); }
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false }, 404);
    return env.ASSETS.fetch(request);
  }
};
