// Path rules: sources only from public/models, candidates only into a new revision
// folder under assets/optimized-runtime/ or output/. Links may not escape either root.
import { existsSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// r02 (standalone cave textures) failed visual QA on the startup faces; r03 (retained faces,
// adopted LOD bodies) failed on the bodies. Both stay on disk as evidence; r04 carries the
// source-derived startup bodies. A revision is never reused.
export const DEFAULT_REVISION = 'assets/optimized-runtime/20261009-r04';
export const OUTPUT_ROOTS = Object.freeze(['assets/optimized-runtime', 'output']);
const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const SOURCE_URL = /^\/models\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)+[A-Za-z0-9][A-Za-z0-9._-]*\.glb$/;
// Standalone textures sit directly in one model folder, as the public build requires.
const IMAGE_URL = /^\/models\/[a-z0-9-]+\/[A-Za-z0-9][A-Za-z0-9._-]*\.(png|jpe?g|webp)$/;
const CANDIDATE_FILE =
  /^models\/(?:[A-Za-z0-9][A-Za-z0-9._-]*\/)+[A-Za-z0-9][A-Za-z0-9._-]*\.opt-[0-9a-f]{16}\.(?:glb|png|jpe?g|webp)$/;

const toPosix = (value) => value.split(path.sep).join('/');
export const isInside = (parent, child) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};
const sameOrInside = (parent, child) => path.relative(parent, child) === '' || isInside(parent, child);

function nearestExisting(target) {
  let current = target;
  while (!existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
  return current;
}

export function resolveRevisionDirectory(root, requested = DEFAULT_REVISION) {
  if (typeof requested !== 'string' || !requested.trim()) throw new Error('A revision directory is required');
  const absolute = path.resolve(root, requested),
    relative = toPosix(path.relative(root, absolute));
  if (!isInside(root, absolute)) throw new Error(`Revision directory ${requested} is outside the repository`);
  const allowed = OUTPUT_ROOTS.find((candidate) => relative.startsWith(`${candidate}/`));
  if (!allowed)
    throw new Error(`Revision directory must be a new folder under ${OUTPUT_ROOTS.join('/ or ')}/ (got ${relative})`);
  if (relative.slice(allowed.length + 1).split('/').some((segment) => !SEGMENT.test(segment)))
    throw new Error(`Revision directory ${relative} has an unsafe path segment`);
  const realRoot = realpathSync.native(root),
    existing = nearestExisting(absolute),
    realExisting = realpathSync.native(existing),
    allowedAbsolute = path.join(root, ...allowed.split('/'));
  if (!sameOrInside(realRoot, realExisting))
    throw new Error(`Revision directory ${relative} resolves outside the repository through a link`);
  if (sameOrInside(allowedAbsolute, existing)) {
    const realAllowed = realpathSync.native(allowedAbsolute);
    if (!isInside(realRoot, realAllowed)) throw new Error(`${allowed} is linked outside the repository`);
    if (!sameOrInside(realAllowed, realExisting))
      throw new Error(`Revision directory ${relative} resolves outside ${allowed} through a link`);
  }
  return { absolute, relative };
}

/** Absolute path of a manifest URL such as /models/key/model.glb inside public/models. */
export function resolveSourceFile(root, url) {
  if (typeof url !== 'string' || !SOURCE_URL.test(url)) throw new Error(`Unsafe model URL ${url}`);
  const modelsRoot = path.join(root, 'public', 'models'),
    absolute = path.join(root, 'public', ...url.slice(1).split('/'));
  if (!isInside(modelsRoot, absolute)) throw new Error(`Model URL ${url} resolves outside public/models`);
  return absolute;
}

/** Absolute path of a standalone texture URL such as /models/key/atlas.png inside public/models. */
export function resolveSourceImage(root, url) {
  if (typeof url !== 'string' || !IMAGE_URL.test(url)) throw new Error(`Unsafe image URL ${url}`);
  const modelsRoot = path.join(root, 'public', 'models'),
    absolute = path.join(root, 'public', ...url.slice(1).split('/'));
  if (!isInside(modelsRoot, absolute)) throw new Error(`Image URL ${url} resolves outside public/models`);
  return absolute;
}

/** Content-addressed standalone texture candidate, same folder and extension as its source. */
export function imageCandidateLocation(sourceUrl, sha256) {
  const match = IMAGE_URL.exec(sourceUrl);
  if (!match) throw new Error(`Unsafe image URL ${sourceUrl}`);
  const name = sourceUrl.slice(sourceUrl.lastIndexOf('/') + 1, -(match[1].length + 1)),
    file = `${sourceUrl.slice(1, sourceUrl.lastIndexOf('/'))}/${name}.opt-${sha256.slice(0, 16)}.${match[1]}`;
  return { file, url: `/${file}` };
}

/** Absolute path of a candidate file recorded relative to its revision directory. */
export function resolveCandidateFile(revisionAbsolute, file) {
  if (typeof file !== 'string' || !CANDIDATE_FILE.test(file)) throw new Error(`Unsafe candidate path ${file}`);
  const absolute = path.join(revisionAbsolute, ...file.split('/'));
  if (!isInside(revisionAbsolute, absolute)) throw new Error(`Candidate path ${file} escapes the revision`);
  return absolute;
}

/** Content-addressed candidate path and URL next to the source's directory. */
export function candidateLocation(sourceUrl, sha256, name = null) {
  const directory = sourceUrl.slice('/models/'.length, sourceUrl.lastIndexOf('/')),
    base = name ?? sourceUrl.slice(sourceUrl.lastIndexOf('/') + 1, -'.glb'.length),
    file = `models/${directory}/${base}.opt-${sha256.slice(0, 16)}.glb`;
  return { file, url: `/${file}` };
}
