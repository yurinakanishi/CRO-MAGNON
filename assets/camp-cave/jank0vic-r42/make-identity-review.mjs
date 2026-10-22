// Identity record for gallery r42. The 24 r41 characters keep their reviewed sources
// and must decode to exactly the r41 delivered pixels; Jank0vic is new, painted by
// built-in image_gen from the user-approved X photo. Run from the repository root:
//   node assets/camp-cave/jank0vic-r42/make-identity-review.mjs [--game-review <report.json>]
// Without --game-review every entry stays unreviewed and adoption refuses it.
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { CAVE_SUBJECT_ART } from '../../../dist/shared/cave-mural-art.mjs';
import {
  CAVE_MURALS,
  caveMuralImages,
  caveMuralUV,
} from '../../../dist/src/cave-gallery-layout.js';
const root = 'assets/camp-cave/jank0vic-r42',
  previousRoot = 'assets/camp-cave/identity-r41';
const hash = (b) => createHash('sha256').update(b).digest('hex');
const json = async (p) => JSON.parse(await readFile(p, 'utf8'));
const file = async (path) => {
  const bytes = await readFile(path);
  return { path, sha256: hash(bytes), bytes: bytes.length };
};
const asset = await json('public/models/camp-cave/asset.json'),
  recipe = await json(`${root}/recipe.json`),
  previous = await json(`${previousRoot}/qa/identity-review.json`);
assert.equal(asset.muralComposition.recipe, `${root}/recipe.json`, 'build r42 first');
assert.equal(recipe.identityReview, `${root}/qa/identity-review.json`);
const at = process.argv.indexOf('--game-review'),
  gameReport = at > 0 ? process.argv[at + 1] : undefined;
assert(at < 0 || gameReport?.startsWith('output/'), 'supply the saved isolated Chrome report');
const images = caveMuralImages(asset),
  pixels = new Map();
const raw = (input) => sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
await mkdir(`${root}/qa/served`, { recursive: true });
// The exact delivered cutout, measured as the runtime shader samples it.
async function served(id) {
  const mural = CAVE_MURALS.find((m) => m.kind === 'character' && m.subject === id),
    image =
      images.extras[mural.motif] ??
      (mural.motif === 'creature524' ? images.characterPigment : images.rimoPigment);
  if (!pixels.has(image.url)) {
    const bytes = await readFile(`public${image.url}`);
    assert.equal(hash(bytes), image.sha256, `${image.url}: delivered bytes`);
    pixels.set(image.url, bytes);
  }
  const uv = caveMuralUV(mural),
    { width, height } = image.image,
    cut = await sharp(pixels.get(image.url))
      .extract({
        left: Math.round(uv.offset[0] * width),
        top: Math.round((1 - uv.offset[1] - uv.scale[1]) * height),
        width: Math.round(uv.scale[0] * width),
        height: Math.round(uv.scale[1] * height),
      })
      .png()
      .toBuffer(),
    after = `${root}/qa/served/${id}.png`;
  await writeFile(after, cut);
  return { delivery: { url: image.url, sha256: image.sha256, rect: mural.rect }, after, cut };
}
const reviewedInGame = !!gameReport,
  subjects = [];
