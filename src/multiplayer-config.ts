import { parseControllerLayout, type ControllerLayout } from '../shared/controller-layout.mjs';

export interface MultiplayerConfig {
  mode: 'solo' | 'online' | 'lan';
  serverUrl: string;
  room?: string;
  guestName?: string;
  buildId?: string;
  controllerLayout?: ControllerLayout;
  movementRefreshMs?: number;
}

export function parseMultiplayerConfig(value: unknown): MultiplayerConfig {
  if (!value || typeof value !== 'object') throw new Error('接続設定を読み込めません。');
  const config = value as Record<string, unknown>;
  if (!['solo', 'lan', 'online'].includes(String(config.mode)))
    throw new Error('MULTIPLAYER_MODE は solo、lan、online のいずれかにしてください。');
  const serverUrl = typeof config.serverUrl === 'string' ? config.serverUrl : '';
  if (
    config.movementRefreshMs !== undefined &&
    (!Number.isInteger(config.movementRefreshMs) ||
      Number(config.movementRefreshMs) < 70 ||
      Number(config.movementRefreshMs) > 140)
  )
    throw new Error('移動の送信間隔が不正です。');
  if (config.mode === 'lan' && !serverUrl) throw new Error('LANサーバーURLが未設定です。');
  if (serverUrl) {
    const url = new URL(serverUrl);
    if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash)
      throw new Error('接続先は認証情報を含まない ws:// または wss:// URLにしてください。');
    if (config.mode === 'lan' && url.protocol !== 'ws:')
      throw new Error('展示LANでは ws:// を使用してください。');
  }
  return {
    mode: config.mode as MultiplayerConfig['mode'],
    serverUrl,
    room: typeof config.room === 'string' ? config.room : undefined,
    guestName: typeof config.guestName === 'string' ? config.guestName : undefined,
    buildId: typeof config.buildId === 'string' ? config.buildId : undefined,
    controllerLayout: parseControllerLayout(config.controllerLayout),
    ...(config.movementRefreshMs === undefined
      ? {}
      : { movementRefreshMs: Number(config.movementRefreshMs) }),
  };
}

export function multiplayerUrl(
  config: MultiplayerConfig,
  origin: string,
  params: Record<string, string>,
) {
  if (config.mode === 'solo') throw new Error('Solo play has no network connection');
  const url = new URL(config.serverUrl || '/ws', origin.replace(/^http/, 'ws'));
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (config.mode === 'lan') url.searchParams.set('build', config.buildId || '');
  return url.href;
}

export function multiplayerSessionKey(config: MultiplayerConfig, room: string) {
  return config.mode === 'solo'
    ? 'solo:SOLO'
    : config.mode === 'lan'
      ? `lan:${config.serverUrl}:${room}`
      : room;
}

export async function loadMultiplayerConfig(): Promise<MultiplayerConfig> {
  const response = await fetch('/multiplayer-config.json', {
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  // Old online deployments do not yet have a runtime config file.
  if (response.status === 404) return { mode: 'solo', serverUrl: '', room: 'SOLO' };
  if (!response.ok) throw new Error('接続設定を読み込めません。起動ウィンドウを確認してください。');
  const config = parseMultiplayerConfig(await response.json());
  // Online entry is currently disabled, including old deployments' cached config.
  return config.mode === 'lan' ? config : { ...config, mode: 'solo', serverUrl: '', room: 'SOLO' };
}
