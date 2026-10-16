/**
 * v3 (2026-10-16): start quietly until the visitor explicitly enables sound.
 * Preserve the calibrated v2 category levels, but its old default-on is not opt-in.
 * 100 % is the intended mix; the sliders only turn individual categories down.
 */
export const AUDIO_SETTINGS_KEY = 'cro-nature-audio-v3';
const PREVIOUS_SETTINGS_KEY = 'cro-nature-audio-v2';
export type AudioSettings = { enabled: boolean; ambience: number; music: number; effects: number };
export const DEFAULT_AUDIO: Readonly<AudioSettings> = Object.freeze({
  enabled: false,
  ambience: 1,
  music: 1,
  effects: 1,
});
export function normalizeAudioSettings(raw: unknown): AudioSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AudioSettings>) : {};
  const volume = (key: 'ambience' | 'music' | 'effects') =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? Math.max(0, Math.min(1, value[key]!))
      : DEFAULT_AUDIO[key];
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : DEFAULT_AUDIO.enabled,
    ambience: volume('ambience'),
    music: volume('music'),
    effects: volume('effects'),
  };
}
export function readAudioSettings() {
  try {
    const saved = localStorage.getItem(AUDIO_SETTINGS_KEY);
    if (saved) return normalizeAudioSettings(JSON.parse(saved));
    const previous = JSON.parse(localStorage.getItem(PREVIOUS_SETTINGS_KEY) || 'null');
    return normalizeAudioSettings({ ...previous, enabled: false });
  } catch {
    return { ...DEFAULT_AUDIO };
  }
}
export function saveAudioSettings(settings: AudioSettings) {
  try {
    localStorage.setItem(AUDIO_SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* This visit still works. */
  }
}
export function audioSettingsMarkup(settings: AudioSettings) {
  return (
    `<div class="settings-item"><strong>サウンド</strong><button class="button button-outline" data-setting="sound" aria-pressed="${settings.enabled}">${settings.enabled ? 'オン' : 'オフ'}</button></div>` +
    (['ambience', 'music', 'effects'] as const)
      .map(
        (key, index) =>
          `<div class="settings-item audio-volume"><label for="audio-${key}">${['環境音・鳥の声', '場所別BGM', '足音・動作・通知'][index]}</label><div class="audio-volume-control"><input id="audio-${key}" data-audio-volume="${key}" type="range" min="0" max="100" step="5" value="${Math.round(settings[key] * 100)}"><output for="audio-${key}">${Math.round(settings[key] * 100)}%</output></div></div>`,
      )
      .join('') +
    '<p class="form-note audio-status" data-audio-status role="status"></p>'
  );
}
