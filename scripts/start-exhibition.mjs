import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { spawn } from 'node:child_process';
import { WebSocket } from 'ws';
import { readSettings } from './exhibition-config.mjs';
import { verifyExhibition } from './exhibition-integrity.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const role = process.argv[2];
let game,
  client,
  timer,
  stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  clearInterval(timer);
  if (client) await client.close();
  if (game) await game.close();
}
export async function probeServer(settings, buildId) {
  const url = new URL(settings.serverUrl);
  // The health endpoint is tiny; game assets are never requested from PC1.
  url.protocol = 'http:';
  url.pathname = '/api/health';
  url.search = '';
  const response = await fetch(url, { signal: AbortSignal.timeout(2500) });
  if (!response.ok) throw new Error(`Server health HTTP ${response.status}`);
  const health = await response.json();
  if (health.mode !== 'lan' || health.buildId !== buildId)
    throw new Error('Build mismatch: copy the SAME exhibition folder to both PCs.');
  return health;
}
async function main() {
  if (!['host', 'client'].includes(role))
    throw new Error('Use start-exhibition-host.bat or start-exhibition-client.bat.');
  console.log(`CRO-MAGNON Exhibition / LAN - ${role === 'host' ? 'PC1 Host' : 'PC2 Client'}`);
  console.log('Verifying local game assets and offline runtime...');
  const manifest = await verifyExhibition(root);
  const settings = await readSettings(root);
  if (settings.serverPort === settings.clientPort)
    throw new Error('Server port and CLIENT_PORT must differ.');
  const addresses = Object.values(networkInterfaces())
    .flat()
    .filter((n) => n?.family === 'IPv4')
    .map((n) => n.address);
  console.log(`Build: ${manifest.buildId.slice(0, 16)} | Local IPv4: ${addresses.join(', ')}`);
  console.log(`Multiplayer: ${settings.serverUrl} | Room: ${settings.room}`);
  if (role === 'host' && !addresses.includes(settings.host))
    throw new Error(
      `PC1 Ethernet does not have ${settings.host}. Configure the static Ethernet IP first (README-EXHIBITION.md). No server was started.`,
    );
  if (role === 'host') {
    const { createGameServer } = await import('../dist/server.mjs');
    game = createGameServer({
      port: settings.serverPort,
      host: '0.0.0.0',
      serveAssets: false,
      expectedBuild: manifest.buildId,
      wsPaths: [settings.wsPath],
      allowedOrigins: [
        `http://localhost:${settings.clientPort}`,
        `http://127.0.0.1:${settings.clientPort}`,
      ],
    });
    await game.listen();
    console.log(`Server listening on 0.0.0.0:${settings.serverPort} (synchronization only)`);
  }
  const { createExhibitionClient } =
    await import('../dist/infrastructure/node/exhibition-client.mjs');
  client = createExhibitionClient({
    root,
    port: settings.clientPort,
    config: {
      mode: settings.mode,
      serverUrl: settings.serverUrl,
      room: settings.room,
      guestName: role === 'host' ? 'Player 1' : 'Player 2',
      buildId: manifest.buildId,
    },
  });
  await client.listen();
  const localUrl = `http://localhost:${settings.clientPort}/`;
  console.log(`Local game: ${localUrl} (assets rendered on this PC)`);
  let lastStatus = '';
  let probing = false;
  const status = async () => {
    if (probing || stopping) return;
    probing = true;
    try {
      const health = await probeServer(settings, manifest.buildId);
      const message = `Server reachable at ${settings.serverUrl} | Players: ${health.players} | Rooms: ${health.rooms}`;
      if (message !== lastStatus) console.log(message);
      lastStatus = message;
    } catch (error) {
      const message = `LAN: Waiting - ${error.message}. Check PC1, Ethernet IP and Private Firewall TCP ${settings.serverPort}.`;
      if (message !== lastStatus) console.log(message);
      lastStatus = message;
    } finally {
      probing = false;
    }
  };
  await status();
  // Confirm that the configured WS path and origin reach the game, without joining a room.
  if (role === 'host') {
    await new Promise((resolve, reject) => {
      const socket = new WebSocket(settings.serverUrl, {
        origin: `http://localhost:${settings.clientPort}`,
        handshakeTimeout: 2500,
      });
      socket.once('message', (data) => {
        const message = JSON.parse(data.toString());
        socket.close();
        if (message.code === 'BUILD_MISMATCH') resolve();
        else reject(new Error('Unexpected WebSocket handshake response.'));
      });
      socket.once('error', reject);
    });
    console.log(
      'WebSocket endpoint verified locally. Confirm LAN: Connected on PC2 to verify the cable/firewall path.',
    );
  }
  timer = setInterval(status, 5000);
  console.log(
    'Choose Start, then depart into the valley on BOTH screens. Look for LAN: Connected.',
  );
  console.log(
    'Keep this window open. Ctrl+C stops this launcher and its own servers. Host stop resets the in-memory exhibition world.',
  );
  if (settings.openBrowser) {
    // URL is generated from a validated numeric loopback port, never shell input.
    const browser = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', localUrl], {
      windowsHide: true,
      stdio: 'ignore',
    });
    browser.on('error', () => console.log(`Open ${localUrl} in Chrome or Edge.`));
    browser.unref();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.once('SIGINT', () => void stop());
  process.once('SIGTERM', () => void stop());
  main().catch(async (error) => {
    console.error(`\nLAN startup failed: ${error.message}`);
    if (error.code === 'EADDRINUSE')
      console.error(
        'Port already in use. Close the previous exhibition launcher or edit MULTIPLAYER_SERVER_URL / CLIENT_PORT on BOTH PCs. Other processes were not stopped.',
      );
    await stop();
    process.exitCode = 1;
  });
}
