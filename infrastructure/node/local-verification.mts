import path from 'node:path';
import { ENVIRONMENTS } from '../../shared/environment-profile.mjs';

export function localVerificationSettings(
  root: string,
  portValue: string | number = ENVIRONMENTS.local.port,
) {
  const port = Number(portValue);
  if (!Number.isInteger(port) || port < 1024 || port > 65535)
    throw new Error('Invalid local verification port');
  const profile = ENVIRONMENTS.local;
  return {
    port,
    host: '127.0.0.1',
    environment: profile.id,
    exhibition: false,
    enableRoomReset: true,
    saveDirectory: path.join(root, profile.storage),
    runtimeConfig: { mode: 'online', serverUrl: '', room: profile.room },
  };
}
