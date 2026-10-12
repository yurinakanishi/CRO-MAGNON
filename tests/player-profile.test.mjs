import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import {
  INTRO_COOLDOWN_MS,
  INTRO_MAX_LENGTH,
  playerProfile,
} from '../dist/shared/player-profile.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  ping() {
    this.emit('pong');
  }
  terminate() {
    this.close();
  }
}

function world(options = {}) {
  let now = 10000,
    serial = 0;
  const settings = {
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `id-${++serial}`, token: () => `token-${++serial}` },
    ...options,
  };
  let core = createGameCore(settings);
  const join = (name, session = '') => {
    const socket = new Socket();
    core.connect(socket, new URLSearchParams({ room: 'INTRO', resume: '1', session, name }));
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    return { socket, id: welcome.id, session: welcome.session };
  };
  const introduce = (who, text, after = INTRO_COOLDOWN_MS) => {
    now += after;
    who.socket.emit('message', JSON.stringify({ type: 'introduce', text }));
  };
  const intros = (who) => who.socket.messages.filter((m) => m.type === 'intros');
  const room = () => core.rooms.get('INTRO');
  const restart = () => {
    const saved = core.exportState();
    core.close();
    core = createGameCore(settings);
    core.importState(saved);
    return saved;
  };
  return { join, introduce, intros, room, restart, core: () => core };
}

test('the introduce command carries a string and refuses anything else', () => {
  assert.deepEqual(decodeCommand(JSON.stringify({ type: 'introduce', text: 'やあ' })), {
    type: 'introduce',
    text: 'やあ',
  });
  assert.equal(decodeCommand(JSON.stringify({ type: 'introduce', text: 3 })), null);
  assert.equal(decodeCommand(JSON.stringify({ type: 'introduce' })), null);
  assert.equal(decodeCommand(JSON.stringify({ type: 'introduce', text: 'x'.repeat(1001) })), null);
});

test('everyone present learns each introduction, on arrival and on change only', () => {
  const w = world();
  const a = w.join('A');
  assert.deepEqual(w.intros(a).at(-1).intros, { [a.id]: '' }, 'a newcomer has none yet');
  w.introduce(a, '  はじめまして。\nマンモス狩りが好きです。  ');
  assert.equal(w.room().players.get(a.id).intro, 'はじめまして。マンモス狩りが好きです。');
  const b = w.join('B');
  assert.deepEqual(w.intros(b).at(-1).intros, {
    [a.id]: 'はじめまして。マンモス狩りが好きです。',
    [b.id]: '',
  });
  const before = w.intros(a).length;
  w.introduce(b, 'よろしく');
  assert.equal(w.intros(a).length, before + 1);
  assert.equal(w.intros(a).at(-1).intros[b.id], 'よろしく');
  // The same words again send nothing.
  w.introduce(b, ' よろしく ');
  assert.equal(w.intros(a).length, before + 1);
  // The frequent state snapshots never carry the words.
  const state = a.socket.messages.filter((m) => m.type === 'state').at(-1);
  assert.ok(state.players.every((p) => !('intro' in p)));
});

test('an introduction is trimmed to its length and cannot be changed too quickly', () => {
  const w = world();
  const a = w.join('A');
  w.introduce(a, 'あ'.repeat(INTRO_MAX_LENGTH + 20));
  assert.equal([...w.room().players.get(a.id).intro].length, INTRO_MAX_LENGTH);
  w.introduce(a, 'はやすぎる', INTRO_COOLDOWN_MS / 2);
  assert.equal([...w.room().players.get(a.id).intro].length, INTRO_MAX_LENGTH);
  w.introduce(a, 'ゆっくり');
  assert.equal(w.room().players.get(a.id).intro, 'ゆっくり');
  w.introduce(a, '');
  assert.equal(w.room().players.get(a.id).intro, '', 'it can be cleared');
});

test('an introduction is kept with the player across a restart, and cleaned when restored', () => {
  const w = world();
  const a = w.join('A');
  w.introduce(a, '洞窟の壁画を見に行こう');
  a.socket.close();
  const saved = w.restart();
  const entry = saved.rooms[0].sessions.find((s) => s.player.id === a.id);
  assert.equal(entry.player.intro, '洞窟の壁画を見に行こう');
  assert.ok(!('lastIntroAt' in entry.player));
  const back = w.join('A', a.session);
  assert.equal(back.id, a.id);
  assert.equal(w.intros(back).at(-1).intros[a.id], '洞窟の壁画を見に行こう');
  // A forged save cannot smuggle long or control text into a card.
  const forged = w.core().exportState();
  forged.rooms[0].sessions[0].player.intro = `\u0007${'い'.repeat(200)}`;
  const core = createGameCore({ persistentSessions: true });
  core.importState(forged);
  const restored = [...core.rooms.get('INTRO').sessions.values()][0].player.intro;
  assert.equal([...restored].length, INTRO_MAX_LENGTH);
  assert.ok(!restored.includes('\u0007'));
  core.close();
});

test('exhibition visits carry no free text', () => {
  const w = world({ exhibition: true });
  const a = w.join('A');
  w.introduce(a, 'こんにちは');
  assert.equal(w.room().players.get(a.id).intro, '');
  assert.equal(w.intros(a).length, 0);
});

test('the card shows only what anyone nearby could see', () => {
  const base = {
    id: 'p',
    name: 'ゆり',
    species: 'cro',
    gender: 'female',
    energy: 72.6,
    gathered: 41,
    tool: false,
    mascot: 'white',
    adventure: { regions: {} },
    inventory: { wood: 3, berry: 2 },
  };
  const card = playerProfile(base, 'よろしく');
  assert.equal(card.name, 'ゆり');
  assert.equal(card.intro, 'よろしく');
  assert.equal(card.energy, 73);
  assert.equal(card.equipment, '木槍');
  assert.equal(card.companion, 'しろbot');
  assert.equal(card.seals, 0);
  assert.equal(card.gathered, 41);
  assert.equal(card.title, null);
  assert.ok(!('inventory' in card), 'never the inventory');
  const travelled = playerProfile({
    ...base,
    mascot: '524',
    tool: true,
    equippedItem: 'axe',
    energy: 140,
    adventure: {
      regions: {
        'high-pass': { claimed: true },
        'echo-valley': { claimed: true },
        'shadow-realm': { claimed: true },
      },
    },
  });
  assert.equal(travelled.companion, '524');
  assert.equal(travelled.equipment, '石斧');
  assert.equal(travelled.energy, 100);
  assert.equal(travelled.seals, 2, 'the shadow realm is a title, not a seal');
  assert.equal(travelled.title, '境界を渡る者');
  assert.equal(playerProfile({ ...base, mascot: null }).companion, null);
});
