import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../shared/game-core.mjs';
import { freshBudget, reserve, nextDay } from '../cloudflare/free-budget.mjs';
class Socket {
  readyState = 1; bufferedAmount = 0; handlers = {}; messages = [];
  on(name, fn) { this.handlers[name] = fn; }
  send(data) { this.messages.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.handlers.close?.(); }
}
test('cloud save restores private sessions, inventory and world after a fresh process', () => {
  const core = createGameCore({ resumeGraceMs: 86400000, keepEmptyRooms: true });
  const socket = new Socket();
  core.connect(socket, new URLSearchParams({ room: 'EMBER', name: 'Save test', species: 'cat', resume: '1' }));
  const welcome = socket.messages.find(m => m.type === 'welcome');
  const room = core.rooms.get('EMBER'), player = room.players.get(welcome.id);
  player.inventory.wood = 7; player.inventory.rawMeat = 2; player.gathered = 9; player.tool = true;
  player.cookingEndsAt = Date.now() + 2000; room.camp.wood = 19;
  room.resources[0].amount = 0; room.animals[0].phase = 'meat'; room.animals[0].health = 0; room.animals[0].meatRemaining = 2;
  const saved = JSON.parse(JSON.stringify(core.exportState()));
  assert.equal(saved.rooms[0].sessions[0].player.socket, undefined);
  const restored = createGameCore({ resumeGraceMs: 86400000, keepEmptyRooms: true });
  restored.importState(saved);
  const fresh = new Socket();
  restored.connect(fresh, new URLSearchParams({ room: 'EMBER', name: 'Spoof', resume: '1', session: welcome.session }));
  const resumed = fresh.messages.find(m => m.type === 'welcome');
  assert.equal(resumed.id, welcome.id); assert.equal(resumed.resumed, true); assert.equal(resumed.profile.name, 'Save test');
  const result = restored.rooms.get('EMBER'), me = result.players.get(resumed.id);
  assert.equal(me.inventory.wood, 7); assert.equal(me.inventory.rawMeat, 2); assert.equal(me.cookingEndsAt, 0);
  assert.equal(me.gathered, 9); assert.equal(me.tool, true); assert.equal(result.camp.wood, 19);
  assert.equal(result.resources[0].amount, 0); assert.equal(result.animals[0].meatRemaining, 2);
  assert.ok(!JSON.stringify(restored.snapshot(result, true)).includes(welcome.session));
});
test('free quotas refuse excess usage and reserved usage survives restart', () => {
  const now = Date.parse('2026-09-07T15:00:00Z'), budget = freshBudget(now);
  assert.equal(reserve(budget, 'messages', 400000, now), true);
  const reloaded = JSON.parse(JSON.stringify(budget));
  assert.equal(reserve(reloaded, 'messages', 1, now), false);
  assert.equal(reserve(reloaded, 'messages', 1, nextDay(now)), true);
  assert.equal(reserve(reloaded, 'activeMs', 12 * 3600000, nextDay(now)), true);
  assert.equal(reserve(reloaded, 'activeMs', 1, nextDay(now)), false);
  assert.equal(reserve(reloaded, 'writes', 20000, nextDay(now)), true);
  assert.equal(reserve(reloaded, 'writes', 1, nextDay(now)), false);
});
test('unknown saved schema fails closed instead of silently resetting progress', () => {
  assert.throws(() => createGameCore().importState({ version: 999 }), /Unsupported saved world/);
});
