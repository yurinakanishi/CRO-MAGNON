// Explicit, public CC0 originals only. Never run at game startup.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const root = 'assets/nature-audio/quality-source';
await mkdir(root, { recursive: true });
const sources = [
  [
    'wind-field.wav',
    'https://opengameart.org/sites/default/files/park_ambience_wind.wav',
    'Thimras',
    'https://opengameart.org/content/park-ambiences',
  ],
  [
    'river-field.wav',
    'https://opengameart.org/sites/default/files/park_ambience_river.wav',
    'Thimras',
    'https://opengameart.org/content/park-ambiences',
  ],
  [
    'rain-field.ogg',
    'https://opengameart.org/sites/default/files/Ove%20Melaa%20-%20Rainy%20%28NOT%20loopable%29%20Long%20Version.ogg',
    'Ove Melaa',
    'https://opengameart.org/content/rain-ambient-not-loopable-2-versions-available',
  ],
  [
    'drips.flac',
    'https://opengameart.org/sites/default/files/atmosbasement.mp3_.flac',
    'Independent.nu / qubodup',
    'https://opengameart.org/content/dripping-water-loop',
  ],
];
const tree = JSON.parse(await readFile(`${root}/vsco-tree.json`));
const paths = [
  ...['C3', 'E3', 'A3', 'C4', 'E4'].map((n) => `Woodwinds/Flute/susNV/LDFlute_susNV_${n}_v1_1.wav`),
  ...['D2', 'A2', 'C3', 'E3', 'G3', 'B3', 'D4', 'F4', 'A4'].map(
    (n) => `Strings/Harp/KSHarp_${n}_mf.wav`,
  ),
  'LICENSE',
];
for (const p of paths) {
  if (!tree.tree.some((x) => x.path === p)) throw Error(`Unknown sample: ${p}`);
  sources.push([
    p.split('/').at(-1),
    `https://raw.githubusercontent.com/sgossner/VSCO-2-CE/${tree.sha}/${p}`,
    'Versilian Studios / Sam Gossner & Simon Dalzell; cutting: Elan Hickler',
    'https://versilian-studios.com/vsco-community/',
  ]);
}
const manifest = [];
// Sequential to avoid unnecessary simultaneous large downloads.
for (const [file, url, author, page] of sources) {
  let data;
  try {
    data = await readFile(`${root}/${file}`);
  } catch {
    const response = await fetch(url);
    if (!response.ok) throw Error(`${response.status} ${url}`);
    data = Buffer.from(await response.arrayBuffer());
    await writeFile(`${root}/${file}`, data);
  }
  manifest.push({
    file,
    url,
    author,
    page,
    license: 'CC0-1.0',
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  });
  console.log(file, data.length);
}
await writeFile(
  `${root}/sources.json`,
  JSON.stringify({ downloaded: '2026-10-06', vscoCommit: tree.sha, sources: manifest }, null, 2) +
    '\n',
);
