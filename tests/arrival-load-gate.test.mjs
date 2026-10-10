import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AssetLoadQueue,
  LOAD_TIER,
  LoadTicket,
  loadPriority,
  isLoadCancelled,
} from '../dist/src/asset-load-queue.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve;
  const promise = new Promise((r) => (resolve = r));
  return { promise, resolve };
};

test('arrival leaves optional work queued while the body and initial floor complete; release keeps priority order', async () => {
  const queue = new AssetLoadQueue(2),
    calls = [];
  const release = queue.deferFrom(loadPriority(LOAD_TIER.near));
  const request = (key, tier) =>
    queue.request(
      key,
      async () => {
        calls.push(key);
        return key;
      },
      LoadTicket.of(tier),
    );
  const distant = request('distant', LOAD_TIER.prefetch),
    near = request('near', LOAD_TIER.near);
  const body = request('body', LOAD_TIER.essential),
    floor = request('floor', LOAD_TIER.initial);
  await Promise.all([body, floor]);
  assert.deepEqual(calls, ['body', 'floor']);
  assert.equal(queue.active, 0);
  release();
  release();
  await Promise.all([near, distant]);
  assert.deepEqual(calls, ['body', 'floor', 'near', 'distant']);
});

test('an essential consumer promotes held work without starting it twice', async () => {
  const queue = new AssetLoadQueue(),
    release = queue.deferFrom(loadPriority(LOAD_TIER.near));
  let calls = 0;
  const background = queue.request(
    'same',
    async () => {
      calls++;
      return 7;
    },
    LoadTicket.of(LOAD_TIER.scene),
  );
  const essential = queue.request(
    'same',
    async () => {
      throw Error('must join');
    },
    LoadTicket.of(LOAD_TIER.essential),
  );
  assert.equal(await essential, 7);
  assert.equal(await background, 7);
  release();
  await settle();
  assert.equal(calls, 1);
});

test('nested entry gates preserve running work and cancel withdrawn/abandoned work', async () => {
  const queue = new AssetLoadQueue(1),
    running = deferred();
  const first = queue.request(
    'already running',
    () => running.promise,
    LoadTicket.of(LOAD_TIER.scene),
  );
  const outer = queue.deferFrom(loadPriority(LOAD_TIER.scene)),
    inner = queue.deferFrom(loadPriority(LOAD_TIER.near));
  let nearStarted = false;
  const near = queue.request(
    'near',
    async () => {
      nearStarted = true;
    },
    LoadTicket.of(LOAD_TIER.near),
  );
  const ticket = LoadTicket.of(LOAD_TIER.visible);
  const unwanted = queue.request(
    'unwanted',
    async () => {
      throw Error('unwanted ran');
    },
    ticket,
  );
  const refusal = assert.rejects(unwanted, isLoadCancelled);
  ticket.release();
  await refusal;
  running.resolve(1);
  assert.equal(await first, 1);
  await settle();
  assert.equal(nearStarted, false);
  outer();
  await settle();
  assert.equal(nearStarted, false);
  inner();
  await near;
  assert.equal(nearStarted, true);
  const held = queue.deferFrom(loadPriority(LOAD_TIER.near));
  const abandoned = queue.request(
    'abandoned',
    async () => {
      throw Error('disposed ran');
    },
    LoadTicket.of(LOAD_TIER.near),
  );
  const disposed = assert.rejects(abandoned, isLoadCancelled);
  queue.dispose();
  held();
  await disposed;
  assert.equal(queue.queued.length, 0);
});
