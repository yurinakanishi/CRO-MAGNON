import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_MODELS, normalizeCharacter, characterModel } from '../shared/characters.mjs';

test('new and legacy profiles default to female in either species', () => {
  assert.deepEqual(normalizeCharacter(), { species: 'cro', gender: 'female' });
  assert.equal(characterModel({ species: 'nea' }).key, 'neanderthal-woman');
  assert.equal(characterModel({ species: 'cro' }).key, 'cro-magnon-woman');
  assert.deepEqual(normalizeCharacter({ species: '<invalid>', gender: '../male' }), { species: 'cro', gender: 'female' });
});

test('all six explicit choices resolve to distinct models and retain male choices', () => {
  assert.equal(new Set(CHARACTER_MODELS.map(model => model.key)).size, 6);
  for (const model of CHARACTER_MODELS) assert.equal(characterModel(model).key, model.key);
  assert.equal(characterModel({ species: 'nea', gender: 'male' }).key, 'neanderthal-hunter');
});

test('new fantasy choices normalize to their one supplied appearance', () => {
  assert.equal(characterModel({species:'cat',gender:'male'}).key,'cat-kunoichi');
  assert.equal(characterModel({species:'bear'}).key,'floppy-ear-mage');
  assert.equal(characterModel({species:'bear'}).weapon,'magic');
  assert.deepEqual(normalizeCharacter({species:'cat',gender:'invalid'}),{species:'cat',gender:'female'});
});
