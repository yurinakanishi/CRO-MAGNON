import { sha256 } from './asset-hash.js';

export interface AssetFile {
  url: string;
  bytes: number;
  sha256: string;
}
export interface AssetDownload extends AssetFile {
  parts?: AssetFile[];
}

/** Reassemble large public GLBs without changing geometry, textures or animation. */
export async function downloadVerifiedAsset(
  record: AssetDownload,
  origin = location.origin,
): Promise<ArrayBuffer> {
  const validate = (file: AssetFile) => {
    const url = new URL(file.url, origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol))
      throw new Error('Models must be served by this game');
    if (!Number.isSafeInteger(file.bytes) || file.bytes <= 0 || file.bytes > 256 * 1024 * 1024)
      throw new Error(`${file.url}: invalid file length`);
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error(`${file.url}: invalid SHA-256`);
    return url;
  };
  const download = async (file: AssetFile) => {
    const response = await fetch(validate(file));
    if (!response.ok) throw new Error(`${file.url}: HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();
    if (bytes.byteLength !== file.bytes) throw new Error(`${file.url}: file length mismatch`);
    if ((await sha256(bytes)) !== file.sha256) throw new Error(`${file.url}: SHA-256 mismatch`);
    return bytes;
  };
  validate(record);
  if (!record.parts) return download(record);
  if (!Array.isArray(record.parts) || !record.parts.length || record.parts.length > 16)
    throw new Error(`${record.url}: invalid model parts`);
  for (const part of record.parts) validate(part);
  if (record.parts.reduce((sum, part) => sum + part.bytes, 0) !== record.bytes)
    throw new Error(`${record.url}: model part lengths do not match`);
  const bytes = new Uint8Array(record.bytes);
  let offset = 0;
  // Keep peak memory bounded while the world loads several models concurrently.
  for (const part of record.parts) {
    bytes.set(new Uint8Array(await download(part)), offset);
    offset += part.bytes;
  }
  if ((await sha256(bytes)) !== record.sha256) throw new Error(`${record.url}: SHA-256 mismatch`);
  return bytes.buffer;
}
