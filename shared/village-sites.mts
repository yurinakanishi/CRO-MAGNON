import { SETTLEMENTS } from './gulf-region.mjs';
import type { ResidentDefinition, ResidentRoutine } from './village-types.mjs';

// Authored people and customs, not reconstructed Paleolithic names or institutions.
export const VILLAGE = Object.freeze({ dayMs: 240000, reach: 3.2, walkSpeed: 1, talkMs: 20000 });
export const DAY_PHASES = ['朝の仕事', '昼の仕事', '炉を囲む夕べ', '天幕での休息'];
export const villageDay = (now: number, createdAt: number) =>
  1 + Math.floor(Math.max(0, now - createdAt) / VILLAGE.dayMs);
export const villagePhase = (now: number, createdAt: number) =>
  Math.floor((Math.max(0, now - createdAt) % VILLAGE.dayMs) / (VILLAGE.dayMs / 4));
export const ITEM_NAMES = {
  wood: '木材',
  stone: '石',
  berry: 'ベリー',
  water: '水',
  seed: '種',
  obsidian: '黒曜石',
  cookedShellfish: '焼いた貝',
  cookedFish: '焼き魚',
  shells: '貝殻',
};
export const bundleLabel = (items: Record<string, number>) =>
  Object.entries(items)
    .map(([key, n]) => `${ITEM_NAMES[key] ?? key}${n}`)
    .join('・');

function routine(settlementId: string, second: boolean, work: string): ResidentRoutine[] {
  const s = SETTLEMENTS.find((item) => item.id === settlementId)!;
  const points: [number, number, string, ResidentRoutine['clip'], number][] = second
    ? [
        [-22, 19, '薪を選んでいる', 'Gather', 0],
        [12, 5.5, work, 'Craft', 0],
        [7, 5, '炉のそばで話している', 'Idle_Loop', 0],
        [4, -29, '天幕のそばで休んでいる', 'Idle_Loop', Math.PI],
      ]
    : [
        [-23, -17, '食べられる実を選んでいる', 'Gather', Math.PI],
        [14, -7, work, 'Gather', Math.PI / 2],
        [-4, 2, '炉のそばで話している', 'Idle_Loop', Math.PI / 2],
        [-14, -26, '天幕のそばで休んでいる', 'Idle_Loop', Math.PI],
      ];
  return points.map(([x, z, label, clip, facing]) => ({
    x: s.x + x,
    z: s.z + z,
    label,
    clip,
    facing,
  }));
}

