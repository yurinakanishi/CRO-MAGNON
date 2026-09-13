import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import {
  DIFFICULTIES,
  enemyMovementSpeed,
  incomingDamage,
  normalizeDifficulty,
} from '../dist/shared/difficulty.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createEnemies, updateEnemies } from '../dist/shared/enemies.mjs';
import { BEHEMOTH } from '../dist/shared/behemoth-rules.mjs';
import { SABERTOOTH } from '../dist/shared/sabertooth-rules.mjs';

class Socket {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  listeners = new Map();
  send(data) {
    this.messages.push(JSON.parse(data));
  }
  on(type, handler) {
    this.listeners.set(type, handler);
  }
  close() {}
  ping() {}
  command(message) {
    this.listeners.get('message')?.(Buffer.from(JSON.stringify(message)), false);
  }
}

test('difficulty names and damage multipliers have a safe normal fallback', () => {
  assert.deepEqual(
    Object.values(DIFFICULTIES).map(({ label }) => label),
    ['簡単', '普通', '難しい'],
  );
  assert.equal(normalizeDifficulty('easy'), 'easy');
  assert.equal(normalizeDifficulty('hard'), 'hard');
  for (const invalid of [undefined, null, '', 'expert', 1, {}])
    assert.equal(normalizeDifficulty(invalid), 'normal');
  assert.equal(incomingDamage({ difficulty: 'easy' }, 15), 11);
  assert.equal(incomingDamage({ difficulty: 'normal' }, 15), 15);
  assert.equal(incomingDamage({ difficulty: 'hard' }, 15), 21);
  assert.equal(incomingDamage({ difficulty: 'easy' }, 1), 1);
  assert.ok(Math.abs(enemyMovementSpeed({ difficulty: 'easy' }, 6) - 4.8) < 1e-12);
  assert.equal(enemyMovementSpeed({ difficulty: 'normal' }, 6), 6);
  assert.ok(Math.abs(enemyMovementSpeed({ difficulty: 'hard' }, 6) - 7.2) < 1e-12);
});

test('difficulty command accepts only the three public values', () => {
  for (const difficulty of ['easy', 'normal', 'hard'])
    assert.deepEqual(decodeCommand(JSON.stringify({ type: 'difficulty', difficulty })), {
      type: 'difficulty',
      difficulty,
    });
  for (const difficulty of ['expert', '', null, 1, {}, ['easy']])
    assert.equal(decodeCommand(JSON.stringify({ type: 'difficulty', difficulty })), null);
});

test('the server owns, updates and restores each player difficulty', () => {
  let id = 0;
  const runtime = {
    now: () => 1000,
    id: () => `id-${++id}`,
    token: () => 'difficulty-session',
  };
  const core = createGameCore({ runtime, persistentSessions: true, keepEmptyRooms: true });
  const socket = new Socket();
  core.connect(
    socket,
    new URLSearchParams({ room: 'DIFFICULTY', resume: '1', difficulty: 'easy' }),
  );
  const welcome = socket.messages.find((message) => message.type === 'welcome');
  const player = core.rooms.get('DIFFICULTY').players.get(welcome.id);
  assert.equal(welcome.profile.difficulty, 'easy');
  assert.equal(player.difficulty, 'easy');

  socket.command({ type: 'difficulty', difficulty: 'hard' });
  assert.equal(player.difficulty, 'hard');
  socket.command({ type: 'difficulty', difficulty: 'expert' });
  assert.equal(player.difficulty, 'hard', 'invalid values do not alter server state');

  const saved = core.exportState();
  const restored = createGameCore({ runtime, persistentSessions: true, keepEmptyRooms: true });
  restored.importState(saved);
  const resumedSocket = new Socket();
  restored.connect(
    resumedSocket,
    new URLSearchParams({
      room: 'DIFFICULTY',
      resume: '1',
      session: welcome.session,
    }),
  );
  const resumed = resumedSocket.messages.find((message) => message.type === 'welcome');
  assert.equal(resumed.resumed, true);
  assert.equal(resumed.profile.difficulty, 'hard');
});

test('enemy hits apply the target player difficulty without changing another player', () => {
  const hit = (difficulty) => {
    const collision = new CollisionWorld([], { river: false });
    const enemy = createEnemies(collision, [], 1000)[0];
    const player = {
      id: difficulty,
      difficulty,
      x: enemy.x,
      z: enemy.z + 1.3,
      radius: 0.32,
      energy: 100,
      inventory: {},
      hurtSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      cookingEndsAt: 0,
    };
    enemy.facing = 0;
    enemy.attackSequence = 1;
    enemy.attackLockUntil = 2500;
    enemy.pendingAttack = {
      kind: 'attack',
      targetId: player.id,
      impactAt: 2000,
      facing: 0,
    };
    enemy.nextBoltAt = enemy.nextBurstAt = 1e12;
    const room = {
      players: new Map([[player.id, player]]),
      enemies: [enemy],
      animals: [],
      collision,
      camp: { x: 50, z: 50 },
    };
    updateEnemies(room, 0, 2000);
    return player.energy;
  };
  assert.equal(hit('easy'), 89);
  assert.equal(hit('normal'), 85);
  assert.equal(hit('hard'), 79);
});

