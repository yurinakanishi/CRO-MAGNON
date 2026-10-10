import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { setAttr, setData, setFlag, setText } from '../dist/src/hud-dom.js';

/**
 * Just enough of an HTML element for the HUD's writes, following the DOM and HTML standards:
 * reflected `class`/`title`/`disabled`, the `hidden` setter, `textContent` replacing every
 * child, `dataset` naming data-* attributes. `records` lists what a MutationObserver would
 * receive: setAttribute queues one even for an equal value; replacing children queues one
 * whenever a node is removed or inserted.
 */
class FakeNode {
  parentNode = null;
  get nextSibling() {
    const siblings = this.parentNode?.childNodes ?? [];
    return siblings[siblings.indexOf(this) + 1] ?? null;
  }
}
class FakeText extends FakeNode {
  nodeType = 3;
  constructor(data) {
    super();
    this.data = String(data);
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  nodeType = 1;
  childNodes = [];
  attributes = new Map();
  records = [];
  constructor(attributes = {}, children = []) {
    super();
    for (const [name, value] of Object.entries(attributes)) this.attributes.set(name, value);
    for (const child of children) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }
  setAttribute(name, value) {
    this.records.push(`attributes ${name}`);
    this.attributes.set(name, String(value));
  }
  removeAttribute(name) {
    if (!this.attributes.has(name)) return;
    this.records.push(`attributes ${name}`);
    this.attributes.delete(name);
  }
  get textContent() {
    return this.childNodes.map((child) => child.textContent).join('');
  }
  set textContent(value) {
    const text = value == null ? '' : String(value),
      removed = this.childNodes.splice(0);
    for (const child of removed) child.parentNode = null;
    if (text) {
      const node = new FakeText(text);
      node.parentNode = this;
      this.childNodes.push(node);
    }
    if (removed.length || text) this.records.push('childList');
  }
  get hidden() {
    const value = this.getAttribute('hidden');
    return value === null ? false : value.toLowerCase() === 'until-found' ? 'until-found' : true;
  }
  set hidden(value) {
    if (typeof value === 'string' && value.toLowerCase() === 'until-found')
      this.setAttribute('hidden', 'until-found');
    else if (value === false || value === '' || value == null || value === 0 || Number.isNaN(value))
      this.removeAttribute('hidden');
    else this.setAttribute('hidden', '');
  }
  get disabled() {
    return this.attributes.has('disabled');
  }
  set disabled(value) {
    if (value) this.setAttribute('disabled', '');
    else this.removeAttribute('disabled');
  }
  get className() {
    return this.getAttribute('class') ?? '';
  }
  set className(value) {
    this.setAttribute('class', value);
  }
  get title() {
    return this.getAttribute('title') ?? '';
  }
  set title(value) {
    this.setAttribute('title', value);
  }
  get dataset() {
    const attribute = (key) => `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
    return new Proxy(
      {},
      {
        get: (_, key) => this.getAttribute(attribute(key)) ?? undefined,
        set: (_, key, value) => {
          this.setAttribute(attribute(key), value);
          return true;
        },
      },
    );
  }
}

/** Everything a write can change: attributes in order and the child nodes. */
const snapshot = (element) => ({
  attributes: [...element.attributes],
  children: element.childNodes.map((child) =>
    child.nodeType === 3 ? child.data : { element: child.textContent },
  ),
});

/**
 * Applies `values` in turn with the helper to one element and with the plain assignment to its
 * twin. Both must look the same after every step; the helper may record mutations only when the
 * element actually changed, and reports exactly that.
 */
function compare(make, values, helper, plain, written = (result) => result) {
  const helped = make(),
    direct = make();
  let changes = 0;
  for (const value of values) {
    const before = snapshot(helped),
      records = helped.records.length;
    const result = helper(helped, value);
    plain(direct, value);
    const name = `after ${JSON.stringify(value) ?? String(value)}`;
    assert.deepEqual(snapshot(helped), snapshot(direct), name);
    const changed = !isDeepStrictEqual(before, snapshot(helped));
    assert.equal(helped.records.length > records, changed, `${name}: records only on change`);
    assert.equal(written(result, helped.records.length - records), changed, `${name}: result`);
    if (changed) changes++;
  }
  return { changes, helped, direct };
}

test('text is written only when the element does not already hold exactly that text', () => {
  const values = [
    '',
    '',
    'V',
    'V',
    '横なで',
    '横なで',
    '',
    'x\ny',
    'x\ny',
    5,
    '5',
    null,
    undefined,
    '',
  ];
  const { changes, helped, direct } = compare(
    () => new FakeElement(),
    values,
    setText,
    (element, value) => (element.textContent = value),
  );
  assert.equal(changes, 6, 'V, 横なで, empty, x\\ny, 5 and empty again');
  assert.ok(direct.records.length > helped.records.length, 'plain writes record equal text too');
  // Equal text in another shape still has to be replaced, as the plain write replaces it.
  for (const make of [
    () => new FakeElement({}, [new FakeElement({}, [new FakeText('V')])]),
    () => new FakeElement({}, [new FakeText('V'), new FakeText('')]),
    () => new FakeElement({}, [new FakeText('a'), new FakeText('b')]),
  ])
    for (const value of ['V', 'ab', ''])
      compare(make, [value, value], setText, (element, text) => (element.textContent = text));
});

test('hidden and disabled flags are written only when the attribute is not already as set', () => {
  for (const name of ['hidden', 'disabled'])
    for (const initial of [{}, { [name]: '' }, { [name]: name }, { [name]: 'until-found' }]) {
      const { direct } = compare(
        () => new FakeElement(initial),
        [true, true, false, false, true, false, true, true],
        (element, value) => setFlag(element, name, value),
        (element, value) => (element[name] = value),
      );
      assert.equal(direct.getAttribute(name), '');
    }
  const element = new FakeElement({ hidden: '' });
  assert.equal(setFlag(element, 'hidden', true), false);
  assert.equal(setFlag(element, 'hidden', false), true);
  assert.equal(element.hidden, false, 'a change is visible at once');
  assert.equal(element.getAttribute('hidden'), null);
});

test('attributes (class, title, aria) keep string coercion and attribute presence', () => {
  for (const name of ['class', 'title', 'aria-label'])
    compare(
      () => new FakeElement(),
      ['', '', 'portrait ape', 'portrait ape', 3, '3', null, 'null', undefined, 'undefined'],
      (element, value) => setAttr(element, name, value),
      (element, value) => element.setAttribute(name, value),
    );
  // className and title are the same writes as their reflected attributes.
  compare(
    () => new FakeElement({ class: 'portrait' }),
    ['portrait', 'portrait nea neanderthal-woman', 'portrait nea neanderthal-woman'],
    (element, value) => setAttr(element, 'class', value),
    (element, value) => (element.className = value),
  );
  const { direct } = compare(
    () => new FakeElement(),
    ['', ''],
    (element, value) => setAttr(element, 'title', value),
    (element, value) => (element.title = value),
  );
  assert.equal(direct.getAttribute('title'), '', 'an empty title is still an attribute');
});

test('dataset entries are written only when they differ, in order and as strings', () => {
  const values = [
    { carrierId: '', passengerId: '' },
    { carrierId: '', passengerId: '' },
    { mountId: 'mammoth-1', rideAvailable: String(true), riders: '[{"id":"a","riderId":null}]' },
    { mountId: 'mammoth-1', rideAvailable: 'true', riders: '[{"id":"a","riderId":null}]' },
    { huntHealth: 100, rawMeat: 0, cooking: false },
    { huntHealth: '100', rawMeat: '0', cooking: 'false' },
    { huntHealth: '75', rawMeat: '0', cooking: 'false' },
    { level: 'ok' },
    { level: 'low' },
  ];
  const { helped } = compare(
    () => new FakeElement({ 'data-level': 'ok' }),
    values,
    setData,
    (element, entries) => Object.assign(element.dataset, entries),
    (count, records) => {
      assert.equal(count, records, 'the count is the entries written');
      return count > 0;
    },
  );
  assert.equal(helped.getAttribute('data-ride-available'), 'true');
  assert.equal(helped.getAttribute('data-hunt-health'), '75');
  assert.equal(helped.dataset.level, 'low');
});

test('an unchanged HUD writes nothing, and the next state change and countdown show at once', () => {
  const cook = new FakeElement({ hidden: '' }),
    status = new FakeElement({ hidden: '' }),
    label = new FakeElement(),
    world = new FakeElement();
  const update = ({ canCook, cooking, left }) => {
    setFlag(cook, 'hidden', !canCook);
    setFlag(cook, 'disabled', !canCook);
    setFlag(status, 'hidden', !cooking);
    if (cooking) setText(label, `肉を焼いています · ${(left / 1000).toFixed(1)}秒`);
    setData(world, { cooking: String(cooking), rawMeat: String(canCook ? 1 : 0) });
  };
  const records = () => [cook, status, label, world].reduce((n, e) => n + e.records.length, 0);
  const idle = { canCook: false, cooking: false, left: 0 };
  update(idle);
  const settled = records();
  for (let i = 0; i < 50; i++) update(idle);
  assert.equal(records(), settled, 'fifty unchanged updates write nothing');
  update({ canCook: true, cooking: false, left: 0 });
  assert.equal(cook.hidden, false);
  assert.equal(cook.disabled, false);
  update({ canCook: false, cooking: true, left: 3000 });
  assert.deepEqual([cook.hidden, cook.disabled, status.hidden], [true, true, false]);
  assert.equal(label.textContent, '肉を焼いています · 3.0秒');
  assert.equal(world.dataset.cooking, 'true');
  const counting = records();
  update({ canCook: false, cooking: true, left: 2900 });
  assert.equal(label.textContent, '肉を焼いています · 2.9秒', 'the countdown still advances');
  assert.equal(records(), counting + 1, 'only the countdown text changed');
  update({ canCook: false, cooking: true, left: 2900 });
  assert.equal(records(), counting + 1);
});