const people: Omit<ResidentDefinition, 'routine'>[] = [
  {
    id: 'aru',
    name: 'アル',
    settlementId: 'many-hearths',
    species: 'cro',
    gender: 'female',
    introduction:
      'ここでは、違う国から来た人も炉を囲める。私も実を集め、畑を見て、旅人を迎えるよ。気まずいことがあったら、まず座って話そう。',
    request: '今夜来る旅人に分けるベリーを2つ、持ってきてくれる？ 道で使える薪を分けるよ。',
    thanks: 'これで遅く着いた人にも一口分あるね。また炉を囲もう。',
    cost: { berry: 2 },
    reward: { wood: 2 },
  },
  {
    id: 'seno',
    name: 'セノ',
    settlementId: 'many-hearths',
    species: 'nea',
    gender: 'male',
    introduction:
      '天幕を直す手も、実を探す足も、ここでは役に立つ。大きな炉は誰か一人の家ではないんだ。私は道具の手入れをしながら留守を見ている。',
    request: '集まりの炉に使う木材が2つほしい。採っておいたベリー3つをお礼にしよう。',
    thanks: 'ありがとう。炉の火を絶やさずに済む。次に来た人にも場所を空けておこう。',
    cost: { wood: 2 },
    reward: { berry: 3 },
  },
  {
    id: 'mira',
    name: 'ミラ',
    settlementId: 'long-valley',
    species: 'nea',
    gender: 'female',
    introduction:
      '長い谷では、実を採る場所と畑をどちらも見て回る。初めの収穫から種を分け合うのが私たちの習わし。狩りに出る日にも、帰れる畑を残しておくんだ。',
    request: '泉から水を2回分、運んでくれる？ 次に植えられる種を2つ分けよう。',
    thanks: '水をありがとう。この種を、好きな集落の共同の畑に植えてね。',
    cost: { water: 2 },
    reward: { seed: 2 },
  },
  {
    id: 'tovan',
    name: 'トヴァン',
    settlementId: 'long-valley',
    species: 'cro',
    gender: 'male',
    introduction:
      '谷道を歩くときは、木の実と獲物の足跡を一緒に探す。石器も自分たちで直すよ。白い尾根へ行けば、違う削り方を教わることもある。',
    request: '道を見に出るので、ベリーを2つもらえるかな。手持ちの石2つなら分けられる。',
    thanks: '助かる。水辺が遠回りでも、谷の道でみんなの炉へ帰れるよ。',
    cost: { berry: 2 },
    reward: { stone: 2 },
  },
  {
    id: 'ena',
    name: 'エナ',
    settlementId: 'pale-ridge',
    species: 'cro',
    gender: 'female',
    introduction:
      '白い尾根には使える石がある。でも石だけでは暮らせない。私は畑と木の実を見て、夕べには削り方を隣の人と見せ合うんだ。',
    request: '黒曜石を1つ持ってきて。削る練習に使いたい。集めた木材3つをお礼にするよ。',
    thanks: 'この原石をよく見てから削ろう。刃を作るなら、あそこの石器作業場が使えるよ。',
    cost: { obsidian: 1 },
    reward: { wood: 3 },
  },
  {
    id: 'rok',
    name: 'ロク',
    settlementId: 'pale-ridge',
    species: 'nea',
    gender: 'male',
    introduction:
      '作業場では、手元を見せ合うのが好きだ。採集も狩りも畑もあるから、同じ道具ばかりは作らない。どの国の人でも、よい工夫は覚えておきたいね。',
    request: '修繕用の木材を2つ頼めるかな。形を選んだ石3つと交換しよう。',
    thanks: 'これで柄の修繕ができる。黒曜石の刃を木槍につけるときにも、木材を残しておこう。',
    cost: { wood: 2 },
    reward: { stone: 3 },
  },
  {
    id: 'neri',
    name: 'ネリ',
    settlementId: 'reed-shore',
    species: 'nea',
    gender: 'female',
    introduction:
      '葦の岸では、帰れる浜を確かめてから出かける。貝と魚ばかりでなく、実も採るし畑も育てるよ。食べた殻は貝塚へ持ち帰って、通り道を空けよう。',
    request: '焼いた貝を1つ、分けてくれる？ 畑の種2つと、食べ終えた殻を返すね。',
    thanks: 'ごちそうさま。殻は集落の貝塚に積もう。種は次の食事を育てるために。',
    cost: { cookedShellfish: 1 },
    reward: { seed: 2, shells: 1 },
  },
  {
    id: 'daro',
    name: 'ダロ',
    settlementId: 'reed-shore',
    species: 'cro',
    gender: 'male',
    introduction:
      '浜へ行く前に、道具を直して薪も選ぶ。渡るのをやめたい日は湾の頭を回って歩けばいい。私たちの道は、船だけに頼っていないんだ。',
    request: '浜へ運ぶ修繕用の木材2つを頼める？ 採ってきたベリー3つを分けよう。',
    thanks: 'ありがとう。出かけるときも、戻る岸と食べ物のことを忘れずに。',
    cost: { wood: 2 },
    reward: { berry: 3 },
  },
];
const work = [
  '共同の畑を見ている',
  '旅の道具を直している',
  '畑の手入れをしている',
  '狩りの道具を直している',
  '共同の畑を見ている',
  '石器を手入れしている',
  '畑の手入れをしている',
  '浜で使う道具を直している',
];
export const RESIDENTS: ResidentDefinition[] = people.map((p, i) => ({
  ...p,
  routine: routine(p.settlementId, i % 2 === 1, work[i]),
}));
