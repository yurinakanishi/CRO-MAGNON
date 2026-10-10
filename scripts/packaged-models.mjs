// Model files of an offline (exhibition or local) package. A packed template's levels are scenes
// of one GLB, so a package holds and checks each physical file once, while the runtime graph
// keeps every logical level record with its scene.
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { sha256 } from './exhibition-integrity.mjs';
import { MESHOPT_EXTENSION, checkModelUrl, glbFileExtensionsRequired } from './runtime-graph.mjs';

const fileIdentity = ({ url, sha256, bytes, scene, parts }) => [
  url,
  sha256,
  bytes,
  scene ?? null,
  Array.isArray(parts)
    ? parts.map((part) => [part?.url, part?.sha256, part?.bytes])
    : (parts ?? null),
];

/** The runtime files a model manifest names, as one comparable value: each level's file
 * identity (URL, SHA-256, length, parts) and scene, then its runtime textures. */
export function runtimeFiles(record, textureRecords) {
  return JSON.stringify([
    [record, ...(record.lods || [])].map(fileIdentity),
    textureRecords(record).map(({ url, sha256, bytes }) => [url, sha256, bytes]),
  ]);
}

/**
 * Check each physical model file of `runtimeGraph` (checkRuntimeGraph) once under `root`: its
 * URL, SHA-256 and length. Every logical record must be served by exactly one checked file of
 * its identity. Returns the package-relative files, in graph order, and whether any needs the
 * meshopt decoder.
 */
export async function checkPhysicalModels(root, runtimeGraph) {
  const physical = new Map(),
    files = [];
  let compressed = false;
  for (const model of runtimeGraph.physicalModels) {
    if (physical.has(model.url)) throw new Error(`${model.url} is listed as two physical files`);
    physical.set(model.url, model);
    checkModelUrl(model.url, model.sha256);
    const file = `public${model.url}`,
      absolute = path.join(root, file);
    if ((await sha256(absolute)) !== model.sha256 || (await stat(absolute)).size !== model.bytes)
      throw new Error(`Model integrity failed: ${file}`);
    if ((await glbFileExtensionsRequired(absolute, file)).includes(MESHOPT_EXTENSION))
      compressed = true;
    files.push(file);
  }
  const named = new Map();
  for (const record of runtimeGraph.models) {
    const file = physical.get(record.url);
    if (!file || file.sha256 !== record.sha256 || file.bytes !== record.bytes)
      throw new Error(
        `${record.modelKey}: ${record.url} is not a checked physical file of its identity`,
      );
    named.set(record.url, (named.get(record.url) ?? 0) + 1);
  }
  for (const [url, file] of physical)
    if (named.get(url) !== file.records)
      throw new Error(`${url}: ${file.records} level records listed, ${named.get(url) ?? 0} found`);
  return { files, compressed };
}
