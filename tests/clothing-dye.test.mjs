import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { createGameCore } from '../dist/application/game-core.mjs';
import {
  CLOTHING_DYES,
  DYE_COOLDOWN_MS,
  dyeColor,
  normalizeDye,
} from '../dist/shared/clothing-dye.mjs';
import { ALL_CONTENT, visibleCharacters } from '../dist/shared/content-visibility.mjs';
import { CHARACTER_MODELS } from '../dist/shared/character-profiles.mjs';
import {
  CLOTHING_DYE_RULES,
  ClothingDye,
  clothingDyeAvailable,
  installClothingDye,
} from '../dist/src/clothing-dye.js';
import {
  configureActorPerformance,
  disposeActorPerformance,
  updateActorPerformance,
} from '../dist/src/performance-lod.js';
import { ActorFade } from '../dist/src/camera-fade.js';
import { CharacterAssets } from '../dist/src/character-assets.js';
import { deliveredWomanRig } from './cro-magnon-woman-rig.mjs';
import { assertPublicCharacterData, publicModelRules } from '../scripts/public-character-audit.mjs';

test('public clothing rules retain released dyes while excluding private and dormant characters', () => {
  const characters = CHARACTER_MODELS.filter(
    (model) => model.playable !== false && model.species !== 'maruimo' && model.species !== 'nea',
  );
  const rules = publicModelRules(CLOTHING_DYE_RULES, characters);
  assert.equal(Object.keys(rules).length, 5);
  for (const character of characters)
    assert.deepEqual(rules[character.key], CLOTHING_DYE_RULES[character.key]);
  assert.ok(CLOTHING_DYE_RULES['maruimo-octopus'], 'the local rule is retained');
  assertPublicCharacterData(
    'src/clothing-dye-rules.js',
    Buffer.from(JSON.stringify(rules)),
    new Set(['maruimo-octopus', 'neanderthal-woman', 'neanderthal-hunter']),
    new Set(['maruimo', 'nea']),
  );
});

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  messages = [];
  send(raw) {
    this.messages.push(JSON.parse(raw));
  }
  close() {
    this.readyState = 3;
    this.emit('close');
  }
  ping() {
    this.emit('pong');
  }
  terminate() {
    this.close();
  }
}

function world() {
  let now = 10000,
    serial = 0;
  const settings = {
    persistentSessions: true,
    keepEmptyRooms: true,
    runtime: { now: () => now, id: () => `id-${++serial}`, token: () => `token-${++serial}` },
  };
  let core = createGameCore(settings);
  const join = (name, params = {}) => {
    const socket = new Socket();
    core.connect(
      socket,
      new URLSearchParams({ room: 'DYE', resume: '1', session: '', name, ...params }),
    );
    const welcome = socket.messages.find((m) => m.type === 'welcome');
    return { socket, id: welcome.id, session: welcome.session, welcome };
  };
  const dye = (who, key, after = DYE_COOLDOWN_MS) => {
    now += after;
    who.socket.emit(
      'message',
      JSON.stringify({ type: 'action', action: 'dyeClothes', ...(key ? { targetId: key } : {}) }),
    );
  };
  const states = (who) => who.socket.messages.filter((m) => m.type === 'state');
  const worn = (who, id) =>
    states(who)
      .at(-1)
      .players.find((p) => p.id === id).dye;
  const room = () => core.rooms.get('DYE');
  const restart = () => {
    const saved = core.exportState();
    core.close();
    core = createGameCore(settings);
    core.importState(saved);
    return saved;
  };
  return { join, dye, states, worn, room, restart, now: () => now };
}

