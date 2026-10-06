import type { BrowserBuildProfile } from '../shared/environment-profile.mjs';

/** Ordinary development output stays local; release builders emit their own value. */
export const BUILD_PROFILE: Readonly<BrowserBuildProfile> = Object.freeze({
  environment: 'local',
  cameraControls: true,
  builtAt: null,
});
