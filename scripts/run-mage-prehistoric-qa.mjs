import {createGameServer} from '../server.mjs';
import {writeFile} from 'node:fs/promises';
const game=createGameServer({port:0,host:'127.0.0.1'});await game.listen();
const url=`http://127.0.0.1:${game.address().port}`;
await writeFile('output/mage-prehistoric-qa-server.json',JSON.stringify({pid:process.pid,url,startedAt:new Date().toISOString()})+'\n');
console.log(url);
let stopping=false;async function stop(){if(stopping)return;stopping=true;await game.close();process.exit(0);}
process.stdin.setEncoding('utf8');process.stdin.on('data',s=>{if(s.trim()==='q')void stop();});process.stdin.resume();
process.once('SIGINT',()=>void stop());process.once('SIGTERM',()=>void stop());