test('crow, behemoth and sabertooth combat movement follows the targeted player difficulty', () => {
  const measuredSpeed = (modelKey, difficulty) => {
    const collision = new CollisionWorld([], { river: false });
    const enemies = createEnemies(collision, [], 1000);
    const enemy =
      modelKey === 'crow-shaman'
        ? enemies.find((candidate) => candidate.modelKey === modelKey && !candidate.castle)
        : enemies.find((candidate) => candidate.modelKey === modelKey);
    const range = modelKey === 'violet-behemoth' ? 10 : modelKey === 'sabertooth-tiger' ? 12 : 6;
    const player = {
      id: `${modelKey}-${difficulty}`,
      difficulty,
      x: enemy.x,
      z: enemy.z + range,
      radius: 0.32,
      energy: 100,
      inventory: {},
      moving: false,
      running: false,
      hurtSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      cookingEndsAt: 0,
      pendingStrike: null,
    };
    Object.assign(enemy, {
      targetId: player.id,
      pendingAttack: null,
      attackLockUntil: 0,
      nextAttackAt: 0,
      nextStepAt: 1e12,
      nextBoltAt: 1e12,
      nextBurstAt: 1e12,
      meleeIndex: 0,
      facing: 0,
    });
    const room = {
      players: new Map([[player.id, player]]),
      enemies: [enemy],
      animals: [],
      collision,
      camp: { x: enemy.x + 100, z: enemy.z + 100 },
    };
    updateEnemies(room, 0.1, 2000);
    assert.equal(enemy.behavior, 'chase', modelKey);
    return enemy.speed;
  };

  for (const modelKey of ['crow-shaman', 'violet-behemoth', 'sabertooth-tiger']) {
    const easy = measuredSpeed(modelKey, 'easy');
    const normal = measuredSpeed(modelKey, 'normal');
    const hard = measuredSpeed(modelKey, 'hard');
    assert.ok(Math.abs(easy / normal - 0.8) < 1e-9, `${modelKey} easy speed`);
    assert.ok(Math.abs(hard / normal - 1.2) < 1e-9, `${modelKey} hard speed`);
  }
});

test('behemoth charge and sabertooth pounce use the targeted player speed setting', () => {
  const encounter = (modelKey, difficulty, range) => {
    const collision = new CollisionWorld([], { river: false });
    const enemy = createEnemies(collision, [], 1000).find(
      (candidate) => candidate.modelKey === modelKey,
    );
    const player = {
      id: `${modelKey}-${difficulty}`,
      difficulty,
      x: enemy.x,
      z: enemy.z + range,
      radius: 0.32,
      energy: 100,
      inventory: {},
      moving: false,
      running: false,
      hurtSequence: 0,
      downedUntil: 0,
      invulnerableUntil: 0,
      cookingEndsAt: 0,
      pendingStrike: null,
    };
    Object.assign(enemy, {
      targetId: player.id,
      pendingAttack: null,
      attackLockUntil: 0,
      nextAttackAt: 0,
      nextPounceAt: 0,
      nextStepAt: 1e12,
      nextSpitAt: 1e12,
      facing: 0,
    });
    return {
      enemy,
      player,
      room: {
        players: new Map([[player.id, player]]),
        enemies: [enemy],
        animals: [],
        collision,
        camp: { x: enemy.x + 100, z: enemy.z + 100 },
      },
    };
  };

  const chargeSpeed = (difficulty) => {
    const { enemy, player, room } = encounter('violet-behemoth', difficulty, 12);
    updateEnemies(room, 0, 2000);
    assert.equal(enemy.pendingAttack.kind, 'charge');
    Object.assign(player, { x: enemy.x + 12, z: enemy.z + 23 });
    let peak = 0;
    for (let elapsed = 1; elapsed <= 400; elapsed++) {
      updateEnemies(room, 0.001, 2000 + BEHEMOTH.roarMs + elapsed);
      peak = Math.max(peak, enemy.speed);
    }
    return peak;
  };
  assert.ok(Math.abs(chargeSpeed('easy') - BEHEMOTH.chargeSpeed * 0.8) < 1e-6);
  assert.ok(Math.abs(chargeSpeed('normal') - BEHEMOTH.chargeSpeed) < 1e-6);
  assert.ok(Math.abs(chargeSpeed('hard') - BEHEMOTH.chargeSpeed * 1.2) < 1e-6);

  const pounceSpeed = (difficulty) => {
    const { enemy, room } = encounter('sabertooth-tiger', difficulty, 6);
    updateEnemies(room, 0, 2000);
    assert.equal(enemy.pendingAttack.kind, 'pounce');
    updateEnemies(room, 0, 2000 + SABERTOOTH.pounceWindupMs);
    updateEnemies(room, 0.1, 2000 + SABERTOOTH.pounceWindupMs + SABERTOOTH.pounceCrouchMs + 100);
    return enemy.speed;
  };
  const normalPounce = pounceSpeed('normal');
  assert.ok(Math.abs(pounceSpeed('easy') / normalPounce - 0.8) < 1e-9);
  assert.ok(Math.abs(pounceSpeed('hard') / normalPounce - 1.2) < 1e-9);
});
