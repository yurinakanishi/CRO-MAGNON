/** Browser-only checkpoints. No network or server storage is involved. */
export const SOLO_DATABASE = 'cro-magnon-solo';
export const SOLO_STORE = 'checkpoints';
export class UnsupportedSoloSave extends Error {}
export interface SoloData {
  session: string;
  game: { version: number; worldVersion: number; rooms: unknown[]; savedAt: number };
}
interface RecordEnvelope {
  version: 1;
  revision: number;
  payload: string;
  sha256: string;
}
const digest = async (text: string) =>
  Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))),
    (value) => value.toString(16).padStart(2, '0'),
  ).join('');

export async function encodeSoloSave(data: SoloData, revision: number): Promise<RecordEnvelope> {
  const payload = JSON.stringify(data);
  return { version: 1, revision, payload, sha256: await digest(payload) };
}

export async function decodeSoloSave(value: unknown): Promise<SoloData> {
  const record = value as RecordEnvelope;
  if (record?.version > 1) throw new UnsupportedSoloSave('Newer solo save format');
  if (
    record?.version !== 1 ||
    !Number.isSafeInteger(record.revision) ||
    record.revision < 1 ||
    typeof record.payload !== 'string' ||
    record.sha256 !== (await digest(record.payload))
  )
    throw new Error('Invalid solo checkpoint');
  const data = JSON.parse(record.payload) as SoloData;
  if (data?.game?.version > 1) throw new UnsupportedSoloSave('Newer solo world format');
  if (
    !data ||
    typeof data.session !== 'string' ||
    !data.game ||
    data.game.version !== 1 ||
    !Array.isArray(data.game.rooms) ||
    data.game.rooms.length > 1
  )
    throw new Error('Invalid solo world');
  return data;
}

export interface SoloSavePort {
  load(validate: (data: SoloData) => void): Promise<{ data: SoloData | null; recovered: boolean }>;
  write(data: SoloData): Promise<void>;
  close(): void;
}

export async function openSoloSave(factory: IDBFactory = indexedDB): Promise<SoloSavePort> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = factory.open(SOLO_DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(SOLO_STORE);
    request.onsuccess = () => (blocked ? request.result.close() : resolve(request.result));
    request.onerror = () => reject(request.error);
    request.onblocked = () => {
      blocked = true;
      reject(new Error('Solo save is open in an older tab'));
    };
  });
  db.onversionchange = () => db.close();
  let good: RecordEnvelope | null = null;
  let revision = 0;
  let loaded = false;
  return {
    async load(validate) {
      loaded = false;
      const records = await new Promise<unknown[]>((resolve, reject) => {
        const tx = db.transaction(SOLO_STORE, 'readonly');
        const store = tx.objectStore(SOLO_STORE);
        const current = store.get('current'),
          previous = store.get('previous');
        tx.oncomplete = () => resolve([current.result, previous.result]);
        tx.onabort = () => reject(tx.error ?? new Error('Could not read solo save'));
        tx.onerror = () => {};
      });
      // An older build must never replace a newer format with its older backup.
      if (records.some((record) => (record as RecordEnvelope)?.version > 1))
        throw new UnsupportedSoloSave('Newer solo save format; update the game before continuing');
      for (const [index, record] of records.entries()) {
        if (record === undefined) continue;
        try {
          const data = await decodeSoloSave(record);
          validate(data);
          good = record as RecordEnvelope;
          revision = good.revision;
          loaded = true;
          return { data, recovered: index > 0 };
        } catch (error) {
          if (error instanceof UnsupportedSoloSave) throw error;
          /* Try the last validated checkpoint; never overwrite either on load failure. */
        }
      }
      if (records.some((record) => record !== undefined))
        throw new Error('No usable solo save or backup; both have been preserved');
      loaded = true;
      return { data: null, recovered: false };
    },
    async write(data) {
      if (!loaded) throw new Error('Read the previous solo save before writing');
      const next = await encodeSoloSave(data, revision + 1);
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(SOLO_STORE, 'readwrite', { durability: 'strict' });
        const store = tx.objectStore(SOLO_STORE);
        if (good) store.put(good, 'previous');
        store.put(next, 'current');
        // A put's success is not a committed transaction (quota or I/O can still fail).
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error ?? new Error('Could not commit solo save'));
        tx.onerror = () => {};
      });
      good = next;
      revision = next.revision;
    },
    close: () => db.close(),
  };
}
