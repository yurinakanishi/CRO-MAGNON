import { CAMP_CAVE } from './camp-cave-layout.mjs';
import { CAMP_CAVE_SURFACE_DATA } from './camp-cave-surface-data.mjs';
import { measuredWalkSurface } from './measured-walk-surface.mjs';
export const CAMP_CAVE_SURFACE = measuredWalkSurface(CAMP_CAVE_SURFACE_DATA, CAMP_CAVE);
