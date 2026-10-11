import { CASTLE } from './castle-layout.mjs';
import { CASTLE_SURFACE_DATA } from './castle-surface-baked.mjs';
import { measuredWalkSurface } from './measured-walk-surface.mjs';
export const CASTLE_SURFACE = measuredWalkSurface(CASTLE_SURFACE_DATA, CASTLE);
