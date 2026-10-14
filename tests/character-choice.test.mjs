import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { characterChoiceChange } from '../dist/src/character-switch-ui.js';
import { dyePickerMarkup } from '../dist/src/dye-picker.js';

const worn = (character, dye = '') => ({ character, dye });

test('the character and colour already worn are no change, so picking them asks nothing', () => {
  assert.equal(
    characterChoiceChange(worn('cro-female'), { character: 'cro-female', dye: '' }),
    null,
  );
  assert.equal(
    characterChoiceChange(worn('cro-female', 'red'), { character: 'cro-female', dye: 'red' }),
    null,
  );
});

test('the same character in another colour is a change of colour alone', () => {
  assert.deepEqual(
    characterChoiceChange(worn('cro-female'), { character: 'cro-female', dye: 'red' }),
    { character: false, dye: true },
  );
  // Back to the character's own colours is a colour too.
  assert.deepEqual(
    characterChoiceChange(worn('cro-female', 'red'), { character: 'cro-female', dye: '' }),
    { character: false, dye: true },
  );
});

test('another character is a change, of its colour too when another one is picked with it', () => {
  assert.deepEqual(
    characterChoiceChange(worn('cro-female'), { character: 'cat-female', dye: '' }),
    { character: true, dye: false },
  );
  assert.deepEqual(
    characterChoiceChange(worn('cro-female'), { character: 'cat-female', dye: 'blue' }),
    { character: true, dye: true },
  );
});

test('where no colours are offered (the exhibition), only the character counts', () => {
  assert.equal(
    characterChoiceChange(worn('cro-female', 'red'), { character: 'cro-female', dye: null }),
    null,
  );
  assert.deepEqual(
    characterChoiceChange(worn('cro-female', 'red'), { character: 'cat-female', dye: null }),
    { character: true, dye: false },
  );
});

test('the swatches beside the cards only pick; those in the players list dye at once', () => {
  assert.match(
    dyePickerMarkup('red', { choice: true }),
    /^<fieldset class="dye-picker" data-dye-choice>/,
  );
  assert.doesNotMatch(dyePickerMarkup('red'), /data-dye-choice/);
});

test('the menu shows the character as a tab, with no その他 tab and no 探索に戻る action', async () => {
  const main = await readFile(new URL('../src/main.ts', import.meta.url), 'utf8');
  assert.match(
    main,
    /\['mascots', 'people', '連れていく仲間'\],\s*\['character', 'person', 'キャラクターを変える'\],\s*\['settings', 'gear', '設定'\],/,
  );
  assert.doesNotMatch(
    main,
    /'その他'|'探索に戻る', \(\) =>|pause-tab-more|openCharacterSwitchMenu/,
  );
  assert.match(main, /<h2>キャラクターを選ぶ<\/h2>/);
});