test('eight distinct dyes, each a known key; anything else is the character’s own colours', () => {
  assert.equal(CLOTHING_DYES.length, 8);
  assert.equal(new Set(CLOTHING_DYES.map((d) => d.key)).size, 8);
  assert.equal(new Set(CLOTHING_DYES.map((d) => d.color)).size, 8);
  for (const { key, color } of CLOTHING_DYES) {
    assert.equal(normalizeDye(key), key);
    assert.match(color, /^#[0-9a-f]{6}$/);
    assert.equal(dyeColor(key), color);
  }
  for (const other of ['', null, undefined, 'orange', 'RED', 3, {}, '__proto__'])
    assert.equal(normalizeDye(other), null);
});

test('a traveler dyes their clothes for the whole room; an unknown colour means their own', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B');
  assert.equal(w.worn(b, a.id), null, 'a newcomer wears the character’s own colours');
  w.dye(a, 'teal');
  assert.equal(w.room().players.get(a.id).dye, 'teal');
  assert.equal(w.worn(b, a.id), 'teal', 'everyone in the room sees it');
  assert.equal(w.worn(a, a.id), 'teal');
  w.dye(a, 'orange');
  assert.equal(w.room().players.get(a.id).dye, null, 'an unknown dye is the own colours');
  w.dye(a, 'pink');
  w.dye(a, '');
  assert.equal(w.worn(b, a.id), null, 'no dye returns to the own colours');
  assert.equal(w.worn(b, b.id), null, 'nobody else changed');
});

test('the same colour sends nothing, and a change waits for the short cooldown', () => {
  const w = world();
  const a = w.join('A'),
    b = w.join('B');
  w.dye(a, 'red');
  const sent = w.states(b).length;
  w.dye(a, 'red', 0);
  assert.equal(w.states(b).length, sent, 'the same colour again is no broadcast');
  w.dye(a, 'blue', DYE_COOLDOWN_MS / 2);
  assert.equal(w.room().players.get(a.id).dye, 'red', 'too soon after the last change');
  assert.equal(w.states(b).length, sent);
  w.dye(a, 'blue', DYE_COOLDOWN_MS / 2);
  assert.equal(w.room().players.get(a.id).dye, 'blue');
  // A cosmetic change also works while recovering, riding or doing anything else.
  w.room().players.get(a.id).downedUntil = w.now() + 60_000;
  w.dye(a, 'green');
  assert.equal(w.room().players.get(a.id).dye, 'green', 'while recovering');
});

test('the colour chosen on this browser arrives with a new traveler and a title start only', () => {
  const w = world();
  const a = w.join('A', { dye: 'purple' });
  assert.equal(w.room().players.get(a.id).dye, 'purple', 'a new traveler wears it');
  assert.equal(a.welcome.profile.dye, 'purple', 'the welcome reports what they wear');
  assert.equal(w.join('X', { dye: 'violet' }).welcome.profile.dye, null, 'unknown: own colours');
  a.socket.close();
  // A reconnection continues with what the room has them wear.
  const back = w.join('A', { session: a.session, dye: 'white' });
  assert.equal(back.id, a.id);
  assert.equal(w.room().players.get(a.id).dye, 'purple');
  assert.equal(back.welcome.profile.dye, 'purple');
  back.socket.close();
  // A title start wears the browser's choice, like its name and character.
  const start = w.join('A', { session: back.session, dye: 'white', startAtCamp: '1' });
  assert.equal(start.id, a.id);
  assert.equal(w.room().players.get(a.id).dye, 'white');
  start.socket.close();
  const plain = w.join('A', { session: start.session, startAtCamp: '1' });
  assert.equal(w.room().players.get(plain.id).dye, null, 'a title start without one: own');
});

