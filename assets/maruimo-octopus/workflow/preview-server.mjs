import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createGameServer } from '../../../dist/server.mjs';
import { WebSocket } from 'ws';
import { stopActor } from '../../../dist/shared/combat.mjs';
import { BRIDGE } from '../../../dist/shared/scenery-layout.mjs';
import { handleBoatAction } from '../../../dist/shared/boats.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const model = resolve(root, 'output/model-generation/models/maruimo-octopus');
const game = createGameServer({ host: '127.0.0.1', port: Number(process.env.MARUIMO_PORT || 61872) });
const serve = game.server.listeners('request')[0];
game.server.removeListener('request', serve);
const files = {
  '/qa/maruimo': resolve(root, 'assets/maruimo-octopus/workflow/preview.html'),
  '/qa/maruimo/dense.glb': resolve(model, 'work/trellis/dense-attempt-03-res1024-seed0042.glb'),
  '/qa/maruimo/surface.glb': resolve(model, 'work/low-poly/revision-01/candidate.glb'),
  '/qa/maruimo/rig.glb': resolve(model, `work/rig/revision-${process.env.MARUIMO_REVISION || '01'}/candidate.glb`),
};
const peers=[];
game.server.on('request', async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const review=/^\/qa\/maruimo-review\/(\d{2})(?:\/(static|motion)\/([\w-]+\.png))?$/.exec(pathname);
  if(review){
    const base=resolve(model,`qa/final-${review[1]}`);
    if(review[2]){res.writeHead(200,{'Content-Type':'image/png'});res.end(await readFile(resolve(base,review[2],review[3])));}
    else{
      let rows='';for(const folder of ['static','motion'])for(const name of (await readdir(resolve(base,folder))).filter(n=>n.endsWith('.png')).sort())
        rows+=`<figure><figcaption>${name}</figcaption><img src="${pathname}/${folder}/${name}"></figure>`;
      res.writeHead(200,{'Content-Type':'text/html;charset=utf-8'});res.end(`<title>まるぃも r${review[1]} 全方向・動作検査</title><style>body{font:12px system-ui;margin:12px;background:#ddd}.grid{display:grid;grid-template-columns:repeat(5,1fr);gap:8px}figure{margin:0}img{width:100%;display:block}</style><h1>まるぃも r${review[1]} 全方向・動作検査</h1><div class="grid">${rows}</div>`);
    }return;
  }
  if (pathname === '/src/world3d.js') {
    res.writeHead(200, {'Content-Type':'text/javascript;charset=utf-8','Cache-Control':'no-store'});
    res.end(await readFile(resolve(root,'dist/src/world3d.js'),'utf8')+'\n'+await readFile(resolve(root,'assets/maruimo-octopus/workflow/game-observer.js'),'utf8'));return;
  }
  if (pathname === '/qa/maruimo-fixture' && req.method==='POST') {
    try {
      const chunks=[];for await(const part of req)chunks.push(part);
      const {id,kind}=JSON.parse(Buffer.concat(chunks).toString());
      const room=[...game.rooms.values()].find(r=>r.players.has(id));
      if (!room)throw Error('QA player is not connected');
      const player=room.players.get(id);
      if (kind==='peers') {
        const roomName=[...game.rooms].find(([,r])=>r===room)[0];
        if (!peers.length)for(let i=0;i<3;i++)peers.push(new WebSocket(`ws://127.0.0.1:61872/ws?room=${roomName}&name=QA${i}`));
      } else {
        if (player.mountId||player.boatId)throw Error('Dismount using the real control first');
        stopActor(player);Object.assign(player,{pendingStrike:null,attackAt:0,energy:90});
        let point={x:76,z:68};
        if(kind==='pet'||kind==='companion'){
          const companion=kind==='pet'?room.rimoNeko:room.companion524;
          Object.assign(companion,{x:40,z:55,mode:'idle',followPlayerId:null,petPlayerId:null,petAt:0,petContactAt:0,path:[],velocityX:0,velocityZ:0});
          point={x:40,z:56.8};
        } else if(kind==='camp'){
          point={x:room.camp.x+1,z:room.camp.z+1};player.tool=false;player.energy=50;
          Object.assign(player.inventory,{wood:8,stone:7,berry:4});
        } else if(kind==='resource'){
          const resource=room.resources.find(r=>r.type==='berry'&&r.amount>0);point={x:resource.x+.8,z:resource.z};
        } else if(kind==='mammoth'){
          const mammoth=room.animals.find(a=>a.phase==='alive'&&!a.riderId);stopActor(mammoth);
          point={x:mammoth.x+mammoth.radius+player.radius+.15,z:mammoth.z};
        } else if(kind==='bridge')point={x:BRIDGE.x+BRIDGE.minX-1,z:BRIDGE.z};
        else if(kind==='shore')point={x:128,z:124};
        const free=room.collision.nearestFree(point,player.radius,[],4);
        Object.assign(player,{x:free.x,z:free.z,facing:Math.PI});
        if(kind==='shore'){
          player.inventory.wood=24;
          if(!room.boats.length){const built=handleBoatAction(room,player,{action:'craftBoat'},Date.now());if(!built.changed)throw Error(built.text);}
        }
      }
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({fixture:kind,position:[player.x,player.z],people:room.players.size}));
    }catch(error){res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:error.message}));}
    return;
  }
  const revision = /^\/qa\/maruimo\/rig-(\d{2})\.glb$/.exec(pathname);
  const path = revision ? resolve(model, `work/rig/revision-${revision[1]}/candidate.glb`) : files[pathname];
  if (!path) return serve(req, res);
  try {
    const bytes = await readFile(path);
    res.writeHead(200, { 'Content-Type': pathname.endsWith('.glb') ? 'model/gltf-binary' : 'text/html;charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(bytes);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain;charset=utf-8' });
    res.end(error.message);
  }
});
const address = await game.listen();
console.log(JSON.stringify({ pid: process.pid, ...address, preview: `http://127.0.0.1:${address.port}/qa/maruimo` }));
