import {createGameServer} from '../dist/server.mjs';
import {CHARACTER_MODELS} from '../dist/shared/characters.mjs';
import {createRimoNeko,hitRimoNeko} from '../dist/shared/rimo-neko.mjs';
import {BRIDGE} from '../dist/shared/scenery-layout.mjs';
import {stopActor} from '../dist/shared/combat.mjs';
import {WebSocket} from 'ws';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const out=process.argv[2]??'output/rimo-neko-c2-game';await mkdir(out,{recursive:true});
const game=createGameServer({port:0,host:'127.0.0.1'}),old=game.server.listeners('request'),peers=[],captures=[],records=[],initial=new Set();
const appended=await readFile('assets/rimo-neko/workflow/game-review-c2.js','utf8');
game.server.removeAllListeners('request');
game.server.on('request',async(req,res)=>{try{const url=new URL(req.url,'http://localhost');
if(url.pathname==='/src/world3d.js'){const original=await readFile('dist/src/world3d.js','utf8');res.writeHead(200,{'Content-Type':'text/javascript','Cache-Control':'no-store'}).end(original+'\n'+appended);return;}
if(url.pathname==='/qa-c2/characters'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(CHARACTER_MODELS));return;}
if(url.pathname==='/qa-c2/status'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({peers:peers.map(p=>p.state),captures:captures.length,records:records.length}));return;}
if(url.pathname.startsWith('/qa-c2/')&&req.method==='POST'){if(req.headers.origin!==`http://127.0.0.1:${game.server.address().port}`)throw Error('origin');const chunks=[];let size=0;for await(const c of req){size+=c.length;if(size>18e6)throw Error('size');chunks.push(c);}const body=JSON.parse(Buffer.concat(chunks));const room=game.rooms.get('RIMO-C2');
if(url.pathname==='/qa-c2/fixture'){const p=room?.players.get(body.id);if(!p)throw Error('player');stopActor(p);
if(body.fixture==='pet'){const character=CHARACTER_MODELS.find(c=>c.key===body.character);if(!character)throw Error('character');Object.assign(p,{species:character.species,gender:character.gender,x:40,z:56.8,facing:Math.PI,move:{dx:0,dz:0}});Object.assign(room.rimoNeko,createRimoNeko(room.collision),{x:40,z:55,facing:0,home:{x:51,z:53}});}
else if(body.fixture==='follow'){Object.assign(p,{x:room.rimoNeko.x,z:room.rimoNeko.z+6,facing:0,move:{dx:0,dz:0}});}
else if(body.fixture==='hit'){hitRimoNeko(room.rimoNeko,0,1,Date.now());}
else if(body.fixture==='bridge'){const c=room.rimoNeko;Object.assign(c,{x:BRIDGE.x,z:BRIDGE.z,followPlayerId:p.id,facing:0,mode:'following',path:[],velocityX:0,velocityZ:0,petPlayerId:null});Object.assign(p,{x:c.x,z:c.z+6,move:{dx:0,dz:0}});}
else throw Error('fixture');res.end('prepared');return;}
if(url.pathname==='/qa-c2/capture'){const image=Buffer.from(body.image.split(',')[1],'base64');if(image.readUInt32BE(0)!==0x89504e47)throw Error('PNG');const file=`${out}/${Date.now()}-${body.view}.png`;await writeFile(file,image);delete body.image;captures.push({...body,file,imageSha256:createHash('sha256').update(image).digest('hex'),peers:peers.map(p=>p.state)});await writeFile(`${out}/captures.json`,JSON.stringify(captures,null,2)+'\n');res.end('保存済み '+captures.length);return;}
if(url.pathname==='/qa-c2/record'){records.push(body);await writeFile(`${out}/records.json`,JSON.stringify(records,null,2)+'\n');res.end('動作記録済み '+body.frames.length+'フレーム');return;}}
for(const listener of old)await listener(req,res);
}catch(e){res.writeHead(500).end(String(e));console.error(e);}});
const {port}=await game.listen();
for(let i=0;i<3;i++){const peer={name:`C2Peer${i}`,state:{}};peers.push(peer);peer.ws=new WebSocket(`ws://127.0.0.1:${port}/ws?room=RIMO-C2&name=${peer.name}`);peer.ws.on('message',data=>{const m=JSON.parse(String(data));if(m.type==='state')peer.state={players:m.players?.length,cat:m.rimoNeko};});}
const timer=setInterval(()=>{const room=game.rooms.get('RIMO-C2');if(!room)return;room.enemies=[];for(const p of room.players.values())if(!initial.has(p.id)){stopActor(p);Object.assign(p,p.name.startsWith('C2Peer')?{x:70,z:50}:{x:51,z:54.8,facing:Math.PI});initial.add(p.id);}},100);
async function close(){clearInterval(timer);for(const p of peers)p.ws.close();await game.close();process.exit(0);}
process.on('SIGINT',close);setTimeout(close,40*60*1000).unref();
console.log(`RIMO_C2_GAME http://127.0.0.1:${port}/?room=RIMO-C2 PID ${process.pid}`);