test('a dye is kept with the player across a restart and cleaned when restored', () => {
  const w = world();
  const a = w.join('A');
  w.dye(a, 'yellow');
  a.socket.close();
  const saved = w.restart();
  const entry = saved.rooms[0].sessions.find((s) => s.player.id === a.id);
  assert.equal(entry.player.dye, 'yellow');
  assert.ok(!('lastDyeAt' in entry.player), 'the cooldown is not saved');
  const back = w.join('A', { session: a.session });
  assert.equal(back.id, a.id);
  assert.equal(w.worn(back, a.id), 'yellow');
  // A save edited by hand, or from another build, restores only known dyes.
  back.socket.close();
  const edited = w.restart();
  edited.rooms[0].sessions.find((s) => s.player.id === a.id).player.dye = 'gold';
  const core = createGameCore({ persistentSessions: true, keepEmptyRooms: true });
  core.importState(edited);
  const restored = [...core.rooms.values()][0].sessions;
  assert.equal([...restored.values()].find((s) => s.player.id === a.id).player.dye, null);
  core.close();
});

test('every playable character has a dye rule naming clothing materials its delivered GLB has', () => {
  const playable = CHARACTER_MODELS.filter(
    (model) => model.playable !== false && !model.key.startsWith('neanderthal-'),
  ).map((model) => model.key);
  for (const model of visibleCharacters(ALL_CONTENT))
    assert.ok(playable.includes(model.key), model.key);
  assert.deepEqual(Object.keys(CLOTHING_DYE_RULES).sort(), [...playable].sort());
  for (const key of playable) {
    assert.ok(clothingDyeAvailable(key), key);
    const asset = JSON.parse(readFileSync(`public/models/${key}/asset.json`, 'utf8'));
    const glb = readFileSync(`public${asset.url}`),
      json = JSON.parse(glb.subarray(20, 20 + glb.readUInt32LE(12)).toString('utf8'));
    const names = json.materials.map((material) => material.name);
    for (const name of CLOTHING_DYE_RULES[key].materials) assert.ok(names.includes(name), name);
    // Faces and the hunter's tribe-coloured accent are never dyed.
    assert.ok(!CLOTHING_DYE_RULES[key].materials.some((name) => /head|accent/i.test(name)));
  }
  assert.equal(clothingDyeAvailable('howkey-scientist'), false, 'a companion, not a traveler');
  assert.equal(clothingDyeAvailable('constructor'), false);
  assert.equal(clothingDyeAvailable(undefined), false);
});

function geometry({ tangent = false, top = 1.7 } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, 0, 0, 0.3, top, 0, -0.3, 1, 0], 3),
  );
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 1, 0, 1], 2));
  if (tangent)
    g.setAttribute(
      'tangent',
      new THREE.Float32BufferAttribute([1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 1], 4),
    );
  return g;
}

/** An actor shaped like a delivered player body: a clothed body (with a normal map, whose reduced
 * geometry lacks tangents, so it wears an LOD variant far away), a head and a tribe accent. */
function body() {
  const normalMap = new THREE.Texture();
  const body = new THREE.MeshStandardMaterial({ name: 'BodySurface', normalMap }),
    head = new THREE.MeshStandardMaterial({ name: 'HeadSurface' }),
    accent = new THREE.MeshStandardMaterial({ name: 'TribeAccent' });
  const root = new THREE.Group(),
    lowRoot = new THREE.Group();
  const meshes = [
    ['Body', geometry({ tangent: true, top: 1.3 }), body, geometry({ top: 1.3 })],
    ['Head', geometry({ top: 1.7 }), head, geometry({ top: 1.7 })],
    ['Accent', geometry({ top: 1.5 }), accent, geometry({ top: 1.5 })],
  ].map(([name, high, material, low]) => {
    const mesh = new THREE.Mesh(high, material);
    mesh.name = name;
    root.add(mesh);
    const reduced = new THREE.Mesh(low, new THREE.MeshBasicMaterial());
    reduced.name = name;
    lowRoot.add(reduced);
    return mesh;
  });
  return { root, lowRoot, meshes, template: { body, head, accent } };
}

// The dye uniform holds sRGB components: read them back without another conversion.
const SRGB_AS_IS = THREE.LinearSRGBColorSpace;

const shaderOf = (material) => {
  const shader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  material.onBeforeCompile(shader, null);
  return shader;
};

