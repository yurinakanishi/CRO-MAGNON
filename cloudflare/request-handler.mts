import { WORLD } from '../shared/world.mjs';
import { nextDay } from './free-budget.mjs';

interface RequestEnvironment {
  SERVICE_ENABLED?: string;
  ASSETS: { fetch(request: Request): Promise<Response> };
  GAME: {
    getByName(
      name: string,
      options: { locationHint: 'apac' },
    ): {
      fetch(request: Request): Promise<Response>;
    };
  };
}
const ROOM = 'EMBER';
const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** Static solo requests never resolve a Durable Object or open its SQLite store. */
export default {
  async fetch(request: Request, env: RequestEnvironment): Promise<Response> {
    const url = new URL(request.url);
    const online = env.SERVICE_ENABLED === 'true';
    if (url.pathname === '/api/health')
      return json({
        ok: true,
        hosting: 'cloudflare-free',
        worldVersion: WORLD.version,
        mode: online ? 'online' : 'solo',
        maxPlayers: online ? 5 : 1,
        room: online ? ROOM : 'SOLO',
      });
    if (url.pathname === '/api/network') return json({ urls: [], localUrl: url.origin });
    if (url.pathname === '/ws' || url.pathname === '/api/status') {
      // Keep this before every access to GAME, including status and stale clients.
      if (!online) return json({ ok: false, text: '現在はソロプレイのみ利用できます。' }, 503);
      if (request.method !== 'GET') return json({ ok: false }, 405);
      if (url.pathname === '/ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket')
          return json({ ok: false }, 426);
        const origin = request.headers.get('Origin');
        if (origin && origin !== url.origin) return json({ ok: false }, 403);
        const room = url.searchParams.get('room') || ROOM;
        if (room !== ROOM)
          return json({ ok: false, text: '無料公開版の部屋名は EMBER です。' }, 400);
        if (url.search.length > 1000) return json({ ok: false }, 400);
      }
      try {
        return await env.GAME.getByName(ROOM, { locationHint: 'apac' }).fetch(request);
      } catch {
        return json(
          {
            ok: false,
            code: 'FREE_LIMIT',
            text: '無料の利用上限に達したか、保存サービスが利用できません。ゲームを停止しました。時間をおいて再接続してください。',
            retryAt: nextDay(),
          },
          503,
        );
      }
    }
    if (url.pathname.startsWith('/api/')) return json({ ok: false }, 404);
    return env.ASSETS.fetch(request);
  },
};
