import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { LOADING_TEXT, LOADING_TIMING, LoadingCover, TipDeck } from '../dist/src/loading-screen.js';
import { LOADING_TIPS } from '../dist/src/loading-tips.js';

const main = await readFile(new URL('../dist/src/main.js', import.meta.url), 'utf8');

/** A clock whose timers run only when the test advances it. */
function fakeClock() {
  let now = 1000,
    next = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(callback, ms) {
      timers.set(++next, { at: now + ms, callback });
      return next;
    },
    clearTimeout: (handle) => timers.delete(handle),
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers.entries()]
          .filter(([, timer]) => timer.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        timers.delete(due[0]);
        now = due[1].at;
        due[1].callback();
      }
      now = end;
    },
  };
}

function fakeView() {
  const calls = [];
  return {
    calls,
    states: () => calls.filter(([kind]) => kind === 'state').map(([, state]) => state),
    lastContent: () => calls.filter(([kind]) => kind === 'content').at(-1),
    content: (place, tip) => calls.push(['content', place, tip]),
    status: (text, progress) => calls.push(['status', text, progress]),
    state: (state) => calls.push(['state', state]),
  };
}

const tips = [
  { title: 'a', text: 'A' },
  { title: 'b', text: 'B' },
  { title: 'c', text: 'C' },
];
const warp = { eyebrow: 'ワープ', name: 'アプデの洞窟', image: '/spawn/cave.jpg' };

test('the Cro-Magnon tips are short, distinct and fit a phone held upright', () => {
  assert.ok(LOADING_TIPS.length >= 20);
  assert.ok(Object.isFrozen(LOADING_TIPS));
  assert.equal(new Set(LOADING_TIPS.map((tip) => tip.title)).size, LOADING_TIPS.length);
  for (const tip of LOADING_TIPS) {
    assert.ok(tip.title.length > 0 && tip.title.length <= 14, tip.title);
    // About three lines of 13px text across a 390px-wide screen.
    assert.ok(tip.text.length >= 20 && tip.text.length <= 72, `${tip.title}: ${tip.text.length}`);
    assert.match(tip.text, /。$/);
  }
});

test('the tip deck shows every tip once per round and never the same tip twice in a row', () => {
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const deck = new TipDeck(LOADING_TIPS, random);
  let previous = null;
  for (let round = 0; round < 6; round++) {
    const shown = new Set();
    for (let i = 0; i < LOADING_TIPS.length; i++) {
      const tip = deck.next();
      assert.notEqual(tip, previous);
      shown.add(tip);
      previous = tip;
    }
    assert.equal(shown.size, LOADING_TIPS.length);
  }
  // A random source that always restarts a round with the last tip is corrected.
  const stubborn = new TipDeck(tips, () => 0.999);
  let last = null;
  for (let i = 0; i < 12; i++) {
    const tip = stubborn.next();
    assert.notEqual(tip, last);
    last = tip;
  }
  assert.throws(() => new TipDeck([]));
});

test('the cover appears at once, keeps its tip readable for the minimum and then fades', () => {
  const clock = fakeClock(),
    view = fakeView();
  const cover = new LoadingCover(view, new TipDeck(tips, () => 0), clock);
  const request = cover.show(warp);
  assert.equal(cover.active, true);
  assert.equal(cover.current(request), true);
  assert.deepEqual(view.states(), ['shown']);
  assert.deepEqual(view.lastContent().slice(1, 2), [warp]);
  assert.ok(
    view.calls.some(
      ([kind, text, value]) => kind === 'status' && text === LOADING_TEXT && value === null,
    ),
  );
  // Loaded quickly: still shown until the minimum has passed.
  clock.advance(400);
  cover.release(request);
  clock.advance(LOADING_TIMING.minimumMs - 400 - 1);
  assert.equal(cover.active, true);
  clock.advance(1);
  assert.equal(cover.active, false);
  assert.deepEqual(view.states(), ['shown', 'leaving']);
  assert.equal(cover.current(request), true, 'still on screen while it fades');
  clock.advance(LOADING_TIMING.fadeMs);
  assert.deepEqual(view.states(), ['shown', 'leaving', 'hidden']);
  assert.equal(cover.current(request), false);
  // A slow load leaves at once when released.
  const slow = cover.show(warp);
  clock.advance(LOADING_TIMING.minimumMs + 500);
  cover.release(slow);
  clock.advance(0);
  assert.equal(cover.active, false);
});

