// Texture planning, the hidden Pillow worker and re-embedding of resized images.
// Formats never change (PNG stays PNG, WebP stays WebP), so EXT_texture_webp keeps
// referring only to real WebP data; nothing is upscaled.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repackViews, sha256, storedViewBytes } from './glb.mjs';
import { imageSemantics } from './gltf-usage.mjs';
import { MIME_BY_FORMAT, sniffImage, targetDimensions } from './images.mjs';

export const RESIZE_SCRIPT = fileURLToPath(new URL('./texture-resize.py', import.meta.url));
// The same installed runtime the earlier public-performance tooling used.
export const DEFAULT_PYTHON =
  'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
export const ALLOWED_EDGES = Object.freeze([1024, 512]);
const FILE_EXTENSION = Object.freeze({ png: 'png', jpeg: 'jpg', webp: 'webp' });

const isColour = (treatment) => treatment === 'color-opaque' || treatment === 'color-alpha';
// The edge each treatment is held to. An image no material samples keeps the colour edge: only
// sampled normal and data maps may be held to a stricter edge than colour.
const EDGE_CLASS = Object.freeze({
  'color-opaque': 'color',
  'color-alpha': 'color',
  unreferenced: 'color',
  normal: 'normal',
  data: 'data',
});

/** `{ color, normal, data }` maximum edges, from one edge for every image or a per-class object. */
export function textureEdges(edge, label = 'textures') {
  const edges = typeof edge === 'number' ? { color: edge, normal: edge, data: edge } : edge;
  if (
    !edges ||
    typeof edges !== 'object' ||
    Object.keys(edges).sort().join() !== 'color,data,normal'
  )
    throw new Error(`${label}: texture edges must be one edge or { color, normal, data }`);
  for (const value of Object.values(edges))
    if (!ALLOWED_EDGES.includes(value))
      throw new Error(`${label}: texture edge ${value} must be 1024 or 512`);
  return { color: edges.color, normal: edges.normal, data: edges.data };
}

export const maximumEdgeOf = (edges) => Math.max(edges.color, edges.normal, edges.data);

export function treatmentEdge(edges, treatment, label) {
  if (!Object.hasOwn(EDGE_CLASS, treatment))
    throw new Error(`${label}: unknown texture treatment ${treatment}`);
  return edges[EDGE_CLASS[treatment]];
}

export function encodingOf(info, webpQuality) {
  if (info.format === 'png') return 'png-lossless-optimized';
  if (info.format === 'jpeg') return 'jpeg-source-quantization-tables';
  return info.webp.lossless ? 'webp-lossless-exact' : `webp-lossy-q${webpQuality}-exact`;
}

/** What the worker's output is checked against (checkResizedImage). */
export const sourceSummary = (info, data) => ({
  width: info.width,
  height: info.height,
  bytes: data.length,
  sha256: sha256(data),
  alpha: info.alpha,
  ...(info.webp ? { webpLossless: info.webp.lossless } : {}),
  ...(info.png ? { pngColorChunks: info.png.colorChunks, pngBitDepth: info.png.bitDepth } : {}),
  ...(info.jpeg ? { jpegComponents: info.jpeg.components } : {}),
});

/** One resize job. Identical source bytes and settings always map to one output (deduplicated by
 * content). `wrap: 'repeat'` (textures sampled with repeat wrapping) filters across opposite edges;
 * it is only added when needed, so clamp-to-edge jobs keep their keys. */
export function resizeJob(
  info,
  source,
  target,
  { treatment, colorFilter, webpQuality, wrap = 'clamp' },
) {
  if (wrap !== 'clamp' && wrap !== 'repeat') throw new Error(`unknown wrap ${wrap}`);
  const job = {
    format: info.format,
    sourceWidth: info.width,
    sourceHeight: info.height,
    width: target.width,
    height: target.height,
    treatment,
    filter: isColour(treatment) ? colorFilter : 'box',
    webp: info.webp ? { lossless: info.webp.lossless, quality: webpQuality } : null,
    ...(wrap === 'repeat' ? { wrap } : {}),
  };
  return { key: sha256(JSON.stringify({ source: source.sha256, ...job })), ...job, expect: source };
}

