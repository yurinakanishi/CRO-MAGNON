import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHARACTER_MODELS,
  normalizeCharacter,
  characterModel,
} from '../dist/shared/characters.mjs';
import { WORLD } from '../dist/shared/world.mjs';

test('new and legacy profiles default to female in either species', () => {
  assert.deepEqual(normalizeCharacter(), {
    species: 'cro',
    gender: 'female',
    character: 'cro-magnon-woman',
  });
  assert.equal(characterModel({ species: 'nea' }).key, 'neanderthal-woman');
  assert.equal(characterModel({ species: 'cro' }).key, 'cro-magnon-woman');
  assert.deepEqual(normalizeCharacter({ species: '<invalid>', gender: '../male' }), {
    species: 'cro',
    gender: 'female',
    character: 'cro-magnon-woman',
  });
});

test('every explicit choice resolves to a distinct model and male choices are retained', () => {
  assert.equal(new Set(CHARACTER_MODELS.map((model) => model.key)).size, 19);
  for (const model of CHARACTER_MODELS)
    assert.equal(characterModel({ ...model, character: model.key }).key, model.key);
  assert.equal(characterModel({ species: 'nea', gender: 'male' }).key, 'neanderthal-hunter');
});

test('looks sharing a species and gender are told apart by their model key', () => {
  const girl = { species: 'cro', gender: 'female', character: 'cro-magnon-girl-feather' };
  assert.equal(characterModel(girl).key, 'cro-magnon-girl-feather');
  assert.deepEqual(normalizeCharacter({ character: 'cro-magnon-girl-feather' }), girl);
  // Without a key, or with an unknown one, the first look of the pair stays the default.
  assert.equal(characterModel({ species: 'cro', gender: 'female' }).key, 'cro-magnon-woman');
  assert.equal(
    characterModel({ species: 'cro', gender: 'female', character: '../x' }).key,
    'cro-magnon-woman',
  );
  // A profile whose species changed without its key follows the species.
  assert.equal(
    characterModel({ species: 'cro', gender: 'male', character: 'cro-magnon-girl-feather' }).key,
    'cro-magnon-hunter',
  );
});

test('new fantasy choices normalize to their one supplied appearance', () => {
  assert.equal(characterModel({ species: 'cat', gender: 'male' }).key, 'cat-kunoichi');
  const mage = characterModel({ species: 'bear' });
  assert.equal(mage.key, 'desert-fennec-mage');
  assert.equal(mage.weapon, 'magic');
  assert.equal(mage.walkSpeed, 1.2);
  assert.equal(mage.runSpeed, 3.8);
  assert.ok(mage.walkSpeed < WORLD.walkSpeed);
  assert.ok(mage.runSpeed < WORLD.runSpeed);
  assert.deepEqual(normalizeCharacter({ species: 'cat', gender: 'invalid' }), {
    species: 'cat',
    gender: 'female',
    character: 'cat-kunoichi',
  });
});

test('selection cards keep the species-gender value of the first look and key further looks', async () => {
  const { cardValue, characterValue, parseCharacterValue } =
    await import('../dist/src/character-selection.js');
  const value = (key) => cardValue(CHARACTER_MODELS.find((model) => model.key === key));
  assert.equal(value('cro-magnon-woman'), 'cro-female');
  assert.equal(value('cro-magnon-hunter'), 'cro-male');
  assert.equal(value('cro-magnon-girl-feather'), 'cro-magnon-girl-feather');
  for (const model of CHARACTER_MODELS) {
    const profile = parseCharacterValue(cardValue(model));
    assert.equal(characterModel(profile).key, model.key);
    assert.equal(characterValue(profile), cardValue(model));
  }
});
