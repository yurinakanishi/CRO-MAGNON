// Keep the existing, tested game protocol independent of the host WebSocket API.
export class GameSocket {
  constructor(ws) { this.ws = ws; this.listeners = new Map(); this.pending = []; this.lastMessage = Date.now(); }
  get readyState() { return this.ws.readyState; }
  get bufferedAmount() { return this.ws.bufferedAmount || 0; }
  on(type, handler) { this.listeners.set(type, handler); }
  emit(type, ...args) { this.listeners.get(type)?.(...args); }
  send(data) { this.pending.push(data); }
  flush() { for (const data of this.pending.splice(0)) if (this.readyState === 1) this.ws.send(data); }
  close(code = 1000, reason = '') { this.flush(); this.ws.close(code, reason); }
  terminate() { this.close(4000, 'Connection timeout'); }
  ping() { if (Date.now() - this.lastMessage < 45000) this.emit('pong'); else this.terminate(); }
}