/** Decide every image's treatment, maximum edge and target size. `edge` is one edge for every image
 * or `{ color, normal, data }` (textureEdges). Throws on mislabeled or ambiguous images. */
export function planTextures(
  json,
  bin,
  { label, edge, colorFilter = 'lanczos', webpQuality = 90 },
) {
  const edges = textureEdges(edge, label);
  if (colorFilter !== 'lanczos' && colorFilter !== 'box')
    throw new Error(`${label}: unknown colour filter ${colorFilter}`);
  const semantics = imageSemantics(json, label),
    sniffed = (json.images ?? []).map((image, index) => {
      const data = storedViewBytes(json, bin, image.bufferView);
      let info;
      try {
        info = sniffImage(data);
      } catch (error) {
        throw new Error(`${label}: image ${index}: ${error.message}`);
      }
      if (MIME_BY_FORMAT[info.format] !== image.mimeType)
        throw new Error(
          `${label}: image ${index} is declared ${image.mimeType} but holds ${info.format} data`,
        );
      return { data, info };
    }),
    warnings = [];
  (json.textures ?? []).forEach((texture, index) => {
    const webp = texture.extensions?.EXT_texture_webp?.source;
    if (webp !== undefined && sniffed[webp].info.format !== 'webp')
      throw new Error(
        `${label}: texture ${index} EXT_texture_webp source ${webp} is not WebP data`,
      );
    if (texture.source !== undefined && sniffed[texture.source].info.format === 'webp')
      warnings.push(
        `texture ${index} uses WebP image ${texture.source} as its core source (pre-existing; preserved)`,
      );
  });
  const images = (json.images ?? []).map((image, index) => {
    const { data, info } = sniffed[index],
      { treatment, uses, warnings: notes } = semantics[index],
      maximumEdge = treatmentEdge(edges, treatment, `${label}: image ${index}`),
      target = targetDimensions(info.width, info.height, maximumEdge),
      filter =
        treatment === 'normal' ? 'box-renormalized' : isColour(treatment) ? colorFilter : 'box',
      item = {
        index,
        bufferView: image.bufferView,
        mimeType: image.mimeType,
        format: info.format,
        treatment,
        maximumEdge,
        uses: uses.map((use) => `material ${use.material} ${use.slot}`),
        source: sourceSummary(info, data),
        resized: target.resized,
        target: { width: target.width, height: target.height },
        filter: target.resized ? filter : 'none',
        encoding: target.resized ? encodingOf(info, webpQuality) : 'unchanged-bytes',
        warnings: notes,
        job: null,
      };
    if (target.resized)
      item.job = resizeJob(info, item.source, target, { treatment, colorFilter, webpQuality });
    return item;
  });
  return { images, warnings };
}

export async function stageTextureInput(workDir, job, data) {
  const file = path.join(workDir, 'in', `${job.key}.${FILE_EXTENSION[job.format]}`);
  if (existsSync(file)) return file;
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data, { flag: 'wx' });
  return file;
}

/** Output checks that do not depend on trusting the worker. */
export function checkResizedImage(job, bytes) {
  const info = sniffImage(bytes),
    expect = job.expect,
    fail = (message) => {
      throw new Error(`resized image ${job.key.slice(0, 12)}: ${message}`);
    };
  if (info.format !== job.format) fail(`format ${info.format} differs from ${job.format}`);
  if (info.width !== job.width || info.height !== job.height)
    fail(`is ${info.width}x${info.height}, planned ${job.width}x${job.height}`);
  if (info.width > expect.width || info.height > expect.height) fail('was upscaled');
  if (info.alpha !== expect.alpha) fail(`alpha channel ${expect.alpha ? 'lost' : 'added'}`);
  if (info.webp && info.webp.lossless !== expect.webpLossless)
    fail('WebP lossless/lossy mode changed');
  if (info.png && info.png.colorChunks.join() !== (expect.pngColorChunks ?? []).join())
    fail(`PNG colour chunks changed (${info.png.colorChunks.join() || 'none'})`);
  // Pillow reads 16-bit RGB PNGs as 8-bit RGB; never accept that loss silently.
  if (info.png && info.png.bitDepth < expect.pngBitDepth)
    fail(`PNG bit depth dropped from ${expect.pngBitDepth} to ${info.png.bitDepth}`);
  if (info.jpeg && info.jpeg.components !== expect.jpegComponents)
    fail('JPEG component count changed');
  return info;
}

