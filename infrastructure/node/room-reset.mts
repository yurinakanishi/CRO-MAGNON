import type { IncomingMessage, ServerResponse } from 'node:http';

/** This destructive control is only served to the host's own browser. */
export function localResetRequest(request: IncomingMessage): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress ?? ''))
    return false;
  try {
    const url = new URL(`http://${request.headers.host}`);
    return ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  } catch {
    return false;
  }
}

export async function handleRoomReset(
  request: IncomingMessage,
  response: ServerResponse,
  reset: ((room: string, session: string) => Promise<void>) | null,
): Promise<void> {
  const reply = (status: number, value: object) => {
    response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify(value));
  };
  if (!reset || !localResetRequest(request)) {
    reply(403, { error: 'この接続ではリセットできません。' });
    return;
  }
  if (request.method !== 'POST') {
    reply(405, { error: 'POST required' });
    return;
  }
  if (
    request.headers.origin !== `http://${request.headers.host}` ||
    request.headers['content-type']?.split(';')[0] !== 'application/json'
  ) {
    reply(403, { error: 'ゲームの設定画面から操作してください。' });
    return;
  }
  try {
    const body = await new Promise<string>((resolve, reject) => {
      let size = 0;
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size <= 2048) chunks.push(chunk);
      });
      request.on('end', () =>
        size > 2048
          ? reject(new Error('Invalid request'))
          : resolve(Buffer.concat(chunks).toString('utf8')),
      );
      request.on('error', reject);
    });
    const value: unknown = JSON.parse(body);
    if (!value || typeof value !== 'object') throw new Error('Invalid request');
    const { room, session } = value as Record<string, unknown>;
    if (
      typeof room !== 'string' ||
      !/^[A-Z0-9_-]{1,20}$/.test(room) ||
      typeof session !== 'string' ||
      !session ||
      session.length > 256
    )
      throw new Error('Invalid request');
    await reset(room, session);
    reply(200, { ok: true });
  } catch {
    reply(409, {
      error: 'リセットできませんでした。接続と保存状態を確認して、もう一度お試しください。',
    });
  }
}
