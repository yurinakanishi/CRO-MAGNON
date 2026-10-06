// Fetch explicitly licensed originals and retain primary-source licence evidence.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const root = 'assets/nature-audio/foley-source';
await mkdir(root, { recursive: true });
const jobs = [
  [
    'impact',
    'https://kenney.nl/assets/impact-sounds',
    'Kenney',
    /https:\/\/kenney.nl\/media\/[^"\s]+kenney_impact-sounds.zip/,
  ],
  [
    'cloth',
    'https://opengameart.org/content/footsteps-leather-cloth-armor',
    'HaelDB',
    /https:\/\/opengameart.org\/sites\/default\/files\/[^"<>\s]*footsteps[^"<>\s]*\.zip/,
  ],
  [
    'snow',
    'https://opengameart.org/content/42-snow-and-gravel-footsteps',
    'Corsica_S / Iwan Gabovitch',
    /https:\/\/opengameart.org\/sites\/default\/files\/[^"<>\s]*\.7z/,
  ],
  [
    'water',
    'https://opengameart.org/content/40-cc0-water-splash-slime-sfx',
    'rubberduck',
    /https:\/\/opengameart.org\/sites\/default\/files\/[^"<>\s]*\.zip/,
  ],
  [
    'swish',
    'https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes',
    'qubodup',
    /https:\/\/opengameart.org\/sites\/default\/files\/[^"<>\s]*\.(?:zip|7z)/,
  ],
];
const sources = [];
for (const [id, page, author, pattern] of jobs) {
  const response = await fetch(page);
  if (!response.ok) throw Error(`${page}: ${response.status}`);
  const html = await response.text();
  if (!/creativecommons.org\/publicdomain\/zero|Creative Commons CC0/.test(html))
    throw Error(`CC0 missing: ${page}`);
  await writeFile(`${root}/${id}-license.html`, html);
  const url = html.match(pattern)?.[0];
  if (!url) throw Error(`No download in ${page}`);
  const file = `${id}.${url.split('.').at(-1)}`;
  let bytes;
  try {
    bytes = await readFile(`${root}/${file}`);
  } catch {
    const download = await fetch(url);
    if (!download.ok) throw Error(`${url}: ${download.status}`);
    bytes = Buffer.from(await download.arrayBuffer());
    if (bytes.subarray(0, 100).toString().includes('<!DOCTYPE'))
      throw Error('HTML instead of archive');
    await writeFile(`${root}/${file}`, bytes);
  }
  sources.push({
    file,
    author,
    page,
    url,
    license: 'CC0-1.0',
    sha256: createHash('sha256').update(bytes).digest('hex'),
    bytes: bytes.length,
  });
  console.log(id, bytes.length);
}
const catPage = 'https://freesound.org/people/Zabuhailo/sounds/146963/';
const catResponse = await fetch(catPage);
if (!catResponse.ok) throw Error(`Cat source: ${catResponse.status}`);
const catHtml = await catResponse.text();
if (!catHtml.includes('creativecommons.org/publicdomain/zero')) throw Error('Cat CC0 missing');
const catUrl = catHtml.match(
  /https:\/\/cdn.freesound.org\/previews\/146\/146963_[^"'\s<>]+-hq\.mp3/,
)?.[0];
if (!catUrl) throw Error('Cat public HQ recording missing');
await writeFile(`${root}/cat-license.html`, catHtml);
const catAudio = await fetch(catUrl);
if (!catAudio.ok) throw Error(`Cat audio: ${catAudio.status}`);
const catBytes = Buffer.from(await catAudio.arrayBuffer());
await writeFile(`${root}/cat-hiss.mp3`, catBytes);
sources.push({
  file: 'cat-hiss.mp3',
  author: 'Zabuhailo',
  page: catPage,
  url: catUrl,
  license: 'CC0-1.0',
  format: 'public HQ MP3; original WAV requires login',
  sha256: createHash('sha256').update(catBytes).digest('hex'),
  bytes: catBytes.length,
});
await writeFile(`${root}/sources.json`, JSON.stringify({ sources }, null, 2) + '\n');
for (const item of sources.filter((s) => /\.(zip|7z)$/.test(s.file))) {
  const archive = path.resolve(root, item.file);
  const destination = path.resolve(root, item.file.replace(/\.(zip|7z)$/, ''));
  const listing = spawnSync('tar', ['-tf', archive], { encoding: 'utf8' });
  if (listing.status !== 0) throw Error(listing.stderr);
  for (const name of listing.stdout.trim().split(/\r?\n/)) {
    const resolved = path.resolve(destination, name);
    if (!resolved.startsWith(destination + path.sep)) throw Error(`Unsafe archive path ${name}`);
  }
  await mkdir(destination, { recursive: true });
  const extracted = spawnSync('tar', ['-xf', archive, '-C', destination], { encoding: 'utf8' });
  if (extracted.status !== 0) throw Error(extracted.stderr);
}
