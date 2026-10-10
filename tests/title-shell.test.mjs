import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {
  TITLE_BUSY,
  TitleShellSession,
  titleLinks,
  titleScreenMarkup,
  modalMarkup,
  GAME_TITLE,
  titleArtPath,
} from '../dist/src/title-shell.js';
import { BUILD_PROFILE } from '../dist/src/build-profile.js';
import { FRIEND_MASCOTS as ROSTER } from '../dist/shared/friend-mascot-roster.mjs';
import { FRIEND_MASCOTS } from '../dist/shared/friend-mascots.mjs';
import { CONTRIBUTOR_CHARACTERS, titleContributors } from '../dist/src/title-credits.js';

/** A page stand-in that records what the session asked of it. */
function fakeView() {
  const view = {
    calls: [],
    statuses: [],
    open: false,
    released: 0,
    status(status) {
      this.statuses.push(status);
    },
    openContributors(links) {
      this.calls.push(['open', links]);
      this.open = true;
    },
    closeContributors() {
      this.calls.push(['close']);
      this.open = false;
    },
    contributorsOpen() {
      return this.open;
    },
    release() {
      this.released++;
      return { viewport: 'viewport', title: 'title', dialog: 'dialog' };
    },
  };
  return view;
}

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('a pending start is handed to the game once with the shell nodes; later actions are inert', () => {
  const view = fakeView();
  const session = new TitleShellSession(view, Promise.resolve({ mode: 'online' }));
  session.start();
  assert.deepEqual(view.statuses.at(-1), { kind: 'busy' });
  const handoff = session.take();
  assert.deepEqual(handoff, {
    viewport: 'viewport',
    title: 'title',
    dialog: 'dialog',
    intent: 'start',
    contributorsOpen: false,
  });
  // The busy line never outlives the handoff.
  assert.equal(view.statuses.at(-1), null);
  assert.equal(session.take(), null, 'the intent is consumed once');
  assert.equal(view.released, 1, 'listeners are released once');
  const before = view.statuses.length;
  session.start();
  session.visitCave();
  session.fail('late');
  session.notice('late');
  assert.equal(view.statuses.length, before, 'a taken shell no longer changes the page');
  assert.deepEqual(view.calls, []);
});

test('the latest title action wins; the cave visit closes the dialog and is handed off', async () => {
  const view = fakeView();
  const session = new TitleShellSession(view, Promise.resolve({ mode: 'online' }));
  session.start();
  await session.contributors();
  // Reading the credits withdraws the pending start and its busy line.
  assert.equal(session.intent, null);
  assert.equal(view.statuses.at(-1), null);
  assert.deepEqual(view.calls, [['open', titleLinks({ mode: 'online' })]]);
  session.visitCave();
  assert.deepEqual(view.calls.at(-1), ['close']);
  assert.deepEqual(view.statuses.at(-1), { kind: 'busy' });
  const handoff = session.take();
  assert.equal(handoff.intent, 'contributors-cave');
  assert.equal(handoff.contributorsOpen, false);
});

test('an open contributors dialog is handed over open, without replaying an action', async () => {
  const view = fakeView();
  const session = new TitleShellSession(view, Promise.resolve({ mode: 'online' }));
  await session.contributors();
  const handoff = session.take();
  assert.equal(handoff.contributorsOpen, true);
  assert.equal(handoff.intent, null);
  assert.equal(view.open, true, 'the game keeps the same open dialog');
});

test('a contributors request waiting for the configuration yields to later actions and the handoff', async () => {
  for (const later of ['start', 'take']) {
    const view = fakeView();
    const config = deferred();
    const session = new TitleShellSession(view, config.promise);
    const opening = session.contributors();
    if (later === 'start') session.start();
    const handoff = later === 'take' ? session.take() : null;
    config.resolve({ mode: 'online' });
    await opening;
    assert.deepEqual(view.calls, [], `${later}: no dialog opens afterwards`);
    if (later === 'start') assert.equal(session.intent, 'start');
    else assert.equal(handoff.intent, null);
  }
});

test('failures leave the title usable: explicit error, credits still open, no busy state', async () => {
  const view = fakeView();
  const config = deferred();
  const session = new TitleShellSession(view, config.promise);
  config.reject(new Error('接続設定を読み込めません。'));
  await tick();
  session.fail('接続設定を読み込めません。');
  assert.deepEqual(view.statuses.at(-1), { kind: 'error', message: '接続設定を読み込めません。' });
  session.start();
  assert.deepEqual(view.statuses.at(-1), { kind: 'error', message: '接続設定を読み込めません。' });
  // Without a configuration the credits never link out.
  await session.contributors();
  assert.deepEqual(view.calls, [['open', false]]);
  assert.deepEqual(view.statuses.at(-1), { kind: 'error', message: '接続設定を読み込めません。' });
  session.notice('この画面では全画面表示を利用できません。');
  assert.equal(view.statuses.at(-1).kind, 'error', 'a notice never hides the failure');
});

