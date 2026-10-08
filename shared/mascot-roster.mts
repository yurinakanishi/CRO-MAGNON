/** Retained cast. Turn on an entry to restore its 3D model and guest credit.
 * Dots are always available; cave paintings are independent of this roster. */
export const MASCOT_ROSTER = [
  { modelKey: 'rimo-neko', credit: 'rimo', enabled: true },
  { modelKey: 'yellow-524-mascot', credit: 'r524', enabled: true },
  { modelKey: 'mae', credit: 'mae', enabled: false },
  { modelKey: 'kohaku', credit: 'risa', enabled: false },
  { modelKey: 'maruimo-mascot', credit: 'maruimo', enabled: false },
  { modelKey: 'saber-mascot', credit: 'saber', enabled: false },
  { modelKey: 'fairy-mascot', credit: 'fairy', enabled: false },
  { modelKey: 'sagasa-mascot', credit: 'sagasa', enabled: false },
  { modelKey: 'nukonuko-mascot', credit: 'nukonuko', enabled: false },
  { modelKey: 'otani-mascot', credit: 'otani', enabled: false },
  { modelKey: 'urata-mascot', credit: 'urata', enabled: false },
  { modelKey: 'rei-mascot', credit: 'asahina', enabled: false },
  { modelKey: 'howkey-scientist', credit: 'hawkie', enabled: false },
] as const;

export const ACTIVE_MASCOT_MODELS: readonly string[] = Object.freeze(
  MASCOT_ROSTER.filter((entry) => entry.enabled).map((entry) => entry.modelKey),
);
export const ALL_MASCOT_MODELS: readonly string[] = Object.freeze(
  MASCOT_ROSTER.map((entry) => entry.modelKey),
);

/** Unknown keys are ordinary world assets, including Dots and the mural cave. */
export function mascotModelReleased(modelKey: string): boolean {
  if (modelKey === 'howkey-flask') return ACTIVE_MASCOT_MODELS.includes('howkey-scientist');
  return !ALL_MASCOT_MODELS.includes(modelKey) || ACTIVE_MASCOT_MODELS.includes(modelKey);
}

export function mascotCreditReleased(credit: string): boolean {
  return MASCOT_ROSTER.some((entry) => entry.credit === credit && entry.enabled);
}

/** Adopt the retained rig as a companion without modifying its accepted GLB. */
export function mascotAsset<T extends { modelKey: string }>(asset: T): T {
  return ALL_MASCOT_MODELS.includes(asset.modelKey) ? { ...asset, kind: 'companion' } : asset;
}
