import test from 'node:test';
import assert from 'node:assert/strict';

async function fixture(t) {
  const workers = [];
  class FakeWorker {
    sent = [];
    terminated = false;
    constructor() {
      workers.push(this);
    }
    postMessage(message) {
      this.sent.push(message);
    }
    terminate() {
      this.terminated = true;
    }
    emit(data) {
      this.onmessage({ data });
    }
  }
  const globals = {
    Worker: FakeWorker,
    window: new EventTarget(),
    document: new EventTarget(),
    CloseEvent: class extends Event {
      constructor(type, values) {
        super(type);
        Object.assign(this, values);
      }
    },
  };
  const previous = new Map(
    Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  Object.assign(globalThis, globals);
  t.after(() => {
    for (const [key, value] of previous)
      if (value) Object.defineProperty(globalThis, key, value);
      else delete globalThis[key];
  });
  const { SoloConnection } = await import(
    `../dist/src/solo-connection.js?test=${encodeURIComponent(t.name)}`
  );
  const connection = new SoloConnection({ name: 'Test' });
  await Promise.resolve();
  const worker = workers[0];
  worker.emit({ type: 'open' });
  return { connection, worker, workers, SoloConnection };
}

test('solo leave waits for a committed worker close and serializes the next session', async (t) => {
  const { connection, worker, workers, SoloConnection } = await fixture(t);
  const result = connection.leave();
  assert.equal(connection.leave(), result, 'duplicate clicks share one request');
  assert.equal(worker.sent.filter((message) => message.type === 'leave').length, 1);
  assert.equal(connection.readyState, 2);
  connection.send('cannot change the snapshot while leaving');
  assert.equal(worker.sent.at(-1).type, 'leave');
  const next = new SoloConnection({ name: 'Next' });
  await Promise.resolve();
  assert.equal(workers.length, 1, 'the next writer waits for the committed close');
  worker.emit({ type: 'closed', code: 1000, reason: '' });
  assert.equal(await result, true);
  await Promise.resolve();
  assert.equal(workers.length, 2);
  assert.equal(worker.terminated, true);
  next.close();
  workers[1].emit({ type: 'closed', code: 1000, reason: '' });
});

test('save refusal keeps the same worker usable and permits a later exit retry', async (t) => {
  const { connection, worker } = await fixture(t);
  const refused = connection.leave();
  worker.emit({ type: 'close-refused' });
  assert.equal(await refused, false);
  assert.equal(connection.readyState, 1);
  assert.equal(worker.terminated, false);
  connection.send('keep playing');
  assert.deepEqual(worker.sent.at(-1), { type: 'command', data: 'keep playing' });
  const retry = connection.leave();
  worker.emit({ type: 'closed', code: 1000, reason: '' });
  assert.equal(await retry, true);
});

test('a worker failure cannot acknowledge a pending leave as saved', async (t) => {
  const { connection, worker } = await fixture(t);
  const result = connection.leave();
  worker.onerror(new Error('worker crashed'));
  assert.equal(await result, false);
  assert.equal(connection.readyState, 3);
  assert.equal(worker.terminated, true);
});
