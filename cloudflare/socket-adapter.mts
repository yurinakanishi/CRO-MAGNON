import type { GameConnection, SocketEvents } from '../application/ports.mjs';

interface HostSocket {
  readonly readyState: number;
  readonly bufferedAmount?: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

/** Queue outgoing messages until the Worker has committed durable state. */
export class GameSocket implements GameConnection {
  readonly ws: HostSocket;
  readonly listeners = new Map<keyof SocketEvents, unknown>();
  readonly pending: string[] = [];
  lastMessage: number;
  private readonly now: () => number;

  constructor(ws: HostSocket, now: () => number = () => Date.now()) {
    this.ws = ws;
    this.now = now;
    this.lastMessage = now();
  }
  get readyState(): number {
    return this.ws.readyState;
  }
  get bufferedAmount(): number {
    return this.ws.bufferedAmount || 0;
  }
  on<K extends keyof SocketEvents>(type: K, handler: (...args: SocketEvents[K]) => void): void {
    this.listeners.set(type, handler);
  }
  emit<K extends keyof SocketEvents>(type: K, ...args: SocketEvents[K]): void {
    const handler = this.listeners.get(type) as ((...args: SocketEvents[K]) => void) | undefined;
    handler?.(...args);
  }
  send(data: string): void {
    this.pending.push(data);
  }
  flush(): void {
    for (const data of this.pending.splice(0)) if (this.readyState === 1) this.ws.send(data);
  }
  close(code = 1000, reason = ''): void {
    this.flush();
    this.ws.close(code, reason);
  }
  terminate(): void {
    this.close(4000, 'Connection timeout');
  }
  ping(): void {
    if (this.now() - this.lastMessage < 45000) this.emit('pong');
    else this.terminate();
  }
}
