import test from 'node:test';
import assert from 'node:assert/strict';
import { ATTEMPT_MARKS, MARK_PREFIX, PAGE_MARKS, StartupMarks } from '../dist/src/startup-marks.js';

/** A User Timing stand-in holding the live entries, like performance.mark. */
function timing() {
  const entries = [];
  return {
    entries,
    mark(name, options) {
      entries.push({ name, detail: options?.detail });
    },
    clearMarks(name) {
      for (let i = entries.length - 1; i >= 0; i--)
        if (entries[i].name === name) entries.splice(i, 1);
    },
  };
}

test('marks are recorded once per attempt; a new attempt clears the old one without growth', () => {
  const page = timing();
  const marks = new StartupMarks(() => page);
  marks.mark('confirm');
  assert.equal(page.entries.length, 0, 'nothing is attributed before the first start');
  marks.page('title-interactive');
  marks.page('title-interactive');
  const first = marks.begin();
  marks.mark('confirm', first);
  marks.mark('confirm', first);
  marks.mark('cave-load-start', first);
  assert.deepEqual(
    page.entries.map((e) => e.name),
    [`${MARK_PREFIX}title-interactive`, `${MARK_PREFIX}confirm`, `${MARK_PREFIX}cave-load-start`],
  );
  for (let i = 0; i < 50; i++) {
    const attempt = marks.begin();
    for (const name of ATTEMPT_MARKS) marks.mark(name, attempt);
  }
  // Bounded: one entry per page mark and per attempt mark, however many starts.
  assert.equal(page.entries.length, 1 + ATTEMPT_MARKS.length);
  assert.ok(page.entries.every((e) => e.detail.page || e.detail.attempt === marks.current));
});

test('a late callback of a left or failed attempt never writes into the current one', () => {
  const page = timing();
  const marks = new StartupMarks(() => page);
  const old = marks.begin();
  marks.mark('confirm', old);
  const current = marks.begin();
  marks.mark('cave-images', old);
  marks.mark('controls', old);
  assert.equal(marks.has('cave-images'), false);
  assert.equal(marks.has('confirm'), false, 'the old attempt was cleared');
  marks.mark('confirm', current);
  assert.deepEqual(
    page.entries.map((e) => [e.name, e.detail.attempt]),
    [[`${MARK_PREFIX}confirm`, current]],
  );
});

test('page marks survive new attempts and are recorded once per page', () => {
  const page = timing();
  const marks = new StartupMarks(() => page);
  for (const name of PAGE_MARKS) marks.page(name);
  marks.begin();
  marks.begin();
  for (const name of PAGE_MARKS) marks.page(name);
  assert.equal(page.entries.length, PAGE_MARKS.length);
  assert.ok(PAGE_MARKS.every((name) => marks.has(name)));
});

test('measurement is optional: no User Timing or a throwing one changes nothing', () => {
  const absent = new StartupMarks(() => null);
  const attempt = absent.begin();
  absent.mark('confirm', attempt);
  absent.page('world-ready');
  assert.equal(absent.has('confirm'), true);
  const throwing = new StartupMarks(() => ({
    mark() {
      throw new Error('denied');
    },
    clearMarks() {
      throw new Error('denied');
    },
  }));
  assert.doesNotThrow(() => {
    const next = throwing.begin();
    throwing.mark('confirm', next);
    throwing.begin();
  });
});
