import { readFile } from 'node:fs/promises';
import path from 'node:path';

export function parseSettings(text) {
  const values = {};
  for (const line of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith('#')) continue;
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!match) throw new Error(`Invalid exhibition setting: ${line}`);
    values[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return values;
}

export async function readSettings(root, env = process.env) {
  const values = parseSettings(await readFile(path.join(root, 'exhibition.env'), 'utf8'));
  try {
    Object.assign(
      values,
      parseSettings(await readFile(path.join(root, 'exhibition.local.env'), 'utf8')),
    );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  for (const key of Object.keys(values)) if (env[key] !== undefined) values[key] = env[key];
  if (values.MULTIPLAYER_MODE !== 'lan')
    throw new Error('Exhibition launchers require MULTIPLAYER_MODE=lan. Use npm start for Online.');
  const url = new URL(values.MULTIPLAYER_SERVER_URL);
  // A literal local IPv4 address prevents accidental WAN/DNS dependence.
  const octets = url.hostname.split('.').map(Number);
  const local =
    octets.length === 4 &&
    octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255) &&
    (octets[0] === 10 ||
      octets[0] === 127 ||
      (octets[0] === 169 && octets[1] === 254) ||
      (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) ||
      (octets[0] === 192 && octets[1] === 168));
  if (url.protocol !== 'ws:' || !local || url.username || url.password || url.search || url.hash)
    throw new Error(
      'MULTIPLAYER_SERVER_URL must be ws:// with a literal LAN IPv4 address and optional path/port.',
    );
  const clientPort = Number(values.CLIENT_PORT);
  if (!Number.isInteger(clientPort) || clientPort < 1024 || clientPort > 65535)
    throw new Error('CLIENT_PORT must be 1024..65535.');
  const room = values.EXHIBITION_ROOM;
  if (!/^[A-Z0-9_-]{1,16}$/.test(room))
    throw new Error('EXHIBITION_ROOM must be 1..16 uppercase letters/digits/_/-.');
  return {
    mode: 'lan',
    serverUrl: url.href,
    host: url.hostname,
    serverPort: Number(url.port || 80),
    wsPath: url.pathname,
    clientPort,
    room,
    openBrowser: values.OPEN_BROWSER !== '0',
  };
}
