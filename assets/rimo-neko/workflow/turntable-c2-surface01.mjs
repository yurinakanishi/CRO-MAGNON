import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Local media export UI: no browser automation. Open the printed URL and use
// its visible export button. Only this selected, unchanged candidate is served.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const library = path.resolve(repo, '../threed-model-creation');
const root = path.join(library, 'models/rimo-neko');
const run = 'c2-surface01-turntable-20261002';
const media = path.join(root, 'media', run);
const work = path.join(root, 'work/render-frames', run + '-r02');
const release = path.join(root, 'release');
const python = 'C:/Users/yurin/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
const source = path.join(root, 'candidate-2/work/low-poly/revision-01/candidate.glb');
const prepared = path.join(root, 'geometry/rimo-neko-c2-surface01-display.glb');
const expected = '284095b15d1e08fdfa7a7157ba5806c322e52d280d03a0f0436c8f2311761850';
const sha = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
if (sha(source) !== expected) throw new Error('Selected C2 surface 01 source hash differs');
for (const directory of [media, work, release, path.dirname(prepared)]) fs.mkdirSync(directory, { recursive: true });
const rel = (file) => path.relative(root, file).split(path.sep).join('/');
const specPath = path.join(release, 'spec.json');
const url = 'https://meshmell.com/viewer/models/rimo-neko-gray-white-cat';
const spec = {
  schema_version: 2, model_root: '..', model_key: 'rimo-neko', asset_key: 'rimo-neko',
  source_glb: rel(source), prepared_glb: rel(prepared), packaging_report: 'release/c2-surface01-packaging.json',
  scale: 1, yaw_degrees: 0, node_prefix: 'RimoNekoSurface01Display',
  background: rel(path.join(media, 'background.png')),
  preview_image: rel(path.join(media, 'preview.jpg')),
  rotation_video: rel(path.join(media, 'rimo-neko-c2-surface01-rotation.mp4')),
  rotation_contact_sheet: rel(path.join(media, 'contact-sheet.png')),
  work_directory: rel(work),
  records: { validation: 'release/validation.json', meshmell_upload: 'release/meshmell/upload.json', publication: 'release/publication.json', x_post: 'release/x/post.txt' },
  video: { duration_seconds: 10, fps: 30, frame_count: 300, width: 960, height: 960, start_azimuth_degrees: -30, polar_degrees: 80, field_of_view: '30deg', camera_distance: '1.6m', workers: 1, settle_ms: 0, jpeg_quality: 97, exposure: 1 },
  // Unused schema-required publication template. No model resource exists or
  // publication is authorized by this local turntable request.
  meshmell: { model_id: 0, account_email: 'yurinakanishi@meshmell.com', name: 'Rimo Neko Gray White Cat', slug: 'rimo-neko-gray-white-cat', description: 'Local C2 surface 01 turntable only. Not uploaded; publication metadata is an inactive schema template.', credit: 'Yuri Nakanishi', license: 'Unspecified; no license granted by this local review.', visibility: 'private', url },
  x: { workflow: 'draft_only', creator_account: 'yurinakanishi33', model_url: url, draft_text: `LOCAL REVIEW ONLY. No publication requested. This model URL is an unused template.\n${url}\nCreated by @yurinakanishi33`, must_remain_unpublished: true },
};
if (fs.existsSync(specPath)) {
  const previous = JSON.parse(fs.readFileSync(specPath, 'utf8'));
  if (previous.source_glb !== spec.source_glb || previous.rotation_video !== spec.rotation_video) throw new Error('Existing release spec belongs to another release; preserve it');
}
fs.writeFileSync(specPath, JSON.stringify(spec, null, 2) + '\n');
if (!fs.existsSync(prepared)) {
  execFileSync(python, [path.join(library, 'trellis.cpp/tools/orient_scale_pivot_glb.py'), source, prepared, '--yaw-degrees', '0', '--pitch-degrees', '0', '--roll-degrees', '0', '--scale', '1', '--node-prefix', spec.node_prefix, '--report', path.join(root, spec.packaging_report), '--path-base', root], { windowsHide: true, stdio: 'pipe' });
}
const html = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>りもねこ C2表面01 回転動画</title>
<style>body{margin:0;background:#f6f5f2;color:#263238;font:15px system-ui}header{padding:14px 24px;display:flex;align-items:center;gap:22px}h1{font-size:20px;margin:0}button{font:inherit;padding:9px 18px;border:0;border-radius:8px;background:#263f47;color:white;cursor:pointer}button:disabled{opacity:.45}main{display:flex;gap:24px;padding:0 24px 24px}model-viewer{width:960px;height:960px;flex-shrink:0;background:#c7cbca;--poster-color:transparent}aside{max-width:300px;line-height:1.8}progress{width:260px}video{width:960px;height:960px;background:#c7cbca}#result{display:none}code{overflow-wrap:anywhere}a{color:#254f65}</style>
<script type="importmap">{"imports":{"three":"/three/build/three.module.js","three/addons/":"/three/examples/jsm/"}}</script>
<header><h1>りもねこ C2表面01</h1><button id="export" disabled>360°動画を書き出す</button><span id="status" role="status">モデル読込中</span></header>
<main><canvas id="mv" width="960" height="960" aria-label="C2表面01のりもねこ。灰白の毛、緑の目、大きなしっぽの猫" style="width:960px;height:960px;flex-shrink:0;background:#c7cbca"></canvas>
<video id="result" controls loop playsinline preload="auto"></video><aside><p>Candidate 2 / 表面01<br>全身・固定距離・360°<br>10秒 / 30fps / 960 × 960</p><p>元のモデルの形・表面・色を保持。正面斜めから一周します。</p><progress id="progress" max="300" value="0"></progress><p id="detail">書き出し前に全身を確認できます。</p><p id="download"></p></aside></main>
<script type="module">
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
const mv=document.getElementById('mv'),button=document.getElementById('export'),status=document.getElementById('status');
const renderer=new THREE.WebGLRenderer({canvas:mv,alpha:true,antialias:true,preserveDrawingBuffer:true});renderer.setPixelRatio(1);renderer.setSize(960,960);renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1;renderer.setClearColor(0,0);
const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(30,1,.01,100);
const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),environment=pmrem.fromScene(room,.04);scene.environment=environment.texture;room.dispose();pmrem.dispose();
function render(azimuth){const theta=THREE.MathUtils.degToRad(azimuth),phi=THREE.MathUtils.degToRad(80);camera.position.setFromSphericalCoords(1.6,phi,theta);camera.lookAt(0,0,0);camera.updateMatrixWorld();renderer.render(scene,camera);return {theta,phi,radius:1.6};}
const canvas=document.createElement('canvas');canvas.width=canvas.height=960;const ctx=canvas.getContext('2d',{willReadFrequently:true});
const background='#c7cbca';const manifest=[];
const blob=(type,quality)=>new Promise(resolve=>canvas.toBlob(resolve,type,quality));
async function upload(route,data){const response=await fetch(route,{method:'POST',body:data});if(!response.ok)throw new Error(await response.text());return response;}
try{const gltf=await new GLTFLoader().loadAsync('/model.glb');scene.add(gltf.scene);await renderer.compileAsync(scene,camera);render(-30);button.disabled=false;status.textContent='書き出し準備完了';}catch(error){status.textContent='モデル読込エラー: '+error.message;}
button.addEventListener('click',async()=>{
 button.disabled=true;
 try{
  ctx.fillStyle=background;ctx.fillRect(0,0,960,960);await upload('/background',await blob('image/png'));
  for(let i=0;i<300;i++){
   const azimuth=-30+i*360/300,actual=render(azimuth);
   ctx.clearRect(0,0,960,960);ctx.drawImage(mv,0,0,960,960);
   const rgba=ctx.getImageData(0,0,960,960).data;let minX=960,minY=960,maxX=-1,maxY=-1,pixels=0;
   for(let y=0;y<960;y++)for(let x=0;x<960;x++)if(rgba[(y*960+x)*4+3]>96){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);pixels++;}
   if(pixels<20000||minX<12||minY<12||maxX>947||maxY>947)throw new Error('全身の余白を確認できません: frame '+i+' '+[minX,minY,maxX,maxY]);
   ctx.globalCompositeOperation='destination-over';ctx.fillStyle=background;ctx.fillRect(0,0,960,960);ctx.globalCompositeOperation='source-over';
   await upload('/frame/'+String(i).padStart(4,'0'),await blob('image/jpeg',.97));
   manifest.push({frame:i,azimuth_degrees:azimuth,polar_degrees:80,distance:1.6,actual_orbit:actual,bounds:[minX,minY,maxX,maxY],foreground_pixels:pixels});
   document.getElementById('progress').value=i+1;status.textContent='描画中 '+(i+1)+' / 300';
  }
  status.textContent='MP4を書き出し中';await upload('/finish',JSON.stringify({frames:manifest,source_sha256:'${expected}',renderer:'Three.js '+THREE.REVISION+' deterministic WebGLRenderer; RoomEnvironment; ACESFilmic',background,first_frame:'front three-quarter -30deg',camera_target:[0,0,0],frame_count:300}));
  mv.style.display='none';const video=document.getElementById('result');video.src='/rotation.mp4';video.style.display='block';
  status.textContent='回転動画が完成しました';document.getElementById('detail').textContent='全300コマを描画しました。動画を再生して確認できます。';
  const link=document.createElement('a');link.href='/rotation.mp4';link.download='rimo-neko-c2-surface01-rotation.mp4';link.textContent='MP4を保存';document.getElementById('download').append(link);
 }catch(error){status.textContent='書き出し停止: '+error.message;await upload('/error',String(error.stack||error));}
});
</script></html>`;
let count=0, finishing=false;
const body=async(req,max)=>{const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>max)throw new Error('Request too large');chunks.push(chunk);}return Buffer.concat(chunks);};
function encode(){
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-n','-framerate','30','-i',path.join(work,'frame-%04d.jpg'),'-frames:v','300','-c:v','libx264','-preset','slow','-crf','17','-pix_fmt','yuv420p','-movflags','+faststart',path.join(root,spec.rotation_video)],{windowsHide:true,timeout:120000});
  fs.copyFileSync(path.join(work,'frame-0000.jpg'),path.join(root,spec.preview_image));
  execFileSync('ffmpeg',['-hide_banner','-loglevel','error','-n','-i',path.join(root,spec.rotation_video),'-vf','select=not(mod(n\\,37)),scale=320:320,tile=3x3','-frames:v','1',path.join(root,spec.rotation_contact_sheet)],{windowsHide:true,timeout:30000});
}
const server=http.createServer(async(req,res)=>{
 try{
  const requestUrl=new URL(req.url,'http://127.0.0.1');
  if(req.method==='POST'){
   const origin=req.headers.origin;
   if(origin!==`http://127.0.0.1:${server.address().port}`){res.writeHead(403).end('Same-origin local exporter only');return;}
   if(/^\/frame\/\d{4}$/.test(requestUrl.pathname)){
    const index=Number(requestUrl.pathname.slice(-4));if(index!==count||index>=300)throw new Error('Unexpected frame order');
    fs.writeFileSync(path.join(work,`frame-${String(index).padStart(4,'0')}.jpg`),await body(req,8000000),{flag:'wx'});count++;if(count%30===0)console.log(`Frames ${count}/300`);res.end('ok');return;
   }
   if(requestUrl.pathname==='/background'){const bytes=await body(req,8000000),target=path.join(root,spec.background);if(fs.existsSync(target)){if(!bytes.equals(fs.readFileSync(target)))throw new Error('Existing background differs');}else fs.writeFileSync(target,bytes,{flag:'wx'});res.end('ok');return;}
   if(requestUrl.pathname==='/error'){const message=await body(req,50000);fs.writeFileSync(path.join(work,'error.txt'),message);console.error(message.toString());res.end('recorded');return;}
   if(requestUrl.pathname==='/finish'){
    if(count!==300||finishing)throw new Error('Incomplete or repeated export');finishing=true;
    fs.writeFileSync(path.join(work,'render-manifest.json'),await body(req,2000000),{flag:'wx'});encode();console.log('VIDEO_READY '+path.join(root,spec.rotation_video));res.end('complete');return;
   }
  }
  if(requestUrl.pathname.startsWith('/three/')){const base=path.join(repo,'node_modules/three'),file=path.resolve(base,requestUrl.pathname.slice(7));if(!file.startsWith(base+path.sep)||!file.endsWith('.js'))throw new Error('Unsupported module');res.writeHead(200,{'Content-Type':'text/javascript'});fs.createReadStream(file).pipe(res);return;}
  const routes={'/model.glb':[prepared,'model/gltf-binary'],'/rotation.mp4':[path.join(root,spec.rotation_video),'video/mp4']};
  if(requestUrl.pathname==='/'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}).end(html);return;}
  if(requestUrl.pathname==='/status'){res.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({count,pid:process.pid,finishing,video_exists:fs.existsSync(path.join(root,spec.rotation_video))}));return;}
  const route=routes[requestUrl.pathname];if(route&&fs.existsSync(route[0])){res.writeHead(200,{'Content-Type':route[1],'Content-Length':fs.statSync(route[0]).size});fs.createReadStream(route[0]).pipe(res);return;}
  res.writeHead(404).end('Not found');
 }catch(error){console.error(error);res.writeHead(500).end(String(error));}
});
server.listen(0,'127.0.0.1',()=>{const endpoint=`http://127.0.0.1:${server.address().port}/`;fs.writeFileSync(path.join(work,'server.json'),JSON.stringify({pid:process.pid,url:endpoint,started_at:new Date().toISOString()}));console.log(endpoint);console.log(`PID ${process.pid}`);});
setTimeout(()=>server.close(()=>process.exit(0)),25*60*1000).unref();
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>server.close(()=>process.exit(0)));
