import type * as Archive from './gulf-archive.mjs';

// The Pacific fantasy island was removed at the user's request (2026-09-22).
// Old definitions remain only for save migration and stable scenery placement.
import { GULF as ARCHIVED_GULF } from './gulf-archive.mjs';
export { MANY_HEARTHS, GULF_ENTRY } from './gulf-archive.mjs';
export const GULF = Object.freeze({ ...ARCHIVED_GULF, version: 3 });
export const COUNTRIES: typeof Archive.COUNTRIES = Object.freeze([]);
export const SETTLEMENTS: typeof Archive.SETTLEMENTS = [];
export const GULF_STOPS: typeof Archive.GULF_STOPS = [];
export const GULF_SPINE: typeof Archive.GULF_SPINE = [];
export const SPRINGS: typeof Archive.SPRINGS = [];
export const LANDINGS: typeof Archive.LANDINGS = [];
export const FARM_PLOTS: typeof Archive.FARM_PLOTS = [];
export const GULF_RESOURCES: typeof Archive.GULF_RESOURCES = [];
export const OBSIDIAN_OUTCROPS: typeof Archive.OBSIDIAN_OUTCROPS = [];
export const GULF_SCENERY: typeof Archive.GULF_SCENERY = { trees: [], props: [], fires: [] };
export const GULF_WAYPOINTS: typeof Archive.GULF_WAYPOINTS = [];
export const GULF_LANDMARKS: typeof Archive.GULF_LANDMARKS = [];
export const inGulf = (_x: number, _z: number, _margin = 0) => false;
export const gulfLandDistance = (_x: number, _z: number) => -Infinity;
export const gulfActivitySpace = (_x: number, _z: number) => false;
