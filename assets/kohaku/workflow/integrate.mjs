import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
const read = (p) => readFile(p, 'utf8');
const save = (p, s) => writeFile(p, s);
const original = new Map();
async function edit(p, change) {
  const before = await read(p);
  if (!original.has(p)) original.set(p, before);
  const after = change(before);
  if (after === before) throw new Error(`No edit: ${p}`);
  await save(p, after);
}
function replace(s, before, after) {
  if (!s.includes(before)) throw new Error(`Missing anchor: ${before}`);
  return s.replace(before, after);
}
const renamed = (s) => s.replaceAll('MAE', 'KOHAKU').replaceAll('Mae', 'Kohaku').replaceAll('mae', 'kohaku');
await save('shared/kohaku-types.mts', renamed(await read('shared/mae-types.mts')));
let domain = renamed(await read('shared/mae.mts'));
domain = domain.replace('CAMP.x + 3.2, z: CAMP.z + 1.2', 'CAMP.x + 2.4, z: CAMP.z - 1.8')
  .replace('radius: 0.25', 'radius: 0.22').replace('bodyHeight: 0.38', 'bodyHeight: 0.5199786842176763')
  .replace('headHeight: 0.37', 'headHeight: 0.46').replace('followDistance: 1.85', 'followDistance: 1.65')
  .replace('The pouch approaches', 'The mascot approaches');
await save('shared/kohaku.mts', domain);
let renderer = renamed(await read('src/mae-renderer.ts'))
  .replace('The delivered soft-pouch skin owns every squash, sway and happy hop.', 'The reconstructed mascot skin owns its biped gait, gestures and tail motion.')
  .replace("world.createLabel('kohaku'", "world.createLabel('こはくちゃん'");
await save('src/kohaku-renderer.ts', renderer);
await edit('shared/snapshots.mts', s => replace(s, "  mae?: import('./mae-types.mjs').MaeSnapshot;", "  mae?: import('./mae-types.mjs').MaeSnapshot;\n  kohaku?: import('./kohaku-types.mjs').KohakuSnapshot;"));
await edit('application/snapshot.mts', s => replace(replace(s,
  "import { maeSnapshot } from '../shared/mae.mjs';", "import { maeSnapshot } from '../shared/mae.mjs';\nimport { kohakuSnapshot } from '../shared/kohaku.mjs';"),
  '    mae: maeSnapshot(room.mae),', '    mae: maeSnapshot(room.mae),\n    kohaku: kohakuSnapshot(room.kohaku),'));
await edit('application/game-core.mts', s => {
  s = replace(s, "import { createMae, updateMae, restoreMae } from '../shared/mae.mjs';", "import { createMae, updateMae, restoreMae } from '../shared/mae.mjs';\nimport { createKohaku, updateKohaku, restoreKohaku } from '../shared/kohaku.mjs';");
  s = replace(s, '      if (!visibility.hideMae) room.mae = createMae(room.collision);', '      if (!visibility.hideMae) room.mae = createMae(room.collision);\n      room.kohaku = createKohaku(room.collision);');
  s = s.replaceAll('updateMae(room, dt, now);', 'updateMae(room, dt, now);\n      updateKohaku(room, dt, now);');
  s = replace(s, '              mae: room.mae ?? room.hiddenMae,', '              mae: room.mae ?? room.hiddenMae,\n              kohaku: room.kohaku,');
  return replace(s, '      else restoreMae(room, record.mae);', '      else restoreMae(room, record.mae);\n      restoreKohaku(room, record.kohaku);');
});
await edit('application/actions.mts', s => {
  s = replace(s, "import { handleMaeAction, cancelMaePet } from '../shared/mae.mjs';", "import { handleMaeAction, cancelMaePet } from '../shared/mae.mjs';\nimport { handleKohakuAction, cancelKohakuPet } from '../shared/kohaku.mjs';");
  s = replace(s, "    if (action === 'travelAlone') {", "    if (action === 'travelAlone') {\n      if (room.kohaku?.petPlayerId === player.id) cancelKohakuPet(room.kohaku);\n      handleKohakuAction(room, player, 'dismissKohaku', now);");
  s = replace(s, "      if (action === 'recallBots') {", "      if (action === 'recallBots') {\n        if (room.kohaku?.petPlayerId === player.id) cancelKohakuPet(room.kohaku);");
  s = s.replaceAll('room.mae?.petPlayerId === player.id ||', 'room.mae?.petPlayerId === player.id ||\n          room.kohaku?.petPlayerId === player.id ||');
  s = replace(s, "        action === 'petMae' &&\n        (room.companion524", "        action === 'petMae' &&\n        (room.kohaku?.petPlayerId === player.id ||\n          room.companion524");
  const start = s.indexOf("    if (action === 'petMae' || action === 'dismissMae') {");
  const end = s.indexOf("    if (action === 'petRimo'", start);
  let block = renamed(s.slice(start, end)).replace('room.kohaku?.petPlayerId === player.id ||', 'room.mae?.petPlayerId === player.id ||');
  return s.slice(0, start) + block + s.slice(start);
});
await edit('shared/orb-bots.mts', s => s.replace('  mae?: { petPlayerId: string | null };', '  mae?: { petPlayerId: string | null };\n  kohaku?: { petPlayerId: string | null };')
  .replaceAll('room.mae?.petPlayerId === p.id ||', 'room.mae?.petPlayerId === p.id ||\n    room.kohaku?.petPlayerId === p.id ||')
  .replaceAll('room.mae?.petPlayerId !== p.id &&', 'room.mae?.petPlayerId !== p.id &&\n        room.kohaku?.petPlayerId !== p.id &&'));
