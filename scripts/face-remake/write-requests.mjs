// Write the Codex built-in image_gen requests for the 2026-10-07 human face remake.
// node scripts/face-remake/write-requests.mjs [version]
// Output: assets/face-remake/<key>/source/codex-request-v<version>.txt and request.json (prompts as sent).
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const version = process.argv[2] || '1';
const root = resolve('assets/face-remake');
const shared =
  'Photorealistic premium AAA game character head (MetaHuman-quality sculpt and skin), clean image-to-3D reconstruction reference. ' +
  'HEAD AND NECK ONLY, direct FRONT VIEW, head perfectly upright and centred, eyes level and looking straight into the camera, ' +
  'relaxed neutral expression with the lips closed. Both ears fully visible. The hair is swept completely clear of the face, ' +
  'forehead, eyes and ears: no fringe, no bangs, no loose strands across the face; the hair forms coherent sculpted masses, ' +
  'not floating strands. Show the whole head and the entire neck, the neck ending in a clean straight horizontal cut just above ' +
  'the collarbones. No shoulders, chest, clothing, fur, jewellery, beads, paint, tattoos, scars, pedestal or accessories. ' +
  'Natural healthy skin with fine realistic pores, no makeup, even skin tone. Soft even diffuse neutral studio light from the ' +
  'front and both sides, no hard shadows, no rim light, no dramatic contrast. Head and neck fill about 85% of the image height, ' +
  'centred on a plain uniform light neutral grey background. A single head, one view only, no text, no panels.';
const characters = [
  {
    key: 'cro-magnon-hunter',
    attach: ['before-rest-front.png'],
    identity:
      'The attached image is a crude low-quality game render of this character; keep only his hair colour, hairline and the idea of ' +
      'his short full beard. Everything about the face itself must be redesigned to be realistic and handsome.',
    subject:
      'Subject: a strikingly handsome, cool and rugged adult Cro-Magnon hunter, about 30 years old. Strong defined jawline, high ' +
      'cheekbones, straight well-formed nose, deep-set confident hazel-brown eyes under thick straight dark eyebrows, natural lips. ' +
      'Warm light-olive sun-tanned skin. Dark brown thick hair swept straight back from the forehead and tied behind the head ' +
      '(the tie hidden behind the head), short neat full dark-brown beard closely following the jaw and chin, ending at the chin ' +
      'so that the front and sides of the neck stay clean and visible.',
    variants: [
      'Calm, quietly confident heroic gaze.',
      'Slightly sharper, more chiselled cheekbones and a faint confident intensity in the eyes.',
    ],
  },
  {
    key: 'neanderthal-hunter',
    attach: ['before-rest-front.png'],
    identity:
      'The attached image is a crude low-quality game render of this character; keep only his black hair gathered into a topknot ' +
      'and his dark full beard. Everything about the face itself must be redesigned to be realistic and cool.',
    subject:
      'Subject: a cool, imposing yet handsome adult Neanderthal warrior, about 35 years old, realistic paleo-anthropological ' +
      'features rendered attractively: a pronounced but smooth double-arched brow ridge, deep-set intelligent dark brown eyes, a ' +
      'broad strong nose, wide cheekbones, a powerful wide jaw. Warm medium tan weathered skin. Thick black hair pulled straight ' +
      'back and gathered into a compact topknot on the crown. Dense, neatly trimmed black full beard that follows the jaw and ' +
      'ends at the chin, so that the front and sides of the neck stay clean and visible.',
    variants: [
      'Steady, stoic, dependable gaze.',
      'A slightly more brooding, intense but kind gaze.',
    ],
  },
  {
    key: 'cro-magnon-woman',
    attach: ['before-rest-front.png'],
    identity:
      'The attached image is a crude low-quality game render of this character; keep only her dark brown braided hair idea and her ' +
      'soft oval face. Everything about the face itself must be redesigned to be realistic and very cute.',
    subject:
      'Subject: a very cute, pretty and natural adult Cro-Magnon young woman, about 22 years old. Soft oval face, smooth round ' +
      'cheeks, large clear almond-shaped warm brown eyes with natural lashes, softly arched dark-brown eyebrows, a small neat nose, ' +
      'soft full rosy natural lips with a hint of a gentle friendly smile while closed. Light warm fair skin with a healthy natural ' +
      'blush. Dark brown hair pulled back from the forehead into neat braids wrapped around the head like a crown, all gathered ' +
      'into a compact braided bun at the back of the head; nothing hangs below the nape.',
    variants: ['Gentle sweet expression.', 'Bright cheerful eyes, slightly rounder youthful face.'],
  },
  {
    key: 'neanderthal-woman',
    attach: ['before-rest-front.png'],
    identity:
      'The attached image is a crude low-quality game render of this character; keep only her dark brown curly hair gathered back ' +
      'into a low bun and her warm medium-tan complexion. Everything about the face itself must be redesigned to be realistic and cute.',
    subject:
      'Subject: a cute, pretty, warm-hearted adult Neanderthal young woman, about 23 years old, with gently softened Neanderthal ' +
      'features: a softly rounded brow, a slightly broad cute nose, full cheeks with defined cheekbones, full soft natural lips with a ' +
      'hint of a friendly closed smile, large warm dark brown eyes with natural lashes, soft dark eyebrows. Warm medium tan skin with ' +
      'a natural healthy glow. Dark brown wavy hair pulled back from the forehead into a compact low bun at the back of the head; ' +
      'nothing hangs below the nape.',
    variants: ['Gentle kind expression.', 'Bright cheerful eyes, slightly rounder youthful face.'],
  },
];
const record = { date: '2026-10-07', version, generator: 'Codex built-in image_gen', characters: [] };
for (const c of characters) {
  const dir = resolve(root, c.key, 'source');
  await mkdir(dir, { recursive: true });
  const letters = 'ab'.slice(0, c.variants.length).split('');
  const prompts = letters.map((l, i) => `${shared} ${c.subject} ${c.variants[i]}`);
  const lines = [
    `Use your built-in image generation tool (image_gen) to create ${letters.length} separate images. Do not write code, do not ` +
      'use Python/PIL or any drawing library, and do not edit any files other than saving the PNGs and the prompts JSON named below.',
    '',
    c.identity,
    '',
    ...letters.flatMap((l, i) => [`Image ${l.toUpperCase()} prompt:`, `"${prompts[i]}"`, '']),
    'Save the generated images as PNG files exactly at:',
    ...letters.map((l) => resolve(dir, `reference-v${version}${l}.png`).replace(/\\/g, '/')),
    `(copy them from wherever the image tool stores its outputs). Then write prompts-v${version}.json in the same folder listing, ` +
      'for each file, the exact full prompt you sent to the image tool. Reply with the saved paths.',
  ];
  await writeFile(resolve(dir, `codex-request-v${version}.txt`), lines.join('\n') + '\n');
  record.characters.push({ key: c.key, attach: c.attach.map((a) => `assets/face-remake/${c.key}/source/${a}`), identity: c.identity, prompts });
}
await writeFile(resolve(root, `request-v${version}.json`), JSON.stringify(record, null, 2) + '\n');
console.log('wrote requests', version);