test('a newer request takes the cover over: one screen, one tip, released only by the newer request', () => {
  const clock = fakeClock(),
    view = fakeView();
  const cover = new LoadingCover(view, new TipDeck(tips, () => 0.5), clock);
  const entry = cover.show({ eyebrow: '', name: '' });
  const tip = view.lastContent()[2];
  clock.advance(200);
  const arrival = cover.show(warp);
  assert.equal(cover.current(entry), false);
  assert.equal(view.lastContent()[1], warp);
  assert.equal(view.lastContent()[2], tip, 'the tip being read stays');
  assert.deepEqual(view.states(), ['shown']);
  cover.release(entry);
  clock.advance(LOADING_TIMING.minimumMs * 2);
  assert.equal(cover.active, true, 'the replaced request cannot lift the cover');
  cover.release(arrival);
  clock.advance(0);
  assert.equal(cover.active, false, 'the minimum counts from the first appearance');
  // A load starting during the fade-out brings the same tip back at once.
  const again = cover.show(warp);
  assert.deepEqual(view.states(), ['shown', 'leaving', 'shown']);
  assert.equal(view.lastContent()[2], tip);
  cover.release(again);
  clock.advance(LOADING_TIMING.fadeMs + 1);
  assert.deepEqual(view.states().slice(-2), ['leaving', 'hidden']);
});

test('a long load turns to the next tip, and cancelling removes the cover at once', () => {
  const clock = fakeClock(),
    view = fakeView();
  const cover = new LoadingCover(view, new TipDeck(tips, () => 0.3), clock);
  const request = cover.show(warp);
  const first = view.lastContent()[2];
  clock.advance(LOADING_TIMING.tipMs);
  const second = view.lastContent()[2];
  assert.notEqual(second, first);
  assert.equal(view.lastContent()[1], warp);
  cover.status('読み込み中 50%', 0.5);
  assert.deepEqual(view.calls.at(-1), ['status', '読み込み中 50%', 0.5]);
  cover.cancel();
  assert.equal(cover.active, false);
  assert.equal(cover.current(request), false);
  assert.equal(view.states().at(-1), 'hidden');
  const contents = view.calls.filter(([kind]) => kind === 'content').length;
  clock.advance(LOADING_TIMING.tipMs * 3);
  cover.release(request);
  clock.advance(LOADING_TIMING.minimumMs);
  assert.equal(view.calls.filter(([kind]) => kind === 'content').length, contents);
  assert.equal(view.states().at(-1), 'hidden');
  cover.status('ignored', 0.1);
  assert.notDeepEqual(view.calls.at(-1), ['status', 'ignored', 0.1]);
});

function coverArrivalSource() {
  const start = main.indexOf('async function coverArrival(');
  const end = main.indexOf('\n}\n', start);
  assert.ok(start >= 0 && end > start);
  return main.slice(start, end + 2);
}

test('a covered arrival lifts the screen only for the request still shown', async () => {
  const run = async (surroundingsReady, { supersede = false } = {}) => {
    const calls = [];
    let latest = 0;
    await vm.runInNewContext(`${coverArrivalSource()}\ncoverArrival(place)`, {
      place: warp,
      LOADING_TEXT,
      manualLeave: false,
      requestAnimationFrame: () => {},
      // The paint the cover waits for before the arrival's work.
      nextPaint: async () => calls.push('painted'),
      loadingScreen: {
        show: () => ++latest,
        current: (request) => request === latest,
        status: (text) => calls.push(['status', text]),
        release: (request) => calls.push(['release', request]),
        cancel: () => calls.push('cancel'),
      },
      renderer: {
        loadProgress: { phase: 'ready', loaded: 0, total: 0 },
        surroundingsReady: async (current) => {
          calls.push('arrival');
          if (supersede) latest++;
          await surroundingsReady(current);
        },
      },
    });
    return calls;
  };
  // The screen is painted before the arrival's work starts.
  assert.deepEqual(await run(async () => {}), [
    ['status', LOADING_TEXT],
    'painted',
    'arrival',
    ['release', 1],
  ]);
  const fail = async () => {
    throw new Error('the world stopped or the visitor left');
  };
  // Nobody else removed it (the visitor left without the title or setup): it goes.
  assert.deepEqual(await run(fail), [['status', LOADING_TEXT], 'painted', 'arrival', 'cancel']);
  // A newer cover owns the screen: the older request leaves it alone.
  assert.deepEqual(await run(fail, { supersede: true }), [
    ['status', LOADING_TEXT],
    'painted',
    'arrival',
  ]);
});

