export const AUDIO_SETTINGS_KEY = 'cro-nature-audio-v1';
export type AudioSettings = { enabled: boolean; ambience: number; music: number };
export const DEFAULT_AUDIO: Readonly<AudioSettings> = Object.freeze({
  enabled: true,
  ambience: 0.7,
  music: 0.3,
});
export function normalizeAudioSettings(raw: unknown): AudioSettings {
  const value = raw && typeof raw === 'object' ? (raw as Partial<AudioSettings>) : {};
  const volume = (key: 'ambience' | 'music') =>
    typeof value[key] === 'number' && Number.isFinite(value[key])
      ? Math.max(0, Math.min(1, value[key]!))
      : DEFAULT_AUDIO[key];
  return {
    enabled: typeof value.enabled === 'boolean' ? value.enabled : true,
    ambience: volume('ambience'),
    music: volume('music'),
  };
}
export function readAudioSettings() {
  try {
    return normalizeAudioSettings(JSON.parse(localStorage.getItem(AUDIO_SETTINGS_KEY) || 'null'));
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
    (['ambience', 'music'] as const)
      .map(
        (key, index) =>
          `<div class="settings-item audio-volume"><label for="audio-${key}">${['環境音・鳥の声', '場所別BGM'][index]}</label><div class="audio-volume-control"><input id="audio-${key}" data-audio-volume="${key}" type="range" min="0" max="100" step="5" value="${Math.round(settings[key] * 100)}"><output for="audio-${key}">${Math.round(settings[key] * 100)}%</output></div></div>`,
      )
      .join('') +
    '<p class="form-note audio-status" data-audio-status role="status"></p>'
  );
}
