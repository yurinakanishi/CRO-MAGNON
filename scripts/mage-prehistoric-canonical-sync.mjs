// Usage (run only after generation and QA have stopped writing the source):
// node scripts/mage-prehistoric-canonical-sync.mjs plan
// node scripts/mage-prehistoric-canonical-sync.mjs copy --report assets/mage-prehistoric-canonical-sync.json
// node scripts/mage-prehistoric-canonical-sync.mjs verify
// Plan creation is workspace-only. Copy is the only mode that writes the sibling
// repository. It consumes the exact reviewed plan and never replaces a file.
import { constants } from 'node:fs';
import { lstat, realpath, readdir, mkdir, open, copyFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const KEY = 'floppy-ear-mage';
const DEFAULT_WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const comparePath = value => process.platform === 'win32' ? path.resolve(value).toLowerCase() : path.resolve(value);
const samePath = (a, b) => comparePath(a) === comparePath(b);

async function statOrMissing(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// Inspect all existing components, including the workspace / sibling ancestors.
// lstat rejects symlinks and Windows junctions; realpath catches redirections
// whose platform-specific reparse type is not reported as a symbolic link.
async function safePath(file, { missing = false, directory = false } = {}) {
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root, lastExisting = root, absent = false, last;
  for (const component of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, component);
    if (absent) continue;
    const info = await statOrMissing(current);
    if (!info) { if (!missing) throw new Error(`Missing path: ${current}`); absent = true; continue; }
    if (info.isSymbolicLink()) throw new Error(`Linked or redirected path rejected: ${current}`);
    if (!samePath(current, absolute) && !info.isDirectory()) throw new Error(`Non-directory ancestor: ${current}`);
    last = info; lastExisting = current;
  }
  if (!samePath(await realpath(lastExisting), lastExisting)) throw new Error(`Linked or redirected path rejected: ${lastExisting}`);
  if (!absent && directory && !last?.isDirectory()) throw new Error(`Expected directory: ${absolute}`);
  return absent ? null : last;
}

function relativeFile(root, relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0') || relative.split('/').some(part => !part || part === '.' || part === '..')) throw new Error(`Invalid relative path: ${relative}`);
  const resolved = path.resolve(root, ...relative.split('/'));
  const tail = path.relative(root, resolved);
  if (!tail || tail.startsWith(`..${path.sep}`) || tail === '..' || path.isAbsolute(tail)) throw new Error(`Path escaped ${KEY}: ${relative}`);
  return resolved;
}

async function fingerprint(file) {
  const info = await safePath(file);
  if (!info?.isFile()) throw new Error(`Expected regular file: ${file}`);
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.ino !== info.ino || before.dev !== info.dev) throw new Error(`File changed before read: ${file}`);
    const hash = createHash('sha256'), buffer = Buffer.allocUnsafe(256 * 1024);
    let bytes = 0;
    while (true) {
      const result = await handle.read(buffer, 0, buffer.length, null);
      if (!result.bytesRead) break;
      bytes += result.bytesRead; hash.update(buffer.subarray(0, result.bytesRead));
    }
    const after = await handle.stat();
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs) throw new Error(`File changed while hashing: ${file}`);
    await safePath(file);
    return { bytes, sha256: hash.digest('hex') };
  } finally { await handle.close(); }
}

