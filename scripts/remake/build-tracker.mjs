// Builds assets/asset-remake/tracker.json + docs/asset-remake/INVENTORY.md from the delivery
// manifests (current state) and assets/asset-remake/status.json (hand-maintained progress).
// Usage: node scripts/remake/build-tracker.mjs
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../..');
const read = (p) => JSON.parse(readFileSync(path.join(root, p), 'utf8'));
const world = read('public/models/world-assets.json').assets;
const characterKeys = [
  'cro-magnon-woman', 'cro-magnon-hunter', 'neanderthal-woman', 'neanderthal-hunter', 'cat-kunoichi',
  'desert-fennec-mage', 'giant-ape', 'howkey-scientist', 'maruimo-octopus',
];
const characters = characterKeys.map((k) => ({ ...read(`public/models/${k}/asset.json`), modelKey: k, kind: 'player' }));

// Where each asset is used (from the 2026-10-07 code inventory) and what derived data depends on it.
const USAGE = {
  player: 'src/character-assets.ts → world3d.loadHuman / npc オル (nea male) / village-renderer residents; character-animation.ts clips; Grip.R/L weapons; riding-pose.ts / carry poses',
  'woolly-mammoth': 'world-scenery.ts:376 createAnimal; shared/animals.mts; riding seat on Spine (riding-pose.ts:6); model-bounds.mts radius; hunting Death→meat',
  'crow-shaman': 'world3d.loadEnemy → createEnemy; crow-faction-visuals.ts props on Staff/Head/Chest/HandL; 28 castle crows',
  'sabertooth-tiger': 'world3d.loadEnemy; enemy-state.ts SABERTOOTH_CLIPS; sabertooth-rules timings',
  'violet-behemoth': 'world3d.loadEnemy; BEHEMOTH_CLIPS + BEHEMOTH_CLIP_TIMING; behemoth-mouth.mts Head/Jaw sockets',
  'yellow-524-mascot': 'companion-524-renderer.ts; companion-524.mts radius/scale; heart sprites; PetContact',
  'rimo-neko': 'rimo-neko-renderer; Pet/Happy/Hit/Hiss/Held/Thrown/Catch/Land clips; PetContact',
  mae: 'mae renderer; Pet/Happy/Held/Thrown/Catch/Land',
  kohaku: 'kohaku renderer; Pet/Happy/Wave/Bow',
  'maruimo-mascot': 'maruimo-mascot renderer; 13 clips',
  'orb-bot': 'orb-bot-renderer.ts:59 `orb-bot-${kind}`; Held/Thrown/Catch/Land; 45 instances in a full room',
  equipment: 'world3d.ts:1007-1026 attackProfile().modelKey / stone-axe; spear-pose.ts / katana-pose.ts orientation',
  'flint-spear': 'model-review.ts only (legacy; not equipped in game)',
  terrain: 'open-world.ts:161 instanced 32 m tiles; placement.surfaceHeightMetres; river-bank-builder / source-surface-fit',
  'river-water': 'world-scenery rivers/marsh, mountain-river, mountain-lake, EarthOcean (paleo-materials), springs',
  'valley-pine': 'LandscapeInstances (3 levels incl. impostor); model-bounds pine + trunk',
  'meadow-grass': 'LandscapeInstances; crops recolour; cut-grass-root revision', 'meadow-sprig': 'LandscapeInstances',
  'valley-boulder': 'LandscapeInstances; stone-pile-layout (fixed 0.22 scale); gulf farm-plot markers; model-bounds',
  'firewood-log': 'wood-pile.ts instanced logs; wood-pile-layout collision from GLB dims',
  'firewood-pile': 'camp scenery; model-bounds', 'berry-bush': 'resource LOD; berry spheres sampled from GLB vertices',
  'hide-tent': 'camp scenery (world-scenery camp :309); model-bounds tent', 'drying-rack': 'camp scenery; model-bounds rack',
  'stone-firepit': 'camp + village fires; model-bounds firepit; fire particles', 'wood-footbridge': 'world-scenery bridges; placement.deckHeightMetres/walkBounds; model-bounds bridge',
  'mammoth-meat': 'world-scenery.ts:360 meat ring after Death', 'dugout-canoe': 'boat-renderer.ts:20; riders seated',
  'cockle-shell': 'coastal-renderer.ts:43 instanced', 'shell-midden': 'coastal-renderer middens (3 growth stages)',
  'obsidian-blade': 'coastal-renderer / inventory item', 'valley-castle': 'world-landmarks; castle-surface-data walk atlas (SHA-pinned); camera rays',
  'camp-cave': 'world-landmarks; camp-cave-surface-data (SHA-pinned); cave murals projected (cave-gallery-layout); tests pin SHA',
  'camp-mountain': 'world-landmarks; camp-mountain-surface-data; mammoth-navigation; mountain-materials offsets',
  'glacier-spires': 'regional landmarks; landmark-bounds.mts', 'volcanic-cone': 'regional landmarks; landmark-bounds.mts',
  'volcanic-basalt-columns': 'regional scenery; region-feature-bounds.mts', 'desert-cactus': 'regional scenery; region-feature-bounds.mts',
};
const DERIVED = {
  'woolly-mammoth': ['shared/model-bounds.mts'], 'hide-tent': ['shared/model-bounds.mts'], 'valley-boulder': ['shared/model-bounds.mts'],
  'valley-pine': ['shared/model-bounds.mts'], 'firewood-pile': ['shared/model-bounds.mts'], 'drying-rack': ['shared/model-bounds.mts'],
  'stone-firepit': ['shared/model-bounds.mts'], 'wood-footbridge': ['shared/model-bounds.mts', 'placement.deckHeightMetres'],
  'firewood-log': ['shared/model-bounds.mts', 'shared/wood-pile-layout.mts'], 'valley-castle': ['shared/castle-surface-data.mts', 'tests/castle.test.mjs'],
  'camp-cave': ['shared/camp-cave-surface-data.mts', 'tests/cave-rimo-mural.test.mjs', 'tests/update-cave.test.mjs', 'cave mural coordinates'],
  'camp-mountain': ['shared/camp-mountain-surface-data.mts', 'tests/camp-landform.test.mjs'],
  'glacier-spires': ['shared/landmark-bounds.mts', 'tests/landmarks.test.mjs'], 'volcanic-cone': ['shared/landmark-bounds.mts', 'tests/landmarks.test.mjs'],
  'desert-cactus': ['shared/region-feature-bounds.mts', 'tests/region-features.test.mjs'], 'volcanic-basalt-columns': ['shared/region-feature-bounds.mts', 'tests/region-features.test.mjs'],
  'yellow-524-mascot': ['tests/companion-524.test.mjs'], 'meadow-grass': ['tests/meadow-ground-tint.test.mjs'], 'meadow-ground': ['tests/meadow-ground-tint.test.mjs'],
};
const GROUP = (a) => {
  if (a.kind === 'player') return 'player-character';
  if (a.kind === 'enemy') return 'enemy';
  if (a.kind === 'quadruped') return 'animal';
  if (a.kind === 'companion') return 'companion';
  if (a.kind === 'equipment' || ['obsidian-blade'].includes(a.modelKey)) return 'equipment';
  if (['terrain', 'water'].includes(a.kind)) return 'terrain-water';
  if (['tree', 'foliage'].includes(a.kind) || a.modelKey === 'desert-cactus') return 'vegetation';
  if (['valley-castle', 'camp-cave', 'camp-mountain', 'glacier-spires', 'volcanic-cone', 'volcanic-basalt-columns'].includes(a.modelKey)) return 'landmark';
  return 'prop-structure';
};
const status = existsSync(path.join(root, 'assets/asset-remake/status.json')) ? read('assets/asset-remake/status.json') : {};
const rows = [...characters, ...world].map((a) => {
  const key = a.modelKey;
  const usageKey = a.kind === 'player' ? 'player' : key.startsWith('orb-bot') ? 'orb-bot' : a.kind === 'equipment' && !USAGE[key] ? 'equipment' : ['terrain'].includes(a.kind) ? 'terrain' : key;
  const s = status[key] ?? {};
  return {
    key, name: a.name ?? key, group: GROUP(a), kind: a.kind,
    current: { url: a.url, sha256: a.sha256, bytes: a.bytes, triangles: a.triangles, heightMetres: a.heightMetres ?? null,
      clips: (a.clips ?? []).map((c) => c.name), lods: (a.lods ?? []).map((l) => l.url) },
    usage: USAGE[usageKey] ?? USAGE[key] ?? '(see world-scenery / regional-scenery)',
    derivedData: DERIVED[key] ?? [],
    reference: `output/model-generation/models/${key}/source/original/`,
    issues: s.issues ?? null, motions: s.motions ?? null, plan: s.plan ?? null,
    replacement: s.replacement ?? null, progress: s.progress ?? 'not-started', verification: s.verification ?? null,
  };
});
const extras = (status.__codeBuilt ?? []).map((x) => ({ ...x, group: 'code-built-stand-in' }));
mkdirSync(path.join(root, 'assets/asset-remake'), { recursive: true });
mkdirSync(path.join(root, 'docs/asset-remake'), { recursive: true });
writeFileSync(path.join(root, 'assets/asset-remake/tracker.json'), JSON.stringify({ generated: new Date().toISOString(), assets: rows, codeBuilt: extras }, null, 2) + '\n');
const order = ['player-character', 'animal', 'enemy', 'companion', 'equipment', 'prop-structure', 'vegetation', 'terrain-water', 'landmark'];
let md = `# 全3Dアセット一覧と旧→新対応表（自動生成）\n\n生成: ${new Date().toISOString()} — \`node scripts/remake/build-tracker.mjs\`。進捗の正本は \`assets/asset-remake/status.json\`、詳細は \`assets/asset-remake/tracker.json\`。\n\n`;
md += `利用中GLB ${rows.length - 1}件（flint-spearはレビュー画面のみ）＋コード生成の代用品${extras.length}件。\n\n`;
for (const g of order) {
  const list = rows.filter((r) => r.group === g);
  if (!list.length) continue;
  md += `## ${g}（${list.length}）\n\n| key | 現行GLB | 三角形 | クリップ | 依存データ | 進捗 | 新GLB | 検証 |\n|---|---|---:|---|---|---|---|---|\n`;
  for (const r of list)
    md += `| ${r.key} | ${r.current.url.split('/').pop()} | ${r.current.triangles ?? ''} | ${r.current.clips.length} | ${r.derivedData.join(', ')} | ${r.progress} | ${r.replacement?.url?.split('/').pop() ?? ''} | ${r.verification ?? ''} |\n`;
  md += '\n';
}
if (extras.length) {
  md += `## コード生成の代用品（${extras.length}）\n\n| id | 場所 | 内容 | 進捗 |\n|---|---|---|---|\n`;
  for (const x of extras) md += `| ${x.id} | ${x.where} | ${x.what} | ${x.progress ?? 'not-started'} |\n`;
}
writeFileSync(path.join(root, 'docs/asset-remake/INVENTORY.md'), md);
console.log(`${rows.length} GLB assets, ${extras.length} code-built`);