/** Run all resize jobs in one hidden Python process and return the verified outputs. */
export async function runTextureJobs(jobs, { python, isolated = true, workDir }) {
  const outputs = new Map();
  if (!jobs.length) return { outputs, toolchain: null };
  await mkdir(path.join(workDir, 'out'), { recursive: true });
  const list = jobs.map((job) => ({
      id: job.key,
      input: path.join(workDir, 'in', `${job.key}.${FILE_EXTENSION[job.format]}`),
      output: path.join(workDir, 'out', `${job.key}.${FILE_EXTENSION[job.format]}`),
      format: job.format,
      sourceWidth: job.sourceWidth,
      sourceHeight: job.sourceHeight,
      width: job.width,
      height: job.height,
      treatment: job.treatment,
      filter: job.filter,
      webp: job.webp,
      ...(job.wrap ? { wrap: job.wrap } : {}),
    })),
    jobFile = path.join(workDir, 'jobs.json');
  await writeFile(jobFile, JSON.stringify({ jobs: list }));
  const result = spawnSync(python, [...(isolated ? ['-I'] : []), RESIZE_SCRIPT, jobFile], {
    encoding: 'utf8',
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error)
    throw new Error(`texture worker could not start ${python}: ${result.error.message}`);
  if (result.status !== 0)
    throw new Error(
      `texture worker exited with ${result.status ?? result.signal}: ${(result.stderr ?? '').trim().slice(-4000)}` +
        (isolated
          ? ' (if Pillow lives in user site-packages, retry with --python-unisolated)'
          : ''),
    );
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(`texture worker printed invalid JSON: ${result.stdout.slice(0, 400)}`);
  }
  for (const [index, job] of jobs.entries()) {
    const bytes = await readFile(list[index].output);
    checkResizedImage(job, bytes);
    outputs.set(job.key, bytes);
  }
  return {
    outputs,
    toolchain: { python: report.python, pillow: report.pillow, webp: report.webp ?? null },
  };
}

/** Re-embed resized images; every other view keeps its exact bytes and index. */
export function applyTextures(json, bin, plan, outputs, label) {
  const replacements = new Map();
  for (const item of plan) {
    if (!item.job) continue;
    const bytes = outputs.get(item.job.key);
    if (!bytes) throw new Error(`${label}: no resized output for image ${item.index}`);
    const previous = replacements.get(item.bufferView);
    if (previous && previous !== bytes)
      throw new Error(
        `${label}: images sharing buffer view ${item.bufferView} need different outputs`,
      );
    replacements.set(item.bufferView, bytes);
  }
  const repacked = repackViews(json, bin, replacements),
    images = plan.map((item) => {
      const bytes = item.job
          ? outputs.get(item.job.key)
          : storedViewBytes(json, bin, item.bufferView),
        info = sniffImage(bytes);
      return {
        index: item.index,
        mimeType: item.mimeType,
        treatment: item.treatment,
        maximumEdge: item.maximumEdge,
        filter: item.filter,
        encoding: item.encoding,
        resized: item.resized,
        source: item.source,
        output: {
          width: info.width,
          height: info.height,
          bytes: bytes.length,
          sha256: sha256(bytes),
        },
        uses: item.uses,
        warnings: item.warnings,
      };
    });
  return { ...repacked, images };
}
