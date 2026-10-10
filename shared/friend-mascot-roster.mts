import type { Point } from './types.mjs';

// The companion definitions alone, without the world rules that use them, so the
// title's contributor credits read them without loading the world's data.

export interface FriendMascotDefinition {
  /** Model key under public/models, also the mascot selection key. */
  key: string;
  /** Contributor key (the credit's `qr` id) whose character this is. */
  credit: string;
  name: string;
  /** Offset from the first camp fire: open ground with a clear view of the fire,
   * at least 1.3 m from every other camp companion (output of a collision sweep). */
  home: Point;
  radius: number;
  bodyHeight: number;
  /** Height of the rigged PetContact socket. */
  headHeight: number;
  /** Selection card accent. */
  color: string;
  /** Reuse the original human rig's head and clips without changing the GLB. */
  contactBone?: string;
  reactions?: { pet: string; happy: string; hit: string; bow: string };
  equipment?: { key: string; grip: string };
}

/**
 * Contributors' companions. They share one behaviour: petting starts the bond,
 * they follow their person, recoil when struck and walk home when dismissed.
 * Heights come from each adopted model's rig record (asset.json).
 */
export const FRIEND_MASCOTS: readonly FriendMascotDefinition[] = Object.freeze([
  {
    key: 'saber-mascot',
    credit: 'saber',
    name: 'Saber',
    home: { x: 3.13, z: -0.67 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.494,
    color: '#f1d27a',
  },
  {
    key: 'fairy-mascot',
    credit: 'fairy',
    name: 'フェアリー',
    home: { x: 1.75, z: -3.03 },
    radius: 0.22,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#cdb6e6',
  },
  {
    key: 'sagasa-mascot',
    credit: 'sagasa',
    name: 'さが',
    home: { x: -1.67, z: -3.75 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.498,
    color: '#5d7fd0',
  },
  {
    key: 'nukonuko-mascot',
    credit: 'nukonuko',
    name: 'ぬこぬこ',
    home: { x: 3.56, z: -2.59 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.477,
    color: '#b88a63',
  },
  {
    key: 'otani-mascot',
    credit: 'otani',
    name: 'オータニ',
    home: { x: -2.25, z: 1.3 },
    radius: 0.25,
    bodyHeight: 0.52,
    headHeight: 0.487,
    color: '#7fc46a',
  },
  {
    key: 'urata-mascot',
    credit: 'urata',
    name: 'うらた',
    home: { x: 2.41, z: 3.32 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#7d7a76',
  },
  {
    key: 'rei-mascot',
    credit: 'asahina',
    name: '怜ちゃん',
    home: { x: 0, z: 4.1 },
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#ff8c00',
  },
  {
    key: 'howkey-scientist',
    credit: 'hawkie',
    name: 'Howkey',
    home: { x: -4.4, z: 1.6 },
    radius: 0.32,
    bodyHeight: 1.55,
    headHeight: 1.34075,
    color: '#b5cec2',
    contactBone: 'Head',
    reactions: { pet: 'Idle_Loop', happy: 'Wave', hit: 'Idle_Loop', bow: 'Wave' },
    equipment: { key: 'howkey-flask', grip: 'Grip.R' },
  },
]);
