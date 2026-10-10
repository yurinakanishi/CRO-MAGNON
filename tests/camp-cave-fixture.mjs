// The camp-cave gallery's standalone images for tests of the gallery and the world
// around it. Only the network and the browser's image element are stand-ins: the
// bytes still pass the game's own verified download (origin, length, SHA-256) and
// its own decoder wrapper (verified-texture.ts). The real image files, their
// metadata and native decoding are proven separately (verified-texture.test.mjs,
// cave-uv-source.test.mjs and the native integrity checks).
import { createHash } from 'node:crypto';
import { CAVE_EXTRA_PIGMENTS } from '../dist/src/cave-gallery-layout.js';
import { downloadVerifiedAsset } from '../dist/src/asset-download.js';
import { decodeImageWith } from '../dist/src/verified-texture.js';

/** The origin the stand-in network serves. */
export const CAVE_ORIGIN = 'https://game.test';

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
/** A PNG-shaped stand-in file: signature and IHDR (its decoded size), then a body. */
function standIn(name, width, height) {
  const head = Buffer.alloc(33);
  SIGNATURE.copy(head, 0);
  head.writeUInt32BE(13, 8);
  head.write('IHDR', 12, 'latin1');
  head.writeUInt32BE(width, 16);
  head.writeUInt32BE(height, 20);
  head[24] = 8;
  head[25] = 6;
  return Buffer.concat([head, Buffer.from(`stand-in ${name} pigment`)]);
}
const nameOf = (url) => /\/([^/]+)\.png$/.exec(url)[1];

/** The standalone images of a camp-cave manifest: each record names an exact
 * stand-in file (its length and SHA-256) and the size its motif rectangles were
 * measured in, as the cave loaders require (caveImageRecords). */
export function caveGalleryImages() {
  const image = (name, width, height) => {
    const bytes = standIn(name, width, height);
    return {
      url: `/models/camp-cave/${name}.png`,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: bytes.length,
      image: { width, height },
    };
  };
  return {
    pigment: image('pigment', 1254, 1254),
    rockSurface: image('rock', 1254, 1254),
    characterPigment: image('524', 2171, 724),
    rimoPigment: image('rimo', 2172, 724),
    mascotPigments: Object.fromEntries(
      Object.keys(CAVE_EXTRA_PIGMENTS).map((key) => [key, image(key, 2172, 724)]),
    ),
  };
}

/** The ten records of a manifest made by caveGalleryImages(). */
const recordsOf = (asset) => [
  asset.pigment,
  asset.rockSurface,
  asset.characterPigment,
  asset.rimoPigment,
  ...Object.values(asset.mascotPigments),
];

/** The gallery's image loading for a LoadingCave (`images: network.options`): the
 * game's downloadVerifiedAsset over a stand-in transport serving `asset`'s files, and
 * the game's decodeImageWith over a stand-in page whose image element reads the
 * decoded size from the IHDR. Records what was requested, the blob URLs not yet
 * revoked and every decoded image, which counts its close() calls. */
export function caveImageNetwork(asset = caveGalleryImages()) {
  const files = new Map(
    recordsOf(asset).map((record) => [
      record.url,
      standIn(nameOf(record.url), record.image.width, record.image.height),
    ]),
  );
  const network = { requests: [], images: [], blobs: new Map(), files };
  const transport = async (url) => {
    network.requests.push(url.pathname);
    const bytes = files.get(url.pathname);
    return bytes ? new Response(bytes) : new Response('', { status: 404 });
  };
  let made = 0;
  const page = {
    createObjectURL(blob) {
      const url = `blob:${CAVE_ORIGIN}/${++made}`;
      network.blobs.set(url, blob);
      return url;
    },
    revokeObjectURL(url) {
      network.blobs.delete(url);
    },
    async load(url) {
      const view = Buffer.from(await network.blobs.get(url).arrayBuffer());
      if (!view.subarray(0, 8).equals(SIGNATURE)) throw new Error(`${url}: undecodable`);
      const width = view.readUInt32BE(16),
        height = view.readUInt32BE(20),
        image = { width, height, naturalWidth: width, naturalHeight: height, closed: 0 };
      image.close = () => image.closed++;
      network.images.push(image);
      return image;
    },
  };
  network.options = {
    download: (record) => downloadVerifiedAsset(record, CAVE_ORIGIN, { cache: null, transport }),
    decode: decodeImageWith(page),
  };
  return network;
}