test('an actor’s clothing is its own copy; its far level and camera fade share the dye', () => {
  const { root, lowRoot, meshes, template } = body();
  const clothing = installClothingDye(root, 'cro-magnon-hunter', 'red');
  const [bodyMesh, headMesh, accentMesh] = meshes;
  const own = bodyMesh.material;
  assert.notEqual(own, template.body, 'the body wears this actor’s copy');
  assert.equal(own.name, 'BodySurface');
  assert.equal(own.normalMap, template.body.normalMap, 'textures stay shared');
  assert.equal(headMesh.material, template.head, 'the head keeps the shared material');
  assert.equal(accentMesh.material, template.accent, 'the tribe accent keeps its own tint');
  assert.equal(template.body.onBeforeCompile, THREE.Material.prototype.onBeforeCompile);
  assert.equal(clothing.materials.get(template.body), own);
  configureActorPerformance(root, lowRoot, { modelKey: 'cro-magnon-hunter', lods: [{}] });
  updateActorPerformance(root, 100);
  const far = bodyMesh.material;
  assert.notEqual(far, own, 'the reduced geometry wears its own finalized variant');
  assert.equal(far.normalScale.y, -own.normalScale.y);
  const fade = new ActorFade([root], true);
  fade.set(0.5);
  const faded = [...fade.copies.values()].find((copy) => copy.name === 'BodySurface');
  assert.ok(faded && faded !== far && faded.alphaHash);
  for (const material of [own, far, faded]) {
    assert.equal(material.customProgramCacheKey(), 'clothing-dye-1');
    const { uniforms } = shaderOf(material);
    assert.equal(uniforms.clothDyeColour, clothing.colour, 'one colour for every copy');
    assert.equal(uniforms.clothDyeOn, clothing.on);
  }
  // A new dye is a uniform change seen by every level at once, never a new program.
  clothing.set('white');
  assert.equal(shaderOf(far).uniforms.clothDyeColour.value.getHexString(SRGB_AS_IS), 'e8e4da');
  fade.dispose?.();
  disposeActorPerformance(root);
  assert.equal(bodyMesh.material, own);
  let released = 0;
  own.addEventListener('dispose', () => released++);
  clothing.dispose();
  assert.equal(released, 1);
  assert.equal(clothing.materials.size, 0);
});

test('a dye is uniforms only: its sRGB colour on, or off for the own colours', () => {
  const { root } = body();
  const clothing = installClothingDye(root, 'cro-magnon-woman', null);
  assert.equal(clothing.on.value, 0);
  assert.equal(clothing.dye, null);
  for (const { key, color } of CLOTHING_DYES) {
    clothing.set(key);
    assert.equal(clothing.dye, key);
    assert.equal(clothing.on.value, 1);
    assert.equal(`#${clothing.colour.value.getHexString(SRGB_AS_IS)}`, color);
  }
  clothing.set('mauve');
  assert.equal(clothing.on.value, 0);
  assert.equal(clothing.dye, null);
  assert.equal(installClothingDye(new THREE.Group(), 'howkey-scientist', 'red'), null);
});

