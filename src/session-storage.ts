export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Browser privacy settings may deny even obtaining a Storage object. */
export function createPreferences(storage: () => StoragePort) {
  return {
    read(key: string, fallback: string): string {
      try {
        return storage().getItem(key) || fallback;
      } catch {
        return fallback;
      }
    },
    write(key: string, value: string): void {
      try {
        storage().setItem(key, value);
      } catch {
        /* Preferences are optional. */
      }
    },
  };
}

export function createSessionStore(
  storage: () => StoragePort,
  persistentStorage?: () => StoragePort,
) {
  const tokens = new Map<string, string>();
  return {
    read(room: string): string {
      if (tokens.has(room)) return tokens.get(room)!;
      let token = '';
      try {
        token = storage().getItem(`cro-session:${room}`) || '';
      } catch {}
      if (!token)
        try {
          token = persistentStorage?.().getItem(`cro-resume:${room}`) || '';
        } catch {}
      return token;
    },
    write(room: string, token: string | null | undefined, durable = false): boolean {
      // An empty entry also masks inaccessible stale storage during an explicit reset.
      tokens.set(room, token || '');
      try {
        if (token) storage().setItem(`cro-session:${room}`, token);
        else storage().removeItem(`cro-session:${room}`);
      } catch {
        /* The current page can still reconnect using the in-memory token. */
      }
      try {
        if (durable && token) {
          if (!persistentStorage) return false;
          persistentStorage().setItem(`cro-resume:${room}`, token);
        } else persistentStorage?.().removeItem(`cro-resume:${room}`);
      } catch {
        return false;
      }
      return true;
    },
  };
}

export const { read: readSaved, write: save } = createPreferences(() => localStorage);
export const { read: savedSession, write: saveSession } = createSessionStore(
  () => sessionStorage,
  () => localStorage,
);
