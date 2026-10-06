export type EnvironmentId = 'local' | 'exhibition' | 'mmo';

/** Release capabilities are selected by the builder, never by a player or URL. */
export const ENVIRONMENTS = Object.freeze({
  local: Object.freeze({
    id: 'local' as const,
    cameraControls: true,
    port: 3100,
    room: 'LOCAL_VERIFY',
    storage: '.cro-magnon-save/environments/local',
  }),
  exhibition: Object.freeze({
    id: 'exhibition' as const,
    cameraControls: true,
    port: 4173,
    room: 'EXHIBITION',
    storage: null,
  }),
  mmo: Object.freeze({
    id: 'mmo' as const,
    cameraControls: false,
    port: 8787,
    room: 'EMBER',
    storage: '.wrangler/state/mmo',
  }),
});

export function environmentProfile(id: string) {
  if (!Object.hasOwn(ENVIRONMENTS, id)) throw new Error(`Unknown game environment: ${id}`);
  return ENVIRONMENTS[id as EnvironmentId];
}

export interface BrowserBuildProfile {
  environment: EnvironmentId;
  cameraControls: boolean;
  builtAt: string | null;
}