async function tree(root, { allowMissing = false } = {}) {
  const exists = await safePath(root, { missing: allowMissing, directory: true });
  const files = [], directories = [];
  if (!exists) return { files, directories };
  async function walk(relative = '') {
    const folder = relative ? relativeFile(root, relative) : root;
    for (const entry of (await readdir(folder, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const name = relative ? `${relative}/${entry.name}` : entry.name;
      const file = relativeFile(root, name), info = await safePath(file);
      if (info.isDirectory()) { directories.push(name); await walk(name); }
      else if (info.isFile()) files.push({ path: name, ...await fingerprint(file) });
      else throw new Error(`Unsupported source entry: ${file}`);
    }
  }
  await walk();
  return { files, directories };
}

const equivalent = (a, b) => a.bytes === b.bytes && a.sha256 === b.sha256;
const digestPlan = plan => createHash('sha256').update(JSON.stringify(plan)).digest('hex');

// The optional workspace parameter supports isolated fixture tests. The CLI has
// no source/destination override and always uses this repository's exact paths.
export function createMagePrehistoricSync(workspace = DEFAULT_WORKSPACE) { return createModelSync('crow-shaman', workspace); }

export function createModelSync(modelKey, workspace = DEFAULT_WORKSPACE) {
  if (!['crow-shaman','cat-kunoichi','bear-mage','kunoichi-katana','snow-ground','ice-ground','desert-ground','volcanic-ground','glacier-spires','volcanic-cone','desert-cactus','volcanic-basalt-columns','valley-castle','floppy-ear-mage'].includes(modelKey)) throw new Error('Unsupported canonical model key');
  const KEY=modelKey;
  workspace = path.resolve(workspace);
  if (path.basename(workspace) !== 'CRO-MAGNON') throw new Error('Workspace must be CRO-MAGNON');
  const source = path.join(workspace, 'output', 'model-generation', 'models', KEY, 'work', 'candidate-02');
  const canonical = path.join(path.dirname(workspace), 'threed-model-creation', 'models');
  const destination = path.join(canonical, KEY, 'work', 'candidate-02');

  async function roots() {
    await safePath(workspace, { directory: true });
    await safePath(source, { directory: true });
    await safePath(canonical, { directory: true });
    await safePath(destination, { missing: true, directory: true });
    if (await statOrMissing(path.join(workspace, 'output', 'model-generation', 'models', 'world-trellis.lock'))) throw new Error('Finish the active TRELLIS generation before planning or copying');
  }

  function validatePlan(plan) {
    if (plan?.schemaVersion !== 1 || plan.modelKey !== KEY || !samePath(plan.workspaceRoot, workspace) || !samePath(plan.sourceRoot, source) || !samePath(plan.destinationRoot, destination) || !Array.isArray(plan.files) || !Array.isArray(plan.directories) || !plan.files.length) throw new Error(`Plan does not match the fixed ${KEY} source and destination`);
    const names = new Set();
    for (const entry of [...plan.directories.map(name => ({ path: name, directory: true })), ...plan.files]) {
      relativeFile(source, entry.path); relativeFile(destination, entry.path);
      const identity = process.platform === 'win32' ? entry.path.toLowerCase() : entry.path;
      if (names.has(identity)) throw new Error(`Duplicate plan entry: ${entry.path}`);
      names.add(identity);
      if (!entry.directory && (!Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || !/^[0-9a-f]{64}$/.test(entry.sha256))) throw new Error(`Invalid fingerprint: ${entry.path}`);
    }
  }

  async function destinationState(plan, required = false) {
    const actual = await tree(destination, { allowMissing: true });
    const expected = new Map(plan.files.map(entry => [entry.path, entry]));
    const actualFiles = new Map(actual.files.map(entry => [entry.path, entry]));
    for (const entry of actual.files) {
      if (!expected.has(entry.path)) throw new Error(`Unexpected destination file retained; refusing merge: ${entry.path}`);
      if (!equivalent(entry, expected.get(entry.path))) throw new Error(`Existing canonical file differs; refusing overwrite: ${entry.path}`);
    }
    const expectedDirs = new Set(plan.directories);
    for (const directory of actual.directories) if (!expectedDirs.has(directory)) throw new Error(`Unexpected destination directory retained: ${directory}`);
    for (const entry of plan.files) {
      const target = relativeFile(destination, entry.path);
      const info = await safePath(target, { missing: true });
      if (info && !info.isFile()) throw new Error(`File destination is not a file: ${target}`);
      if (required && !actualFiles.has(entry.path)) throw new Error(`Destination file missing: ${entry.path}`);
    }
    for (const directory of plan.directories) {
      const info = await safePath(relativeFile(destination, directory), { missing: !required, directory: true });
      if (required && !info) throw new Error(`Destination directory missing: ${directory}`);
    }
    return actualFiles;
  }

  async function confirmSource(plan) {
    const current = await tree(source);
    if (JSON.stringify(current.directories) !== JSON.stringify(plan.directories) || current.files.length !== plan.files.length) throw new Error('Source tree changed after planning; make a new plan');
    const expected = new Map(plan.files.map(entry => [entry.path, entry]));
    for (const entry of current.files) if (!expected.has(entry.path) || !equivalent(entry, expected.get(entry.path))) throw new Error(`Source changed after planning: ${entry.path}`);
  }

  async function plan() {
    await roots();
    const current = await tree(source);
    if (!current.files.length) throw new Error('Source tree is empty');
    const result = { schemaVersion: 1, modelKey: KEY, generatedAt: new Date().toISOString(), status: 'planned-not-copied', workspaceRoot: workspace, sourceRoot: source, destinationRoot: destination, ...current };
    validatePlan(result);
    const existing = await destinationState(result);
    result.fileCount = result.files.length; result.totalBytes = result.files.reduce((sum, file) => sum + file.bytes, 0);
    result.existingEqualFiles = existing.size; result.newFiles = result.files.length - existing.size;
    return result;
  }

  async function verify(plan) {
    validatePlan(plan); await roots(); await confirmSource(plan); await destinationState(plan, true);
    return { schemaVersion: 1, modelKey: KEY, status: 'all-source-and-destination-hashes-verified', verifiedAt: new Date().toISOString(), planSha256: digestPlan(plan), sourceRoot: source, destinationRoot: destination, files: plan.files.length, bytes: plan.files.reduce((sum, entry) => sum + entry.bytes, 0) };
  }

  async function copy(plan) {
    validatePlan(plan); await roots(); await confirmSource(plan);
    const existing = await destinationState(plan);
    // Entire preflight succeeds before the first write to the sibling directory.
    for (const folder of [destination, ...plan.directories.map(name => relativeFile(destination, name))]) {
      await safePath(folder, { missing: true, directory: true });
      try { await mkdir(folder); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      await safePath(folder, { directory: true });
    }
    let copied = 0, skipped = 0;
    for (const entry of plan.files) {
      const from = relativeFile(source, entry.path), to = relativeFile(destination, entry.path);
      if (!equivalent(await fingerprint(from), entry)) throw new Error(`Source changed before copy: ${entry.path}`);
      const info = await safePath(to, { missing: true });
      if (info) {
        if (!info.isFile() || !equivalent(await fingerprint(to), entry)) throw new Error(`Existing canonical file differs; refusing overwrite: ${entry.path}`);
        skipped++; continue;
      }
      await safePath(path.dirname(to), { directory: true });
      await copyFile(from, to, constants.COPYFILE_EXCL);
      if (!equivalent(await fingerprint(to), entry)) throw new Error(`Copied hash mismatch; retained without overwrite: ${entry.path}`);
      copied++;
    }
    const receipt = await verify(plan);
    return { ...receipt, status: 'copied-and-all-source-and-destination-hashes-verified', copied, skippedEqual: skipped, preflightExistingEqual: existing.size };
  }
  return { source, destination, plan, copy, verify };
}

async function main() {
  const [mode, ...args] = process.argv.slice(2);
  if (!['plan', 'copy', 'verify'].includes(mode)) throw new Error('Usage: mage-prehistoric-canonical-sync.mjs plan|copy|verify [--plan assets/mage-prehistoric-canonical-sync-plan.json] [--report assets/mage-prehistoric-canonical-sync.json]');
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!['--plan', '--report'].includes(args[i]) || !args[i + 1] || options[args[i]]) throw new Error('Unknown, duplicate or incomplete option');
    options[args[i]] = args[i + 1];
  }
  function reportPath(value) {
    const result = path.resolve(DEFAULT_WORKSPACE, value);
    if (!samePath(path.dirname(result), path.join(DEFAULT_WORKSPACE, 'assets')) || !/^mage-prehistoric-canonical-sync[^/\\]*\.json$/.test(path.basename(result))) throw new Error('Plans and reports must be assets/mage-prehistoric-canonical-sync*.json');
    return result;
  }
  async function writeExclusive(file, value) {
    await safePath(path.dirname(file), { directory: true }); await safePath(file, { missing: true });
    const handle = await open(file, 'wx');
    try { await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`); } finally { await handle.close(); }
  }
  const sync = createMagePrehistoricSync(), planFile = reportPath(options['--plan'] || 'assets/mage-prehistoric-canonical-sync-plan.json');
  let result;
  if (mode === 'plan') { result = await sync.plan(); await writeExclusive(planFile, result); }
  else {
    await safePath(planFile);
    const handle = await open(planFile, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    let plan; try { plan = JSON.parse(await handle.readFile('utf8')); } finally { await handle.close(); }
    result = await sync[mode](plan);
  }
  if (options['--report']) await writeExclusive(reportPath(options['--report']), result);
  console.log(JSON.stringify(result, null, 2));
}

if (process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url))) main().catch(error => { console.error(error.message); process.exitCode = 1; });
