// Build outputs are replaced whole: written to a dot-prefixed sibling, then renamed over the
// target, so the server or a test reading dist/ during a build gets the previous file or the
// new one, never a truncated one. serveStatic refuses dot-prefixed path segments, the
// packagers skip them (and .tmp is no served or packaged extension), and the dev watcher
// ignores .tmp.
//
// Windows refuses to replace a file that any handle has open (EPERM from MoveFileExW, even
// though libuv opens files with FILE_SHARE_DELETE), so the rename is retried until the
// readers have closed it: an in-flight read finishes on the old file, the next one opens
// the new file. A file kept open past the deadline fails the write and is left unchanged.
import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const TEMPORARY = /^\..+\.\d+\.\d+\.tmp$/;
const BUSY = new Set(['EPERM', 'EACCES', 'EBUSY']);
let sequence = 0;

/** Replace `file` with `data` in one rename; parent directories are created. */
export async function writeFileAtomic(file, data, { deadlineMs = 10000 } = {}) {
  const directory = path.dirname(file);
  const temporary = path.join(
    directory,
    `.${path.basename(file)}.${process.pid}.${++sequence}.tmp`,
  );
  await mkdir(directory, { recursive: true });
  try {
    await writeFile(temporary, data);
    const deadline = Date.now() + deadlineMs;
    for (let delay = 1; ; delay = Math.min(delay * 2, 25)) {
      try {
        await rename(temporary, file);
        return;
      } catch (error) {
        if (process.platform !== 'win32' || !BUSY.has(error?.code)) throw error;
        if (Date.now() >= deadline)
          throw new Error(
            `${file} could not be replaced within ${deadlineMs} ms (${error.code}); another process keeps it open. It was left unchanged.`,
            { cause: error },
          );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Write every `[file, data]` pair, 16 at a time (well inside open-file limits); the first
 * failure is thrown once every write has finished or cleaned up.
 */
export async function writeFilesAtomic(entries, options) {
  const queue = [...entries];
  const failures = [];
  const writer = async () => {
    while (queue.length) {
      const [file, data] = queue.shift();
      await writeFileAtomic(file, data, options).catch((error) => failures.push(error));
    }
  };
  await Promise.all(Array.from({ length: 16 }, writer));
  if (failures.length) throw failures[0];
}

/**
 * Remove temporaries a killed build left in `directory` (the dev watcher kills a build it no
 * longer needs). Only names this module makes, and only ones older than any live write.
 */
export async function removeStaleTemporaries(directory, { olderThanMs = 60000 } = {}) {
  const entries = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const cutoff = Date.now() - olderThanMs;
  for (const name of entries) {
    if (!TEMPORARY.test(name)) continue;
    const file = path.join(directory, name);
    const info = await stat(file).catch(() => null);
    if (info?.isFile() && info.mtimeMs < cutoff) await rm(file, { force: true });
  }
}
