import { BEHEMOTH_GROUND } from './behemoth-rules.mjs';
import { CAMP_CAVE } from './camp-cave-layout.mjs';
import { CASTLE_GATE } from './castle-layout.mjs';
import { SABERTOOTH_GROUND } from './sabertooth-rules.mjs';
import { HUNTING_GROUNDS } from './scenery-layout.mjs';

// Where a title start may set the traveller down. A short exhibition visit
// cannot cross the valley, so each visitor picks the sight they want to stand
// in front of. `look` is what the traveller (and the camera) faces on arrival;
// the beasts' spots lie just outside their territory so nobody arrives mid-pounce.
export type SpawnSite = {
  id: string;
  name: string;
  blurb: string;
  x: number;
  z: number;
  look: { x: number; z: number };
};
const site = (id, name, blurb, x, z, look): SpawnSite =>
  Object.freeze({ id, name, blurb, x, z, look: Object.freeze({ x: look.x, z: look.z }) });

export const CAMP_SPAWN = site(
  'camp',
  '拠点の焚き火',
  '仲間と524がいる、はじまりの野営地',
  48,
  57,
  {
    x: 50,
    z: 50,
  },
);
export const SPAWN_SITES: readonly SpawnSite[] = Object.freeze([
  CAMP_SPAWN,
  site('mammoth', 'マンモスの草原', '背中に乗れる大きなマンモス', 33, 32, HUNTING_GROUNDS[0]),
  site('sabertooth', '剣牙の雪原', '飛びかかってくる剣牙の大虎', 77, -4, SABERTOOTH_GROUND),
  site('behemoth', '紫尾の沼地', '毒を吐く紫尾の巨獣', 79, 62, BEHEMOTH_GROUND),
  site(
    'castle',
    '白羽教団の大聖城',
    'カラスの僧が守る石の城',
    CASTLE_GATE.x,
    CASTLE_GATE.z - 12,
    CASTLE_GATE,
  ),
  site('cave', '壁画の洞窟', '奥に壁画がねむる洞窟', CAMP_CAVE.x + 1, CAMP_CAVE.z - 10, CAMP_CAVE),
]);

export const spawnSite = (id: unknown): SpawnSite =>
  SPAWN_SITES.find((entry) => entry.id === id) ?? CAMP_SPAWN;
export const spawnFacing = (from: { x: number; z: number }, entry: SpawnSite) =>
  Math.atan2(entry.look.x - from.x, entry.look.z - from.z);
