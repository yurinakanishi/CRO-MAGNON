export const WORLD = Object.freeze({ size: 100, speed: 8, maxPlayers: 5 });

export const CAMP = Object.freeze({
  x: 50, z: 50, wood: 0, stone: 0, level: 0, goalWood: 12, goalStone: 6,
});

export const NPC = Object.freeze({
  x: 70, z: 41, name: 'オル', species: 'nea',
  greeting: '火は、ひとりでは守れない。木か石を2つ、ベリー3つと交換しよう。',
});

const nodes = [
  ['wood', 56, 62, 7], ['wood', 62, 66, 7], ['wood', 68, 58, 6],
  ['wood', 30, 54, 7], ['wood', 26, 60, 6], ['wood', 25, 42, 8],
  ['wood', 32, 32, 6], ['wood', 39, 23, 7], ['wood', 57, 24, 7],
  ['wood', 77, 29, 6], ['wood', 82, 54, 8], ['wood', 68, 79, 6],
  ['wood', 39, 77, 7], ['wood', 17, 75, 8], ['wood', 86, 75, 7],
  ['stone', 43, 63, 6], ['stone', 37, 60, 6], ['stone', 60, 37, 7],
  ['stone', 20, 33, 8], ['stone', 79, 68, 6], ['stone', 52, 83, 7],
  ['stone', 82, 19, 8], ['stone', 16, 51, 6],
  ['berry', 60, 53, 5], ['berry', 40, 41, 5], ['berry', 32, 69, 5],
  ['berry', 72, 49, 5], ['berry', 49, 28, 5], ['berry', 78, 83, 5],
];

export const INITIAL_RESOURCES = Object.freeze(nodes.map(([type, x, z, amount], index) =>
  Object.freeze({ id: `${type}-${index + 1}`, type, x, z, amount, maxAmount: amount }),
));
