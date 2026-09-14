import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameCore } from '../dist/application/game-core.mjs';
import { decodeCommand } from '../dist/application/protocol.mjs';
import { DIFFICULTIES, incomingDamage, normalizeDifficulty } from '../dist/shared/difficulty.mjs';
import { CollisionWorld } from '../dist/shared/collision.mjs';
import { createEnemies, updateEnemies } from '../dist/shared/enemies.mjs';
import { CROW_ROLE_RULES } from '../dist/shared/crow-faction.mjs';
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

test('difficulty names and personal damage multipliers have a safe normal fallback', () => {
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
  assert.ok(
    Object.values(DIFFICULTIES).every((difficulty) => !('enemyMovementSpeed' in difficulty)),
    'personal difficulty cannot carry a shared-world movement multiplier',
  );
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

test('co-op peers receive one authoritative enemy state when personal difficulty changes', () => {
  let now = 1000,
    serial = 0;
  const runtime = {
      now: () => now,
      id: () => `coop-${++serial}`,
      token: () => `coop-token-${++serial}`,
    },
    core = createGameCore({ runtime, keepEmptyRooms: true }),
    easySocket = new Socket(),
    hardSocket = new Socket();
  try {
    core.connect(
      easySocket,
      new URLSearchParams({ room: 'SHARED-DIFFICULTY', name: 'Easy', difficulty: 'easy' }),
    );
    core.connect(
      hardSocket,
      new URLSearchParams({ room: 'SHARED-DIFFICULTY', name: 'Hard', difficulty: 'hard' }),
    );
    const room = core.rooms.get('SHARED-DIFFICULTY'),
      easyId = easySocket.messages.find((message) => message.type === 'welcome').id,
      hardId = hardSocket.messages.find((message) => message.type === 'welcome').id,
      easy = room.players.get(easyId),
      hard = room.players.get(hardId),
      enemy = room.enemies.find(
        (candidate) => candidate.modelKey === 'crow-shaman' && !candidate.castle,
      );
    Object.assign(easy, {
      x: enemy.x,
      z: enemy.z + 6,
      dx: 0,
      dz: 0,
      lastInput: 0,
      invulnerableUntil: 0,
      downedUntil: 0,
    });
    Object.assign(hard, {
      x: enemy.x + 8,
      z: enemy.z + 8,
      dx: 0,
      dz: 0,
      lastInput: 0,
      invulnerableUntil: 0,
      downedUntil: 0,
    });
    Object.assign(enemy, {
      targetId: easy.id,
      pendingAttack: null,
      attackLockUntil: 0,
      nextAttackAt: 0,
      nextBoltAt: 1e12,
      nextBurstAt: 1e12,
      target: null,
      path: [],
      nextPathAt: 0,
      facing: 0,
    });
    easySocket.messages.length = 0;
    hardSocket.messages.length = 0;

    now += 100;
    core.tick();
    const firstEasy = easySocket.messages.findLast((message) => message.type === 'state'),
      firstHard = hardSocket.messages.findLast((message) => message.type === 'state');
    assert.deepEqual(firstEasy.enemies, firstHard.enemies, 'both peers receive the same enemies');
    assert.ok(
      Math.abs(
        firstEasy.enemies.find((candidate) => candidate.id === enemy.id).speed -
          CROW_ROLE_RULES.shaman.chaseSpeed,
      ) < 1e-9,
    );

    easySocket.command({ type: 'difficulty', difficulty: 'hard' });
    assert.equal(easy.difficulty, 'hard');
    now += 100;
    core.tick();
    const changedEasy = easySocket.messages.findLast((message) => message.type === 'state'),
      changedHard = hardSocket.messages.findLast((message) => message.type === 'state'),
      changedEnemy = changedEasy.enemies.find((candidate) => candidate.id === enemy.id);
    assert.deepEqual(
      changedEasy.enemies,
      changedHard.enemies,
      'a personal setting change cannot fork shared enemy state',
    );
    assert.equal(changedEnemy.targetId, easy.id);
    assert.ok(Math.abs(changedEnemy.speed - CROW_ROLE_RULES.shaman.chaseSpeed) < 1e-9);
  } finally {
    core.close();
  }
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
  const staff = CROW_ROLE_RULES.shaman.attackDamage;
  assert.equal(hit('easy'), 100 - Math.max(1, Math.round(staff * 0.7)));
  assert.equal(hit('normal'), 100 - staff);
  assert.equal(hit('hard'), 100 - Math.max(1, Math.round(staff * 1.4)));
});

test('crow, behemoth and sabertooth movement is independent of the target difficulty', () => {
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
    assert.equal(easy, normal, `${modelKey} easy and normal speed`);
    assert.equal(hard, normal, `${modelKey} hard and normal speed`);
  }
});

test('behemoth charge and sabertooth pounce are independent of the target difficulty', () => {
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
  assert.ok(Math.abs(chargeSpeed('easy') - BEHEMOTH.chargeSpeed) < 1e-6);
  assert.ok(Math.abs(chargeSpeed('normal') - BEHEMOTH.chargeSpeed) < 1e-6);
  assert.ok(Math.abs(chargeSpeed('hard') - BEHEMOTH.chargeSpeed) < 1e-6);

  const pounceSpeed = (difficulty) => {
    const { enemy, room } = encounter('sabertooth-tiger', difficulty, 6);
    updateEnemies(room, 0, 2000);
    assert.equal(enemy.pendingAttack.kind, 'pounce');
    updateEnemies(room, 0, 2000 + SABERTOOTH.pounceWindupMs);
    updateEnemies(room, 0.1, 2000 + SABERTOOTH.pounceWindupMs + SABERTOOTH.pounceCrouchMs + 100);
    return enemy.speed;
  };
  const normalPounce = pounceSpeed('normal');
  assert.equal(pounceSpeed('easy'), normalPounce);
  assert.equal(pounceSpeed('hard'), normalPounce);
});
