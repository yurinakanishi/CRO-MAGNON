import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bindCharacterSelection, characterChoicesMarkup } from '../dist/src/character-selection.js';

function fixture(t) {
  const previous = globalThis.document;
  globalThis.document = { activeElement: null };
  t.after(() => {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  });
  const grid = {};
  const inputs = ['cro-female', 'cro-male', 'nea-female'].map((value) => ({
    value,
    checked: false,
    focusCalls: 0,
    focus(options) {
      assert.deepEqual(options, { preventScroll: true });
      document.activeElement = this;
      this.focusCalls++;
    },
  }));
  const form = {
    querySelector(selector) {
      return selector === '.character-choice-grid'
        ? grid
        : inputs.find((input) => selector.includes(`value="${input.value}"`));
    },
  };
  const move = (index, options = {}) =>
    grid.onpointermove({
      pointerType: 'mouse',
      buttons: 0,
      clientX: 100 + index * 100,
      clientY: 100,
      target: { closest: () => (index < 0 ? null : { querySelector: () => inputs[index] }) },
      ...options,
    });
  bindCharacterSelection(form, { species: 'cro', gender: 'female' });
  return { inputs, form, grid, move };
}

test('pointer browsing moves the single focus without changing the stored radio choice', (t) => {
  const { inputs, move } = fixture(t);
  assert.equal(document.activeElement, null);
  move(1);
  assert.equal(document.activeElement, inputs[1]);
  assert.deepEqual(
    inputs.map((input) => input.checked),
    [true, false, false],
  );
  move(2);
  assert.equal(document.activeElement, inputs[2]);
  assert.deepEqual(
    inputs.map((input) => input.checked),
    [true, false, false],
  );
});

test('stationary pointer cannot undo subsequent keyboard or controller focus', (t) => {
  const { inputs, move } = fixture(t);
  move(1);
  inputs[2].focus({ preventScroll: true });
  move(1);
  assert.equal(document.activeElement, inputs[2]);
  move(1, { clientX: 201 });
  assert.equal(document.activeElement, inputs[1]);
});

test('touch scrolling, dragging and gaps do not move the character cursor', (t) => {
  const { move } = fixture(t);
  move(1, { pointerType: 'touch' });
  move(1, { buttons: 1 });
  move(-1);
  assert.equal(document.activeElement, null);
});

test('reopening setup replaces its hover handler and preserves the saved choice', (t) => {
  const { inputs, form, grid, move } = fixture(t);
  const previous = grid.onpointermove;
  bindCharacterSelection(form, { species: 'cro', gender: 'female' });
  assert.notEqual(grid.onpointermove, previous);
  move(1);
  assert.equal(inputs[1].focusCalls, 1);
  assert.equal(inputs[0].checked, true);
});

test('character cards do not paint stored checked state or mouse hover as a second cursor', async () => {
  const css = await readFile(new URL('../src/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(characterChoicesMarkup(), /character-check/);
  assert.doesNotMatch(css, /\.character-choice:has\(input:checked\)|\.character-choice:hover/);
  assert.match(css, /\.character-choice:focus-within \.character-art\s*\{\s*filter: none/);
});
