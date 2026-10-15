import { createGameCore } from '../../application/game-core.mjs';
import type { GameConnection, SocketEvents } from '../../application/ports.mjs';
import { WORLD } from '../../shared/world.mjs';
import { UnsupportedSoloSave, type SoloData, type SoloSavePort } from './solo-save.mjs';

export type SoloOutput =
  | { type: 'open' }
  | { type: 'message'; data: string }
  | { type: 'closed'; code: number; reason: string };

class LocalConnection implements GameConnection {
  readyState = 1;
  bufferedAmount = 0;
  private handlers = new Map<string, ((...args: any[]) => void)[]>();
  constructor(private output: (message: SoloOutput) => void) {}
  on<K extends keyof SocketEvents>(type: K, handler: (...args: SocketEvents[K]) => void) {
    this.handlers.set(type, [...(this.handlers.get(type) ?? []), handler]);
  }
  emit<K extends keyof SocketEvents>(type: K, ...args: SocketEvents[K]) {
    for (const handler of this.handlers.get(type) ?? []) handler(...args);
  }
  send(data: string) {
    this.output({ type: 'message', data });
  }
  close(code = 1000, reason = '') {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.emit('close');
    this.output({ type: 'closed', code, reason });
  }
  ping() {
    this.emit('pong');
  }
}

/** The existing game rules run in a dedicated browser worker, with one local player. */
export class SoloRuntime {
  private game = this.createGame();
  private connection: LocalConnection | null = null;
  private session = '';
  private savedAt = 0;
  private recovered = false;
  private dirty = false;
  private pending: SoloOutput[] = [];
  private lastCritical = '';
  private retrySaveAt = 0;

  constructor(
    private storage: SoloSavePort,
    private output: (message: SoloOutput) => void,
  ) {}

  private createGame() {
    return createGameCore({
      playerLimit: 1,
      disconnectIdlePlayers: false,
      persistentSessions: true,
      keepEmptyRooms: true,
      maxSavedSessions: 1,
    });
  }

  async start(profile: Record<string, string>) {
    const loaded = await this.storage.load((data) => {
      if (data.game.worldVersion > WORLD.version)
        throw new UnsupportedSoloSave('Newer solo world; update before continuing');
      const candidate = this.createGame();
      try {
        if (data.game.rooms.some((room: any) => room.name !== 'SOLO'))
          throw new Error('Unexpected solo room');
        candidate.importState(data.game);
        const sessions = candidate.rooms.get('SOLO')?.sessions;
        if (!sessions?.has(data.session) || sessions.size !== 1)
          throw new Error('Missing solo session');
      } catch (error) {
        candidate.close();
        if (error instanceof Error && error.message.startsWith('Unsupported saved'))
          throw new UnsupportedSoloSave(error.message);
        throw error;
      }
      this.game.close();
      this.game = candidate;
    });
    this.recovered = loaded.recovered;
    this.session = loaded.data?.session ?? '';
    this.savedAt = loaded.data?.game.savedAt ?? 0;
    this.connection = new LocalConnection((message) => {
      if (message.type === 'message') {
        const payload = JSON.parse(message.data);
        if (payload.type === 'welcome') this.session = payload.session;
      }
      this.pending.push(message);
    });
    const params = new URLSearchParams({
      ...profile,
      room: 'SOLO',
      resume: '1',
      session: this.session,
      chooseAppearance: '1',
      startAtCamp: this.session ? '0' : '1',
    });
    this.game.connect(this.connection, params);
    this.dirty = true;
    // Do not acknowledge the first entry until this browser can actually save it.
    await this.save(true);
    this.lastCritical = this.critical();
    this.output({ type: 'open' });
    this.flush();
  }

  async command(data: string) {
    if (this.connection?.readyState !== 1) return;
    this.connection.emit('message', data, false);
    this.dirty = true;
    await this.persistIfNeeded();
    this.flush();
  }

  async tick() {
    if (this.connection?.readyState !== 1) return;
    this.game.tick();
    this.dirty = true;
    await this.persistIfNeeded();
    this.flush();
  }

  private critical() {
    const room = this.game.rooms.get('SOLO');
    if (!room) return '';
    const players = [...room.players.values(), ...[...room.sessions.values()].map((s) => s.player)];
    return JSON.stringify({
      camp: room.camp,
      resources: room.resources.map((r) => r.amount),
      players: players.map((p) => [
        p.id,
        p.inventory,
        p.tool,
        p.gathered,
        p.defeatSequence,
        p.character,
        p.dye,
        p.mascot,
        p.intro,
        p.adventure,
        p.gulf,
        p.village,
        p.warpSequence,
      ]),
      animals: room.animals.map((a) => [a.id, a.phase, a.health, a.meatRemaining]),
      enemies: room.enemies.map((a) => [a.id, a.phase, a.health]),
    });
  }

  private async persistIfNeeded() {
    if (Date.now() < this.retrySaveAt) return;
    const critical = this.critical();
    if (
      critical !== this.lastCritical ||
      Date.now() - this.savedAt >= 3000 ||
      this.connection?.readyState === 3
    ) {
      if (await this.save()) this.lastCritical = critical;
    }
  }

  async save(required = false) {
    if (!this.dirty) return true;
    try {
      const game = this.game.exportState();
      await this.storage.write({ game, session: this.session } as SoloData);
      this.savedAt = game.savedAt;
      this.dirty = false;
      this.retrySaveAt = 0;
      this.output({
        type: 'message',
        data: JSON.stringify({
          type: 'saveStatus',
          enabled: true,
          state: 'saved',
          savedAt: this.savedAt,
          recovered: this.recovered,
        }),
      });
      return true;
    } catch (error) {
      if (required) throw error;
      this.retrySaveAt = Date.now() + 5000;
      this.output({
        type: 'message',
        data: JSON.stringify({
          type: 'saveStatus',
          enabled: true,
          state: 'error',
          savedAt: this.savedAt,
          recovered: this.recovered,
        }),
      });
      return false;
    }
  }

  private flush() {
    for (const message of this.pending.splice(0)) this.output(message);
  }

  async close() {
    this.connection?.close();
    this.dirty = true;
    await this.save();
    this.flush();
    this.game.close();
    this.storage.close();
  }
}
