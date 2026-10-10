import * as THREE from 'three';
import { downloadVerifiedAsset, type AssetFile } from './asset-download.js';
import { LoadCancelled } from './asset-load-queue.js';
import {
  caveMuralImages,
  caveUvSource,
  type CaveExtraKey,
  type CaveImageRecord,
} from './cave-gallery-layout.js';

/** A served image as its manifest records it: the exact file and its decoded size. */
export type VerifiedImageRecord = AssetFile & {
  readonly image: { readonly width: number; readonly height: number };
};

/** What a decoder made: the source a texture uploads, and its decoded size. */
export type DecodedImage = {
  readonly image: any;
  readonly width: number;
  readonly height: number;
};

/** The record's bytes, verified. The default, downloadVerifiedAsset, accepts only
 * this game's origin, the exact length and SHA-256, through its verified cache. */
export type ImageDownload = (record: AssetFile) => Promise<ArrayBuffer>;
export type ImageDecoder = (
  bytes: ArrayBuffer,
  record: VerifiedImageRecord,
) => Promise<DecodedImage>;
export type VerifiedTextureOptions = { download?: ImageDownload; decode?: ImageDecoder };
export type TextureSettings = {
  colorSpace: THREE.ColorSpace;
  anisotropy: number;
  /** RepeatWrapping on both axes; otherwise Three's default clamp. */
  repeat?: boolean;
};

/** What decoding needs from the page. */
export type ImagePage = {
  createObjectURL(blob: Blob): string;
  revokeObjectURL(url: string): void;
  /** An HTMLImageElement for the URL, as THREE.TextureLoader gets one. */
  load(url: string): Promise<any>;
};

const browserPage: ImagePage = {
  createObjectURL: (blob) => URL.createObjectURL(blob),
  revokeObjectURL: (url) => URL.revokeObjectURL(url),
  load: (url) => new THREE.ImageLoader().loadAsync(url),
};

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
};

/** Decode verified bytes as THREE.TextureLoader decodes a served file: an image
 * element from THREE.ImageLoader, so orientation (flipY), alpha and colour handling
 * stay the same. Its blob URL is revoked once the element has loaded or failed. */
export function decodeImageWith(page: ImagePage = browserPage): ImageDecoder {
  return async (bytes, record) => {
    const extension = /\.([a-z0-9]+)$/i.exec(new URL(record.url, 'file:///').pathname)?.[1];
    const type = MIME[extension?.toLowerCase() ?? ''] ?? '';
    const url = page.createObjectURL(new Blob([bytes], { type }));
    try {
      const image = await page.load(url).catch(() => {
        throw new Error(`${record.url}: the verified image could not be decoded`);
      });
      return {
        image,
        width: image.naturalWidth ?? image.width,
        height: image.naturalHeight ?? image.height,
      };
    } finally {
      page.revokeObjectURL(url);
      // ImageLoader keeps images in THREE.Cache when it is enabled: never these.
      THREE.Cache.remove(`image:${url}`);
    }
  };
}

export const decodeImage = decodeImageWith();

/** Fails, before anything is requested, unless `record` names an exact file and size. */
export function checkImageRecord(record, where = record?.url): VerifiedImageRecord {
  if (typeof record?.url !== 'string' || !record.url)
    throw new Error(`${where}: the manifest records no image`);
  if (
    typeof record.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(record.sha256) ||
    !Number.isSafeInteger(record.bytes) ||
    record.bytes <= 0
  )
    throw new Error(`${where}: the manifest records no SHA-256 and length for ${record.url}`);
  const { width, height } = record.image ?? {};
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0)
    throw new Error(`${where}: the manifest records no image size for ${record.url}`);
  return record;
}

/** Release a texture this module made, once: its GPU copy, its decoded image
 * (closed where it can be) and the texture's hold on it. Never for a texture
 * another owner shares. Lost-context cleanup only disposes; it never calls this. */
export function releaseVerifiedTexture(texture: THREE.Texture) {
  texture.dispose();
  const image = texture.image as { close?: () => void } | null;
  texture.image = null;
  image?.close?.();
}

/** One verified image as a texture made as THREE.TextureLoader makes one. The bytes
 * are checked (origin, length, SHA-256) before decoding and the decoded size against
 * the record; anything else rejects. Nothing unverified is returned. */
