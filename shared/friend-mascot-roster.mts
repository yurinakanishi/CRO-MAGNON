// The companion definitions alone, without the world rules that use them, so the
// title's contributor credits read them without loading the world's data.

export interface FriendMascotDefinition {
  /** Model key under public/models, also the mascot selection key. */
  key: string;
  /** Contributor key (the credit's `qr` id) whose character this is. */
  credit: string;
  name: string;
  radius: number;
  bodyHeight: number;
  /** Height of the rigged PetContact socket. */
  headHeight: number;
  /** Selection card accent. */
  color: string;
  /** Selection card picture, when it is not the model folder's portrait.png. */
  portrait?: string;
  /** Distance kept from the person while walking (FRIEND_TIMING.followDistance otherwise). */
  followDistance?: number;
  /** Drawn speed (m/s) above which the run clip plays. */
  runSpeed?: number;
  /** False for a skin without the idle wave and bow. */
  gestures?: boolean;
  /** Reuse the original human rig's head and clips without changing the GLB. */
  contactBone?: string;
  reactions?: { pet: string; happy: string; hit: string; bow: string };
  equipment?: { key: string; grip: string };
}

/**
 * Contributors' companions. They share one behaviour with every walking mascot: a
 * player chooses one to walk beside them; petting only makes it happy, a blow makes
 * it recoil, and it waves goodbye when dismissed.
 * Heights come from each adopted model's rig record (asset.json).
 */
export const FRIEND_MASCOTS: readonly FriendMascotDefinition[] = Object.freeze([
  {
    key: 'saber-mascot',
    credit: 'saber',
    name: 'Saber',
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.494,
    color: '#f1d27a',
  },
  {
    key: 'fairy-mascot',
    credit: 'fairy',
    name: 'フェアリー',
    radius: 0.22,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#cdb6e6',
  },
  {
    key: 'sagasa-mascot',
    credit: 'sagasa',
    name: 'さが',
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.498,
    color: '#5d7fd0',
  },
  {
    key: 'nukonuko-mascot',
    credit: 'nukonuko',
    name: 'ぬこぬこ',
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.477,
    color: '#b88a63',
  },
  {
    key: 'otani-mascot',
    credit: 'otani',
    name: 'オータニ',
    radius: 0.25,
    bodyHeight: 0.52,
    headHeight: 0.487,
    color: '#7fc46a',
  },
  {
    key: 'urata-mascot',
    credit: 'urata',
    name: 'うらた',
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#7d7a76',
  },
  {
    key: 'rei-mascot',
    credit: 'asahina',
    name: '怜ちゃん',
    radius: 0.24,
    bodyHeight: 0.52,
    headHeight: 0.508,
    color: '#ff8c00',
  },
  {
    key: 'howkey-scientist',
    credit: 'hawkie',
    name: 'Howkey',
    radius: 0.32,
    bodyHeight: 1.55,
    headHeight: 1.34075,
    color: '#b5cec2',
    contactBone: 'Head',
    reactions: { pet: 'Idle_Loop', happy: 'Wave', hit: 'Idle_Loop', bow: 'Wave' },
    equipment: { key: 'howkey-flask', grip: 'Grip.R' },
  },
]);

/**
 * The camp's first mascots walk and react exactly like the friends. They are kept
 * apart from FRIEND_MASCOTS only because the title credits them differently.
 */
export const FIRST_MASCOTS: readonly FriendMascotDefinition[] = Object.freeze([
  {
    key: 'mae',
    credit: 'mae',
    name: 'mae',
    radius: 0.25,
    bodyHeight: 0.38,
    headHeight: 0.37,
    color: '#e4e5de',
    followDistance: 1.85,
    runSpeed: 1.1,
    gestures: false,
  },
  {
    key: 'kohaku',
    credit: 'risa',
    name: 'こはくちゃん',
    radius: 0.22,
    bodyHeight: 0.5199786842176763,
    headHeight: 0.5010582804679871,
    color: '#e9cfae',
    portrait: '/models/kohaku/portrait-r05.png',
  },
  {
    key: 'maruimo-mascot',
    credit: 'maruimo',
    name: 'まるぃも',
    radius: 0.27,
    bodyHeight: 0.55,
    headHeight: 0.5335,
    color: '#ae6558',
    reactions: { pet: 'Idle_Loop', happy: 'Wave', hit: 'Idle_Loop', bow: 'Wave' },
  },
]);

/** Every walking mascot, in selection card order. */
export const GROUND_MASCOTS: readonly FriendMascotDefinition[] = Object.freeze([
  ...FIRST_MASCOTS,
  ...FRIEND_MASCOTS,
]);