test('own warps and entries without the cave are covered; the title, setup and failures remove the cover', () => {
  const slice = (from, to) => {
    const start = main.indexOf(from);
    assert.ok(start >= 0, from);
    return main.slice(start, main.indexOf(to, start));
  };
  // The QA shortcut skips the entry cover as it skips the title.
  assert.match(
    slice('function beginGame()', '\n}\n'),
    /connect\(\);[\s\S]*if \(query\.get\('autostart'\) !== '1'\)\s*void coverArrival\(\{ eyebrow: '', name: '' \}\);/,
  );
  // Only a warp this player asked for: a test fixture moving a player stays uncovered.
  const warp = slice('let coveredWarp = null;', 'updateCharacterSwitch(');
  assert.match(
    warp,
    /const request = warpRequest;\s*warpRequest = null;\s*if \(request &&\s*performance\.now\(\) - request\.at < WARP_REQUEST_MS &&\s*!loadingCave &&\s*!renderUnavailable\)\s*coveredWarp = request\.target;/,
  );
  // Started once the warped state is applied (its floor is the destination's), in the
  // same task, so no frame draws the destination before the cover.
  assert.match(
    warp,
    /renderer\.setState\(state, selfId\);\s*(?:\/\/[^\n]*\n\s*)*if \(coveredWarp !== null\)\s*void coverArrival\(warpPlace\(coveredWarp\)\);/,
  );
  for (const name of ['function showTitle()', 'function showSetup(', 'function showRenderError('])
    assert.match(slice(name, '\n}\n'), /loadingScreen\.cancel\(\);/, name);
  assert.match(
    slice('function playReady()', '\n}\n'),
    /return arrived && !graphicsLost && !loadingScreen\.active;/,
  );
  assert.match(
    slice("if (type === 'warp')", 'send({'),
    /warpRequest = \{ target: targetId \?\? '', at: performance\.now\(\) \}/,
  );
  // The loading cave's own load is covered by the same screen and its tips, lifted as
  // soon as the cave is shown; the world then loads while the visitor walks in it.
  const cave = slice('loadingCave = renderer.loadingCave = cave;', 'renderer.failWorld(');
  assert.match(
    cave,
    /const caveCover = loadingScreen\.show\(\{ \.\.\.warpPlace\('spawn-cave'\), eyebrow: '' \}\);\s*loadingScreen\.status\('洞窟を準備しています'\);/,
  );
  assert.match(
    cave,
    /await cave\.load\(\);\s*if \(loadingCave !== cave\)\s*return;\s*loadingScreen\.release\(caveCover\);\s*await Promise\.all\(\[renderer\.startWorld\(\), renderer\.prepareSelf\(profile\)\]\);/,
  );
  assert.doesNotMatch(main, /tips: /);
  // The loading cave opens its mural people over itself (the murals it leaves out are not
  // listed) and pauses its own input meanwhile.
  assert.match(
    slice('const cave = new LoadingCave(', 'loadingCave = renderer.loadingCave = cave;'),
    /onMurals: \(hidden\) =>\s*openModal\(muralPeopleDialogMarkup\(muralPeople\(hidden\), \{ links: onlineTitle \}\)\),\s*paused: \(\) => \$\('#modal'\)\.open,/,
  );
});

test('a warp names its destination, with a photo only for the pictured sights', async () => {
  const start = main.indexOf('function warpPlace(');
  const source = main.slice(start, main.indexOf('\n}\n', start) + 2);
  const { warpDestination } = await import('../dist/shared/warp-sites.mjs');
  const place = (target) =>
    vm.runInNewContext(`${source}\nwarpPlace(target)`, { target, warpDestination });
  assert.deepEqual(
    { ...place('spawn-cave') },
    { eyebrow: 'ワープ', name: warpDestination('spawn-cave').name, image: '/spawn/cave.jpg' },
  );
  assert.deepEqual({ ...place('fire-50-50') }, { eyebrow: 'ワープ', name: 'はじまりの焚き火' });
  assert.deepEqual({ ...place('') }, { eyebrow: 'ワープ', name: '' });
});