export async function loadVerifiedTexture(
  record: VerifiedImageRecord,
  settings: TextureSettings,
  {
    download = (file) => downloadVerifiedAsset(file),
    decode = decodeImage,
  }: VerifiedTextureOptions = {},
): Promise<THREE.Texture> {
  checkImageRecord(record);
  const decoded = await decode(await download(record), record);
  const { width, height } = record.image;
  if (decoded.width !== width || decoded.height !== height) {
    decoded.image?.close?.();
    throw new Error(
      `${record.url}: decoded ${decoded.width}x${decoded.height}, the manifest records ${width}x${height}`,
    );
  }
  const texture = new THREE.Texture();
  texture.image = decoded.image;
  texture.needsUpdate = true;
  texture.colorSpace = settings.colorSpace;
  texture.anisotropy = settings.anisotropy;
  if (settings.repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  return texture;
}

/** Verified textures loaded together. `ready` settles once: when every one is made,
 * or with the first failure. Until take() hands them over the batch owns what it
 * made and keeps it in `textures`, where lost-context cleanup reaches it. After a
 * failure or cancel() it releases each texture once, late arrivals included. */
export class VerifiedTextureBatch<K extends string> {
  readonly textures = new Map<K, THREE.Texture>();
  readonly ready: Promise<void>;
  /** The entry whose failure ended the batch. */
  failedKey: K | null = null;
  private ended = false;
  private taken = false;
  private readonly count: number;
  private readonly abandon: (error: unknown) => void;

  constructor(
    entries: ReadonlyArray<readonly [K, VerifiedImageRecord, TextureSettings]>,
    options: VerifiedTextureOptions = {},
  ) {
    let resolve!: () => void, reject!: (error: unknown) => void;
    this.ready = new Promise<void>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    // Owners observe it; a batch nobody awaits any more never rejects unhandled.
    this.ready.catch(() => {});
    this.abandon = reject;
    this.count = entries.length;
    if (!entries.length) resolve();
    for (const [key, record, settings] of entries)
      loadVerifiedTexture(record, settings, options).then(
        (texture) => {
          if (this.ended) releaseVerifiedTexture(texture);
          else if (this.textures.set(key, texture).size === this.count) resolve();
        },
        (error) => {
          if (this.ended) return;
          this.failedKey = key;
          this.end();
          reject(error);
        },
      );
  }

  /** Every texture, once all are made. The caller owns them from now on. */
  take(): Record<K, THREE.Texture> {
    if (this.ended || this.taken || this.textures.size !== this.count)
      throw new Error('Verified textures are not ready');
    this.taken = true;
    const textures = Object.fromEntries(this.textures) as Record<K, THREE.Texture>;
    this.textures.clear();
    return textures;
  }

  /** The owner left: release what was made and whatever still arrives. */
  cancel() {
    if (this.ended || this.taken) return;
    this.end();
    this.abandon(new LoadCancelled('verified textures', 'their owner left'));
  }

  private end() {
    this.ended = true;
    for (const texture of this.textures.values()) releaseVerifiedTexture(texture);
    this.textures.clear();
  }
}

export type CaveTextureKey =
  'pigment' | 'rockSurface' | 'characterPigment' | 'rimoPigment' | CaveExtraKey;

/** The camp-cave manifest's ten standalone images, each an exact file with its size;
 * the murals are also checked against the rectangles that sample them. */
export function caveImageRecords(asset): Record<CaveTextureKey, VerifiedImageRecord> {
  const murals = caveMuralImages(asset);
  const rock: CaveImageRecord = asset?.rockSurface;
  if (typeof rock?.url !== 'string' || !rock.url)
    throw new Error('camp-cave rockSurface: the manifest records no image');
  caveUvSource(rock, 'camp-cave rockSurface');
  const records: Record<CaveTextureKey, VerifiedImageRecord> = {
    pigment: murals.pigment,
    rockSurface: rock,
    characterPigment: murals.characterPigment,
    rimoPigment: murals.rimoPigment,
    ...murals.extras,
  };
  for (const [key, record] of Object.entries(records)) {
    const where = key in murals.extras ? `mascotPigments.${key}` : key;
    checkImageRecord(record, `camp-cave ${where}`);
  }
  return records;
}

/** The cave's ten standalone images as verified sRGB textures, set up as the
 * TextureLoader ones were: anisotropic, the limestone repeating, the rest clamped. */
export function loadCaveTextures(asset, anisotropy: number, options: VerifiedTextureOptions = {}) {
  const records = caveImageRecords(asset);
  const entries = (Object.keys(records) as CaveTextureKey[]).map((key) => {
    const repeat = key === 'rockSurface';
    const settings: TextureSettings = { colorSpace: THREE.SRGBColorSpace, anisotropy, repeat };
    return [key, records[key], settings] as const;
  });
  return new VerifiedTextureBatch(entries, options);
}
