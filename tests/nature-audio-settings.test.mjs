import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIO_SETTINGS_KEY,
  DEFAULT_AUDIO,
  normalizeAudioSettings,
  readAudioSettings,
  saveAudioSettings,
} from '../dist/src/nature-audio-settings.js';

function storage(t, initial = {}) {
  const original = globalThis.localStorage;
  const values = new Map(Object.entries(initial));
  globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  t.after(() => {
    if (original === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = original;
  });
  return values;
}

test('new or corrupt sound preferences start muted with usable category levels', (t) => {
  const values = storage(t);
  assert.equal(DEFAULT_AUDIO.enabled, false);
  assert.deepEqual(readAudioSettings(), { enabled: false, ambience: 1, music: 1, effects: 1 });
  for (const raw of ['{', 'null', 'true', '{"enabled":"yes"}']) {
    values.set(AUDIO_SETTINGS_KEY, raw);
    assert.deepEqual(readAudioSettings(), DEFAULT_AUDIO);
  }
  assert.equal(normalizeAudioSettings({}).enabled, false);
});

test('the earlier default-on does not opt in, while calibrated category levels survive', (t) => {
  storage(t, {
    'cro-nature-audio-v1': JSON.stringify({ enabled: true, effects: 0.5 }),
    'cro-nature-audio-v2': JSON.stringify({ enabled: true, ambience: 0.4, music: 0, effects: 0.7 }),
  });
  assert.deepEqual(readAudioSettings(), { enabled: false, ambience: 0.4, music: 0, effects: 0.7 });
});

test('an explicit on/off choice persists independently of the category mix', (t) => {
  storage(t);
  const on = { enabled: true, ambience: 0.6, music: 0.8, effects: 0.5 };
  saveAudioSettings(on);
  assert.deepEqual(readAudioSettings(), on);
  saveAudioSettings({ ...on, enabled: false });
  assert.deepEqual(readAudioSettings(), { ...on, enabled: false });
});

test('unavailable browser storage still starts muted', (t) => {
  storage(t);
  localStorage.getItem = () => {
    throw Error('unavailable');
  };
  localStorage.setItem = () => {
    throw Error('unavailable');
  };
  assert.deepEqual(readAudioSettings(), DEFAULT_AUDIO);
  assert.doesNotThrow(() => saveAudioSettings({ ...DEFAULT_AUDIO, enabled: true }));
});
