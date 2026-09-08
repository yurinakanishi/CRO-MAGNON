/** The application owns these ports; host adapters supply their implementations. */
export interface Runtime {
  now(): number;
  id(): string;
  token(): string;
}

export interface SocketEvents {
  message: [data: { toString(): string }, isBinary: boolean];
  pong: [];
  close: [];
  error: [error?: unknown];
}

export interface GameConnection {
  readonly readyState: number;
  readonly bufferedAmount: number;
  on<K extends keyof SocketEvents>(type: K, handler: (...args: SocketEvents[K]) => void): unknown;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  terminate?(): void;
  ping?(): void;
}

export const defaultRuntime: Runtime = {
  now: () => Date.now(),
  id: () => crypto.randomUUID(),
  token: () =>
    Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) =>
      n.toString(16).padStart(2, '0'),
    ).join(''),
};
