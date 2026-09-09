import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:net';
import { copyFile, mkdir, open, readFile, realpath, rename, stat, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';

const FORMAT = 'cro-magnon-local-save';
const MAX_BYTES = 64 * 1024 * 1024;
const hash = (data: string) => createHash('sha256').update(data).digest('hex');
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT';
export class UnsupportedSaveError extends Error {}
export interface SaveStatus {
  enabled: true;
  state: 'pending' | 'saved' | 'error';
  savedAt: number | null;
  recovered: boolean;
}

/** The loopback lease is released by the OS even after a forced process exit.
 * Canonical paths share a lease; a rare port collision fails closed, never allows two writers. */
async function lease(directory: string) {
  const canonical = process.platform === 'win32' ? directory.toLowerCase() : directory;
  const port = 34000 + (createHash('sha256').update(canonical).digest().readUInt32BE(0) % 10000);
  const server = createServer((socket) => socket.destroy());
  await new Promise<void>((resolve, reject) => {
    server.once('error', () =>
      reject(new Error('Save directory is already in use, or its local lock port is unavailable.')),
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
  });
  server.unref();
  return () =>
    new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
}

async function replaceFile(file: string, bytes: Buffer) {
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  try {
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    // A scanner can briefly hold the destination on Windows. Never delete it as a workaround.
    for (let attempt = 0; ; attempt++) {
      try {
        await rename(temporary, file);
        break;
      } catch (e) {
        if (
          attempt >= 5 ||
          !['EPERM', 'EACCES', 'EBUSY'].includes((e as NodeJS.ErrnoException).code ?? '')
        )
          throw e;
        await new Promise((r) => setTimeout(r, 40 * (attempt + 1)));
      }
    }
  } finally {
    await unlink(temporary).catch((e) => {
      if (!missing(e)) throw e;
    });
  }
}

export async function openLocalSave(directory: string, validate: (state: unknown) => void) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  directory = await realpath(directory);
  const release = await lease(directory);
  const primary = path.join(directory, 'world.json'),
    backup = path.join(directory, 'world.backup.json');
  let good: Buffer | null = null,
    revision = 0,
    recovered = false,
    closed = false;
  let queue: Promise<unknown> = Promise.resolve();
  async function read(file: string) {
    const info = await stat(file);
    if (!info.isFile() || info.size > MAX_BYTES) throw new Error('Invalid or oversized save file');
    const bytes = await readFile(file);
    if (bytes.length > MAX_BYTES) throw new Error('Oversized save file');
    const raw = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));
    let state: unknown,
      generation = 0;
    if (raw?.format !== undefined) {
      if (raw.format !== FORMAT || raw.version !== 1)
        throw new UnsupportedSaveError('Unsupported local save format');
      if (!Number.isSafeInteger(raw.revision) || raw.revision < 1 || typeof raw.sha256 !== 'string')
        throw new Error('Invalid save metadata');
      if (hash(JSON.stringify({ revision: raw.revision, state: raw.state })) !== raw.sha256)
        throw new Error('Save checksum mismatch');
      state = raw.state;
      generation = raw.revision;
    } else state = raw; // Existing exportState checkpoints are validated once before upgrading.
    validate(state);
    return { bytes, state, revision: generation };
  }
  let state: unknown = null;
  try {
    let failed: unknown;
    try {
      const loaded = await read(primary);
      good = loaded.bytes;
      state = loaded.state;
      revision = loaded.revision;
    } catch (e) {
      if (e instanceof UnsupportedSaveError) throw e;
      failed = e;
    }
    if (failed) {
      try {
        const loaded = await read(backup);
        // Keep damaged bytes for recovery; do not overwrite them on the next automatic save.
        if (!missing(failed))
          await copyFile(
            primary,
            path.join(directory, `world.corrupt-${Date.now()}-${randomUUID()}.json`),
            constants.COPYFILE_EXCL,
          );
        good = loaded.bytes;
        state = loaded.state;
        revision = loaded.revision;
        recovered = true;
      } catch (e) {
        if (e instanceof UnsupportedSaveError) throw e;
        if (!missing(failed) || !missing(e))
          throw new Error('No usable local save or backup. Original files have been preserved.');
      }
    }
  } catch (e) {
    await release();
    throw e;
  }
  const savedAt = (state as { savedAt?: number } | null)?.savedAt;
  let status: SaveStatus = {
    enabled: true,
    state: good ? 'saved' : 'pending',
    savedAt: Number.isFinite(savedAt) ? savedAt! : null,
    recovered,
  };
  return {
    state,
    status: (): SaveStatus => ({ ...status }),
    save(state: unknown) {
      if (closed) return Promise.reject(new Error('Local save is closed'));
      const payload = JSON.parse(JSON.stringify(state));
      const job = queue
        .then(async () => {
          const next = revision + 1;
          const bytes = Buffer.from(
            JSON.stringify({
              format: FORMAT,
              version: 1,
              revision: next,
              sha256: hash(JSON.stringify({ revision: next, state: payload })),
              state: payload,
            }),
          );
          if (bytes.length > MAX_BYTES)
            throw new Error('Local save exceeds 64 MiB; previous save retained');
          if (good) await replaceFile(backup, good);
          await replaceFile(primary, bytes);
          good = bytes;
          revision = next;
          status = { enabled: true, state: 'saved', savedAt: payload.savedAt, recovered };
        })
        .catch((error) => {
          status = { ...status, state: 'error' };
          throw error;
        });
      queue = job.catch(() => {});
      return job;
    },
    async close() {
      if (closed) return;
      closed = true;
      await queue;
      await release();
    },
  };
}