for (const { id } of CAVE_SUBJECT_ART) {
  const { cut, ...delivered } = await served(id);
  const before = previous.subjects.find((s) => s.id === id);
  if (before) {
    // Retained characters: same reference and source, identical decoded pixels.
    const a = await raw(before.after),
      b = await raw(cut);
    assert.deepEqual([b.info.width, b.info.height], [a.info.width, a.info.height], id);
    assert(a.data.equals(b.data), `${id}: delivered pixels changed since r41`);
    subjects.push({
      id,
      decision: 'retain',
      reference: before.reference,
      before: before.after,
      source: before.source,
      features: before.features,
      pose: 'r41 cutout retained: decoded delivered pixels are identical to the reviewed r41 cutout.',
      ...delivered,
      reviewedInGame,
    });
    continue;
  }
  assert.equal(id, 'jank0vic', `${id}: unexpected new character`);
  const s = recipe.subjects.find((s) => s.id === id),
    source = recipe.sources[s.source];
  assert.equal(hash(await readFile(source.path)), source.sha256);
  subjects.push({
    id,
    decision: 'new',
    reference: await file(`${root}/references/x-avatar-400x400.jpg`),
    styleReference: await file('assets/camp-cave/identity-r41/source/howkey-scientist-r01.png'),
    candidates: await Promise.all(
      [1, 2, 3].map((n) => file(`${root}/candidates/jank0vic-candidate-0${n}.png`)),
    ),
    source: source.path,
    features: [
      'short thick jet-black hair swept up at the front with short sides',
      'broad open smile showing the upper teeth, straight dark brows',
      'slightly prominent ears',
      'navy stand-up-collar jacket over a white shirt (the collar visible in the photo)',
    ],
    pose: 'New right-facing walk with a raised waving hand, candidate 01 of three. The photo supplies identity only; no photographic likeness or pixel-identical face is claimed.',
    ...delivered,
    reviewedInGame,
  });
}
assert.equal(subjects.length, 25);
assert.deepEqual(
  subjects.map((s) => s.id).sort(),
  previous.subjects
    .map((s) => s.id)
    .concat('jank0vic')
    .sort(),
);
const review = {
  reviewedAt: new Date().toISOString(),
  subjects,
  scope:
    'Jank0vic added from the user-approved X profile photo (saved as production material only; never served or shown on cards). The 24 r41 characters keep their sources and decode to identical delivered pixels. Cave-pigment simplification; no claim of photographic or pixel-identical faces.',
  ...(gameReport
    ? {
        gameReview: {
          report: gameReport,
          sha256: hash(await readFile(gameReport)),
          checkedAt: (await json(gameReport)).checkedAt,
          scope:
            'Manual comparison of the delivered cutouts and wall-normal views covering every character on both walls, plus PC/mobile waiting and live oblique views. Jank0vic compared with the reference photo and the chosen source.',
        },
      }
    : {}),
};
await writeFile(`${root}/qa/identity-review.json`, JSON.stringify(review, null, 2) + '\n');
// A local comparison page for the reviewer; the photo is never part of a build.
const escape = (t) =>
  String(t).replace(/[&<>"]/g, (c) => `&${{ '&': 'amp', '<': 'lt', '>': 'gt', '"': 'quot' }[c]};`);
const link = (path) => `../../../../${path}`;
const figure = (caption, path, id) =>
  `<figure><figcaption>${caption}</figcaption><a href="${link(path)}"><img src="${link(path)}" alt="${escape(`${id} ${caption}`)}"></a></figure>`;
const articles = subjects.map(
  (s) =>
    `<article id="${s.id}"><h2>${escape(s.id)} <small>${s.decision === 'new' ? '新規追加' : 'r41の素材を保持'}</small></h2><div class="pictures">${figure('元の参照画像', s.reference.path, s.id)}${figure(s.decision === 'new' ? '採用したimage_gen原本' : 'r41の配信素材', s.decision === 'new' ? s.source : s.before, s.id)}${figure('r42の配信素材', s.after, s.id)}</div><p>${escape(s.features.join(' / '))}</p></article>`,
);
await writeFile(
  `${root}/qa/index.html`,
  `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>壁画25体：参照と配信素材の比較</title><style>body{margin:24px;background:#e9e0ce;color:#29231c;font:16px/1.6 system-ui}h1{font-size:24px}article{padding:18px;margin:20px 0;background:#f9f5ea;border:1px solid #99896d;border-radius:10px}h2{margin:0 0 12px;font-size:20px}small{font-weight:normal}.pictures{display:grid;grid-template-columns:1fr 1fr 1fr;gap:18px}figure{margin:0}figcaption{font-size:14px;margin-bottom:6px}img{width:100%;height:300px;object-fit:contain;background:#bfb297;border-radius:6px}p{margin:12px 0 0;font-size:14px}@media(max-width:640px){body{margin:10px}.pictures{gap:6px}img{height:200px}article{padding:10px}}</style><h1>壁画25体：参照と配信素材の比較</h1><p>Jank0vicさんを新規追加（Xのアイコン写真を参照、ユーザー承認済み）。24体はr41の生成素材と配信ピクセルを保持。右列は実際の配信PNGの切り出し。</p>${articles.join('\n')}\n`,
);
console.log(
  JSON.stringify({
    subjects: subjects.length,
    retained: subjects.filter((s) => s.decision === 'retain').length,
    added: subjects.filter((s) => s.decision === 'new').map((s) => s.id),
    reviewedInGame,
  }),
);
