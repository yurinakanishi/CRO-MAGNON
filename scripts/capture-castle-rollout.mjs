import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const targets = [{ port: 3000, room: process.argv[2] }];
if(!/^[A-Z0-9_-]{1,16}$/.test(process.argv[2]??''))throw new Error('Pass the verified active room name');
const batch = new Date().toISOString().replace(/[:.]/g, '-');
async function capture({ port, room }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws?${new URLSearchParams({ name: '復旧用記録', room, species: 'cro', gender: 'female' })}`);
    let ownId, saved, settled = false;
    const timeout = setTimeout(() => fail(new Error(`${port}: snapshot timed out`)), 7000);
    function fail(error) { if (settled) return; settled = true; clearTimeout(timeout); socket.terminate(); reject(error); }
    socket.on('error', fail);
    socket.on('message', async bytes => {
      try {
        const data = JSON.parse(bytes.toString());
        if (data.type === 'error') return fail(new Error(`${port}: ${data.code} ${data.text}`));
        if (data.type === 'welcome') ownId = data.id;
        if (saved || !ownId || data.type !== 'state' || !data.resources || !data.camp) return;
        if (data.room !== room) return fail(new Error('Unexpected snapshot room'));
        saved = true;
        const snapshot = { ...data, players: data.players.filter(player => player.id !== ownId) };
        const record = { schemaVersion: 2, port, room, capturedAt: new Date().toISOString(), purpose: 'open-world-rollout', probePlayerExcluded: true, snapshot };
        const destination = new URL(`../output/open-world-restart/castle-port-${port}-${batch}.json`, import.meta.url);
        await writeFile(destination, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
        socket.once('close', () => {
          if (settled) return; settled = true; clearTimeout(timeout);
          resolve({ port, room, path: fileURLToPath(destination), players: snapshot.players.length, resources: snapshot.resources.length, camp: snapshot.camp, animalPhases: snapshot.animals?.map(animal => animal.phase ?? 'legacy') });
        });
        socket.close();
      } catch (error) { fail(error); }
    });
  });
}
console.log(JSON.stringify(await Promise.all(targets.map(capture)), null, 2));