test('a game-module failure replaces the busy line with an error and reload', () => {
  const view = fakeView();
  const session = new TitleShellSession(view, Promise.resolve({ mode: 'online' }));
  session.start();
  session.fail('ゲームを読み込めませんでした。');
  assert.equal(session.failed, true);
  assert.deepEqual(view.statuses.at(-1), {
    kind: 'error',
    message: 'ゲームを読み込めませんでした。',
  });
  session.notice('x');
  assert.equal(view.statuses.at(-1).kind, 'error');
  assert.equal(TITLE_BUSY, '準備しています…');
});

test('credit links follow the game rule: never for LAN or exhibition builds', () => {
  assert.equal(titleLinks({ mode: 'lan' }), false);
  assert.equal(titleLinks({ mode: 'online' }), BUILD_PROFILE.environment !== 'exhibition');
});

test('the shell renders exactly the title and dialog the game renders without it', async () => {
  const title = titleScreenMarkup();
  assert.equal(GAME_TITLE, 'CRO-MAGNON MMO');
  assert.equal(titleArtPath, '/title/cro-magnon-mmo-transparent.webp');
  assert.equal(title.match(/\/title\/cro-magnon-mmo-transparent\.webp/g).length, 2);
  assert.equal(title.match(/<img /g).length, 1, 'one title artwork element');
  assert.match(
    title,
    /^<section id="screen-title" class="screen title-screen" data-variant="classic" hidden>/,
  );
  assert.match(title, /<button id="title-start" class="menu-item">はじめる<\/button>/);
  assert.match(
    title,
    /<button id="title-contributors" class="menu-item">関わってくれた人たち<\/button>/,
  );
  assert.match(title, /id="title-fullscreen"[^>]*aria-pressed="false"/);
  assert.match(modalMarkup(), /^<dialog id="modal">.*<div id="modal-body"><\/div><\/dialog>$/);
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(main, /\$\{titleHandoff \? '' : titleScreenMarkup\(\)\}/);
  assert.match(
    main,
    /\$\('#app'\)\.innerHTML = `\$\{viewportMarkup\}\\n {2}\$\{modalMarkup\(\)\}`/,
  );
  assert.doesNotMatch(main, /id="screen-title"|<dialog id="modal">/, 'one source for each node');
});

test('the data-free roster is the same object every companion user sees, with the same credits', () => {
  assert.equal(FRIEND_MASCOTS, ROSTER);
  assert.ok(Object.isFrozen(FRIEND_MASCOTS));
  for (const friend of FRIEND_MASCOTS)
    assert.deepEqual(CONTRIBUTOR_CHARACTERS[friend.credit], { name: friend.name, appears: '仲間' });
  assert.ok(titleContributors().length > 0);
});

test('the game module performs the handed-off action once and keeps an open dialog', async () => {
  const main = await readFile(new URL('../dist/src/main.js', import.meta.url), 'utf8');
  const start = main.indexOf('function resumeTitle(');
  const end = main.indexOf("startupMarks.page('game-module-ready')", start);
  assert.ok(start >= 0 && end > start);
  const source = `${main.slice(start, end)}\nresumeTitle(handoff);`;
  const run = (handoff, extra = {}) => {
    const calls = [];
    vm.runInNewContext(source, {
      handoff,
      screens: { show: (id) => calls.push(['show', id]) },
      bindContributorsVisit: () => calls.push('bind'),
      showTitle: () => calls.push('title'),
      showSetup: () => calls.push('setup'),
      visitContributorsCave: () => calls.push('visit'),
      renderUnavailable: false,
      loadingCave: null,
      ...extra,
    });
    return calls;
  };
  assert.deepEqual(run(null), ['title']);
  assert.deepEqual(run({ intent: null, contributorsOpen: false }), ['title']);
  assert.deepEqual(run({ intent: 'start', contributorsOpen: false }), ['title', 'setup']);
  assert.deepEqual(run({ intent: 'contributors-cave', contributorsOpen: false }), [
    'title',
    'visit',
  ]);
  assert.deepEqual(
    run({ intent: 'contributors-cave', contributorsOpen: false }, { renderUnavailable: true }),
    ['title'],
  );
  assert.deepEqual(run({ intent: null, contributorsOpen: true }), [['show', 'title'], 'bind']);
});
