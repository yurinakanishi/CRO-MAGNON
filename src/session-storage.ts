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

export function createSessionStore(storage: () => StoragePort) {
  const tokens = new Map<string, string>();
  return {
    read(room: string): string {
      try {
        return tokens.get(room) || storage().getItem(`cro-session:${room}`) || '';
      } catch {
        return tokens.get(room) || '';
      }
    },
    write(room: string, token: string | null | undefined): void {
      if (token) tokens.set(room, token);
      else tokens.delete(room);
      try {
        if (token) storage().setItem(`cro-session:${room}`, token);
        else storage().removeItem(`cro-session:${room}`);
      } catch {
        /* The current page can still reconnect using the in-memory token. */
      }
    },
  };
}

export const { read: readSaved, write: save } = createPreferences(() => localStorage);
export const { read: savedSession, write: saveSession } = createSessionStore(() => sessionStorage);
