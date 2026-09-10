import test from 'node:test';
import assert from 'node:assert/strict';
import { GamepadControls } from '../dist/src/gamepad-ui.js';

test('controller selection follows the atlas confirmation focus and the next press warps once', () => {
  const oldDocument = globalThis.document,
    oldElement = globalThis.HTMLElement,
    oldSelect = globalThis.HTMLSelectElement;
  class Element {
    matches() {
      return false;
    }
    closest(selector) {
      return selector === '.atlas' ? {} : null;
    }
  }
  try {
    globalThis.HTMLElement = Element;
    globalThis.HTMLSelectElement = class extends Element {};
    let warps = 0;
    const fire = new Element(),
      warp = new Element();
    globalThis.document = { activeElement: fire };
    fire.click = () => {
      document.activeElement = warp;
    };
    warp.click = () => {
      warps++;
    };
    const controls = Object.create(GamepadControls.prototype);
    controls.focused = fire;
    controls.items = () => [fire, warp];
    controls.focus = (el) => {
      controls.focused = el;
    };
    controls.activate();
    assert.equal(warps, 0, 'selecting must not itself travel');
    assert.equal(controls.focused, warp);
    controls.activate();
    assert.equal(warps, 1);
  } finally {
    if (oldDocument === undefined) delete globalThis.document;
    else globalThis.document = oldDocument;
    if (oldElement === undefined) delete globalThis.HTMLElement;
    else globalThis.HTMLElement = oldElement;
    if (oldSelect === undefined) delete globalThis.HTMLSelectElement;
    else globalThis.HTMLSelectElement = oldSelect;
  }
});