test('the shader recolours after the texture and colour chunks, by bind-pose height', () => {
  const { root, meshes } = body();
  // The fennec's rule, worn by a body material.
  const clothing = new ClothingDye(root, {
    ...CLOTHING_DYE_RULES['desert-fennec-mage'],
    materials: ['BodySurface'],
  });
  const shader = shaderOf(meshes[0].material);
  assert.match(shader.vertexShader, /#include <begin_vertex>\nclothDyeY = position\.y;/);
  assert.match(shader.vertexShader, /varying float clothDyeY;/);
  assert.match(
    shader.fragmentShader,
    /#include <color_fragment>\ndiffuseColor\.rgb = clothDyed\(diffuseColor\.rgb\);/,
  );
  assert.ok(
    shader.fragmentShader.indexOf('vec3 clothDyed(') < shader.fragmentShader.indexOf('void main'),
  );
  const { clothDyeHeight, clothDyeLuminance, clothDyeKeep, clothDyeLift } = shader.uniforms;
  // The body geometry spans y 0 to 1.3; the rule's fraction and ranges are passed on.
  const [bottom, top, from, to] = clothDyeHeight.value.toArray();
  assert.equal(bottom, 0);
  assert.ok(Math.abs(top - 1.3) < 1e-6);
  assert.deepEqual([from, to], [0.25, 0.62]);
  assert.deepEqual(clothDyeLuminance.value.toArray(), [0.13, 0.62]);
  assert.deepEqual(clothDyeKeep.value.toArray(), [70 / 360, 220 / 360, 0.1, 1]);
  assert.equal(clothDyeLift.value, 0.28);
  // Without limits every height and luminance takes the dye; without a kept range none is kept.
  const hunter = shaderOf(
    installClothingDye(body().root, 'cro-magnon-hunter', 'red').materials.values().next().value,
  );
  assert.deepEqual(hunter.uniforms.clothDyeLuminance.value.toArray(), [-1, 2]);
  assert.deepEqual(hunter.uniforms.clothDyeHeight.value.toArray().slice(2), [-1, 2]);
  assert.ok(hunter.uniforms.clothDyeKeep.value.z > 1, 'no saturation is in the kept range');
  clothing.dispose();
});

test('a traveler’s actor wears its own dyed clothing; a resident wears the shared materials', async () => {
  const rig = await deliveredWomanRig();
  // The CPU rig has one inspection material; give each primitive its delivered material's name,
  // one material per name shared by every actor of the template, as the browser load does.
  const names = rig.primary.doc.meshes.flatMap((mesh) =>
    mesh.primitives.map((primitive) => rig.primary.doc.materials[primitive.material].name),
  );
  const template = () => {
    const scene = cloneSkeleton(rig.primary.scene),
      shared = new Map();
    let index = 0;
    scene.traverse((node) => {
      if (!node.isMesh) return;
      const name = names[index++];
      if (!shared.has(name)) shared.set(name, new THREE.MeshStandardMaterial({ name }));
      node.material = shared.get(name);
    });
    assert.equal(index, names.length);
    return { gltf: { scene, animations: rig.primary.animations }, lod: null, asset: rig.asset };
  };
  const assets = new CharacterAssets('/models/cro-magnon-woman/asset.json', {
    loadModel: async () => template(),
  });
  const materials = (actor) => {
    const found = new Map();
    actor.root.traverse((node) => {
      if (node.isMesh) for (const m of [node.material].flat()) found.set(m.name, m);
    });
    return found;
  };
  const traveler = await assets.create({ color: '#b04020', dye: 'blue' });
  const resident = await assets.create({ color: '#b04020' });
  const shared = materials(resident);
  const worn = materials(traveler);
  assert.ok(shared.has('BodySurface') && shared.has('HeadSurface'));
  assert.equal(resident.clothing, null, 'no clothing copy without a dye request');
  assert.notEqual(worn.get('BodySurface'), shared.get('BodySurface'));
  assert.equal(worn.get('HeadSurface'), shared.get('HeadSurface'), 'the face is never copied');
  assert.equal(traveler.clothing.dye, 'blue');
  traveler.setDye('green');
  assert.equal(traveler.clothing.dye, 'green');
  traveler.setDye(null);
  assert.equal(traveler.clothing.on.value, 0);
  resident.setDye('red');
  assert.equal(materials(resident).get('BodySurface'), shared.get('BodySurface'));
  let released = 0;
  worn.get('BodySurface').addEventListener('dispose', () => released++);
  traveler.dispose();
  assert.equal(released, 1, 'the copy goes with its actor');
  resident.dispose();
  assets.dispose();
});