await edit('shared/combat.mts', s => {
  s = replace(s, "import { hitMae } from './mae.mjs';", "import { hitMae } from './mae.mjs';\nimport { hitKohaku } from './kohaku.mjs';");
  s = replace(s, "    ...(room.mae ? [{ target: room.mae, kind: 'mae' }] : []),", "    ...(room.mae ? [{ target: room.mae, kind: 'mae' }] : []),\n    ...(room.kohaku ? [{ target: room.kohaku, kind: 'kohaku' }] : []),");
  s = replace(s, '        target === room.mae ||', '        target === room.mae ||\n        target === room.kohaku ||');
  return replace(s, "  if (kind === 'mae') {", "  if (kind === 'kohaku') {\n    hitKohaku(target, direction.x, direction.z, now);\n    return { hit: true, target, kind, killed: false, weapon: profile.key };\n  }\n  if (kind === 'mae') {");
});
await edit('shared/hunting.mts', s => replace(s, "    if (strike.kind === 'mae') {", "    if (strike.kind === 'kohaku') {\n      notify(player, 'こはくちゃんがびっくりして身を引いた。', 'info', false);\n      return true;\n    }\n    if (strike.kind === 'mae') {"));
await edit('src/main.ts', s => {
  s = replace(s, "import { nearMae } from '../shared/mae.mjs';", "import { nearMae } from '../shared/mae.mjs';\nimport { nearKohaku } from '../shared/kohaku.mjs';");
  const start = s.indexOf('function canPetMae() {'), end = s.indexOf('function nearbyBotsForPetting()', start);
  const block = renamed(s.slice(start, end)).replace('    state.rimoNeko?.petPlayerId !== selfId &&', '    state.rimoNeko?.petPlayerId !== selfId &&\n    state.mae?.petPlayerId !== selfId &&');
  s = s.replaceAll('state.mae?.petPlayerId !== selfId &&', 'state.mae?.petPlayerId !== selfId &&\n    state.kohaku?.petPlayerId !== selfId &&');
  s = s.replaceAll('state.mae?.petPlayerId === selfId ||', 'state.mae?.petPlayerId === selfId ||\n    state.kohaku?.petPlayerId === selfId ||');
  s = replace(s, 'function nearbyBotsForPetting()', block + 'function nearbyBotsForPetting()');
  s = replace(s, '    !state.mae?.petPlayerId &&', '    !state.mae?.petPlayerId &&\n    state.kohaku?.petPlayerId !== selfId &&');
  s = replace(s, '  if (canPetMae())\n    candidates.push', "  if (canPetKohaku())\n    candidates.push({ point: state.kohaku!, choice: { action: 'petKohaku', label: 'こはくちゃんを撫でる' } });\n  if (canPetMae())\n    candidates.push");
  s = replace(s, '  if (state.mae?.followPlayerId === selfId)\n    candidates.push', "  if (state.kohaku?.followPlayerId === selfId)\n    candidates.push({ point: state.kohaku, action: 'dismissKohaku' });\n  if (state.mae?.followPlayerId === selfId)\n    candidates.push");
  s = replace(s, '  if (id === state.mae?.id) {', '  if (id === state.kohaku?.id) {\n    petKohaku();\n    return;\n  }\n  if (id === state.mae?.id) {');
  s = replace(s, '  const menuMae =', "  const menuKohaku = $('[data-controller-menu=\"dismissKohaku\"]');\n  if (menuKohaku) menuKohaku.disabled = state.kohaku?.followPlayerId !== selfId;\n  const menuPetKohaku = $('[data-controller-menu=\"petKohaku\"]');\n  if (menuPetKohaku) menuPetKohaku.disabled = !canPetKohaku();\n  const menuMae =");
  for (const anchor of ['    ...(canPetMae()', '    ...(state.mae?.followPlayerId === selfId']) {
    const begin = s.indexOf(anchor), finish = s.indexOf('      : []),', begin) + '      : []),'.length;
    if (begin < 0 || finish < begin) throw new Error('Menu anchor missing');
    const piece = s.slice(begin, finish);
    s = s.slice(0, begin) + renamed(piece).replaceAll('kohakuを', 'こはくちゃんを') + '\n' + s.slice(begin);
  }
  return s.replace("            target.action === 'petMae' ||", "            target.action === 'petMae' ||\n            target.action === 'petKohaku' ||");
});
await edit('src/world3d.ts', s => {
  s = replace(s, "import { MAE } from '../shared/mae.mjs';", "import { MAE } from '../shared/mae.mjs';\nimport { KohakuRenderer } from './kohaku-renderer.js';\nimport { KOHAKU } from '../shared/kohaku.mjs';");
  s = replace(s, '  declare maeRenderer: MaeRenderer | undefined;', '  declare maeRenderer: MaeRenderer | undefined;\n  declare kohakuRenderer: KohakuRenderer | undefined;');
  s = replace(s, "            if (asset.modelKey === 'mae') this.maeRenderer = new MaeRenderer(this);", "            if (asset.modelKey === 'mae') this.maeRenderer = new MaeRenderer(this);\n            if (asset.modelKey === 'kohaku') this.kohakuRenderer = new KohakuRenderer(this);");
  s = replace(s, '          ...(this.maeRenderer ? [this.maeRenderer.root] : []),', '          ...(this.maeRenderer ? [this.maeRenderer.root] : []),\n          ...(this.kohakuRenderer ? [this.kohakuRenderer.root] : []),');
  s = replace(s, '    if (this.state.mae && this.maeRenderer)', "    if (this.state.kohaku && this.kohakuRenderer)\n      add(this.state.kohaku.id, 'こはくちゃん', this.kohakuRenderer.root, this.kohakuRenderer.actor.asset);\n    if (this.state.mae && this.maeRenderer)");
  s = replace(s, '    this.maeRenderer?.update(dt);', '    this.maeRenderer?.update(dt);\n    this.kohakuRenderer?.update(dt);');
  s = replace(s, '      const groundCompanion = petDot ?? petMae ?? this.state.rimoNeko;', '      const petKohaku = this.state.kohaku?.petPlayerId === p.id ? this.state.kohaku : undefined;\n      const groundCompanion = petDot ?? petKohaku ?? petMae ?? this.state.rimoNeko;');
  s = replace(s, '        : petMae\n', '        : petKohaku\n          ? pettingProgress(petKohaku, p, this.serverNow(), KOHAKU)\n        : petMae\n');
  s = replace(s, '          } else if (petMae && this.maeRenderer)', '          } else if (petKohaku && this.kohakuRenderer) this.kohakuRenderer.petTarget(tempPoint);\n          else if (petMae && this.maeRenderer)');
  s = replace(s, '              !!petDot || !!petMae,', '              !!petDot || !!petMae || !!petKohaku,');
  s = replace(s, '      data.mae =', '      data.kohaku = JSON.stringify(this.kohakuRenderer?.diagnostics() ?? null);\n      data.mae =');
  return replace(s, '    this.maeRenderer?.dispose();', '    this.maeRenderer?.dispose();\n    this.kohakuRenderer?.dispose();');
});
await edit('src/contact-shadows.ts', s => replace(s, '    add(this.world.maeRenderer?.root, 0.24);', '    add(this.world.maeRenderer?.root, 0.24);\n    add(this.world.kohakuRenderer?.root, 0.20);'));
for (const [file, contents] of original) {
  const backup = 'output/kohaku-before/' + file;
  await mkdir(backup.slice(0, backup.lastIndexOf('/')), { recursive: true });
  await writeFile(backup, contents, { flag: 'wx' });
}
console.log(`Integrated Kohaku into ${original.size} files; original contents retained.`);
