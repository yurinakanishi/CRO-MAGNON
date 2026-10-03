// Read-only model review UI, operated with CUA. Only loopback capture output.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const revision=process.argv[2]??'01';if(!/^\d{2}$/.test(revision))throw Error('revision');
const base='output/model-generation/models/rimo-neko/candidate-2',source=`${base}/work/rig/revision-${revision}/candidate.glb`,out=`${base}/qa/rig-${revision}/browser`;
fs.mkdirSync(out,{recursive:true});
const hash=createHash('sha256').update(fs.readFileSync(source)).digest('hex');
const metadata={candidate:2,surface:'01',rig:revision,source,sha256:hash};let captures=0;
const server=http.createServer(async(req,res)=>{try{const u=new URL(req.url,'http://localhost');
if(req.method==='POST'){if(req.headers.origin!==`http://127.0.0.1:${server.address().port}`)throw Error('origin');const chunks=[];let count=0;for await(const c of req){count+=c.length;if(count>8e6)throw Error('size');chunks.push(c);}const body=JSON.parse(Buffer.concat(chunks));
if(u.pathname==='/capture'){if(!/^(Idle_Loop|Walk_Loop|Run_Loop|Pet|Happy|Hit|Hiss)$/.test(body.clip)||![0,90,180].includes(body.view)||!Number.isInteger(body.frame)||body.frame<0||body.frame>5)throw Error('capture');const data=Buffer.from(body.image.split(',')[1],'base64');const index=[0,90,180].indexOf(body.view)*6+body.frame;fs.writeFileSync(`${out}/${body.clip}-${String(index).padStart(2,'0')}.jpg`,data,{flag:'wx'});captures++;res.end('ok');return;}
if(u.pathname==='/finish'){if(captures!==126||body.sourceSha256!==hash||body.errors.length)throw Error('incomplete review');for(const clip of body.clips)execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-n','-i',`${out}/${clip}-%02d.jpg`,'-vf','scale=320:320,tile=6x3','-frames:v','1',`${out}/${clip}-sheet.png`],{windowsHide:true});fs.writeFileSync(`${out}/result.json`,JSON.stringify({...metadata,...body,capturesSaved:captures},null,2)+'\n');console.log('REVIEW_READY '+out);res.end('ok');return;}}
if(u.pathname==='/metadata'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify(metadata));return;}
let file,type;if(u.pathname==='/'){file='assets/rimo-neko/workflow/review-c2-rig.html';type='text/html; charset=utf-8';}else if(u.pathname==='/model.glb'){file=source;type='model/gltf-binary';}else if(u.pathname.startsWith('/three/')){const root=path.resolve('node_modules/three');file=path.resolve(root,u.pathname.slice(7));if(!file.startsWith(root+path.sep)||!file.endsWith('.js'))throw Error('module');type='text/javascript';}else{res.writeHead(404).end();return;}res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
}catch(e){res.writeHead(500).end(String(e));console.error(e);}});
server.listen(0,'127.0.0.1',()=>console.log(`RIMO_C2_REVIEW http://127.0.0.1:${server.address().port}/ PID ${process.pid}`));
process.on('SIGINT',()=>server.close(()=>process.exit(0)));setTimeout(()=>server.close(()=>process.exit(0)),30*60*1000).unref();
