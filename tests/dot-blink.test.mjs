import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
  BLINK_GAP,
  DOT_FACES,
  DotBlink,
  blinkClosure,
  installDotBlink,
} from '../dist/src/dot-blink.js';
import { BOT_KINDS } from '../dist/shared/orb-bots.mjs';

test('a blink drops the lids fast, holds them shut and opens them, all within a quarter second', () => {
  assert.equal(blinkClosure(-0.01), 0);
  assert.equal(blinkClosure(0), 0);
  assert.ok(blinkClosure(0.035) > 0 && blinkClosure(0.035) < 0.5, 'closing accelerates');
  assert.equal(blinkClosure(0.08), 1);
  assert.ok(blinkClosure(0.16) > 0 && blinkClosure(0.16) < 0.5, 'opening');
  assert.equal(blinkClosure(0.25), 0);
  let previous = 0;
  for (let t = 0; t <= 0.07; t += 0.005) {
    assert.ok(blinkClosure(t) >= previous);
    previous = blinkClosure(t);
  }
});

test('every Dot with eyes that can be seen open has lids; the triangle and heart bots do not', () => {
  const kinds = [...BOT_KINDS];
  for (const kind of ['white', 'blue', 'green', 'purple', 'orange', 'beret', 'frog'])
    assert.ok(DOT_FACES[kind], kind);
  for (const kind of ['triangle', 'heart']) assert.equal(DOT_FACES[kind], undefined, kind);
  for (const kind of Object.keys(DOT_FACES)) assert.ok(kinds.includes(kind), kind);
  for (const [kind, face] of Object.entries(DOT_FACES)) {
    // One eye each side of the face, on the front, inside the 28 cm body.
    const [a, b] = face.eyes;
    assert.ok(a[0] < 0 && b[0] > 0, kind);
    for (const [x, y, w, h, front] of face.eyes) {
      assert.ok(Math.abs(x) < 0.12 && y > 0.1 && y < 0.25 && w > 0 && h > 0 && front >= 0, kind);
    }
  }
});

function dot() {
  const root = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ name: 'OrbBotSurface' });
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.28, 0.28), material));
  root.add(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), material));
  return { root, material };
}

test('each Dot wears its own copy of the shared material, all on one program', () => {
  const a = dot(),
    b = dot();
  const first = installDotBlink(a.root, 'purple', 0);
  installDotBlink(b.root, 'purple', 0);
  const worn = (root) => root.children.map((mesh) => mesh.material);
  const [copyA, sameA] = worn(a.root);
  assert.equal(copyA, sameA, 'one copy per Dot, shared by its meshes');
  assert.notEqual(copyA, a.material, 'the kind template stays untouched');
  assert.notEqual(copyA, worn(b.root)[0], 'Dots blink on their own');
  assert.equal(copyA.customProgramCacheKey(), worn(b.root)[0].customProgramCacheKey());
  // The hook adds the lids to the standard shader and wires this Dot's closure.
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.standard.vertexShader,
    fragmentShader: THREE.ShaderLib.standard.fragmentShader,
  };
  copyA.onBeforeCompile(shader);
  assert.match(shader.vertexShader, /dotEyePos = position;/);
  assert.match(shader.fragmentShader, /diffuseColor\.rgb = dotBlinked\(diffuseColor\.rgb\);/);
  assert.equal(shader.uniforms.dotBlink, first.closure);
  assert.equal(installDotBlink(dot().root, 'heart', 0), null);
});

test('lids blink on their own clock: within the longest gap, sometimes twice, then open again', () => {
  const sequence = [0.5, 0.1, 0.5, 0.9, 0.5];
  let i = 0;
  const blink = new DotBlink(dot().root, DOT_FACES.white, 0, () => sequence[i++ % sequence.length]);
  // First blink comes within the first gap (staggered so Dots do not blink together).
  let shut = [];
  for (let t = 0; t < BLINK_GAP.min + 0.5; t += 0.01) {
    blink.update(t);
    if (blink.closure.value === 1) shut.push(t);
  }
  assert.ok(shut.length > 0, 'blinked');
  const first = shut[0];
  assert.ok(first <= BLINK_GAP.min * 0.5 + 0.1, `${first}`);
  // A double blink (random 0.1 < 0.2) shuts the lids again a third of a second later.
  assert.ok(
    shut.some((t) => t > first + BLINK_GAP.double - 0.05 && t < first + BLINK_GAP.double + 0.15),
  );
  blink.update(first + 1);
  assert.equal(blink.closure.value, 0, 'open between blinks');
});
