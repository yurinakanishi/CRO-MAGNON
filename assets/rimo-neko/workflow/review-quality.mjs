// Read-only, loopback-only review of the exact local GLBs. No game save access.
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {createHash} from 'node:crypto';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const c2='output/model-generation/models/rimo-neko/candidate-2/work/low-poly';
const options=[
  ['current','ゲームの現行版 C1 / r10','public/models/rimo-neko/model-r10.glb','現行のモデル。毛束の薄片と尾の隙間が残る。'],
  ['c2-01','新候補 C2 / 表面01',`${c2}/revision-01/candidate.glb`,'未採用。丸い顔は近づいたが、板状の毛が残る。'],
  ['c2-02','C2 / 表面02：穴を閉じる補修',`${c2}/revision-02/candidate.glb`,'未採用。閉じた表面になったが、毛束と色の転写に問題が残る。'],
  ['c2-04','C2 / 表面04：強い平滑化',`${c2}/revision-04/candidate.glb`,'不採用。凹凸は減るが、毛の質感が溶け、顔の模様もぼやける。'],
  ['c2-05','C2 / 表面05：元UVを保持',`${c2}/revision-05/candidate.glb`,'未採用。目鼻と色を保持できるが、尾の板状化は改善不足。'],
  ['c1-11','C1 / r11：限定補修の試作','output/rimo-quality-20261002/c1-polish-r11.glb','未採用。顔・足・全動作を保持し4mm以内で補修したが、見た目の改善は小さい。'],
];
const routes=new Map();
for(const [id,label,file,note] of options){
  const bytes=await readFile(path.join(root,file));routes.set(`/model/${id}.glb`,{bytes,type:'model/gltf-binary'});
  options.find(o=>o[0]===id).push(createHash('sha256').update(bytes).digest('hex'));
}
routes.set('/viewer.js',{bytes:await readFile(path.join(root,'../threed-model-creation/trellis.cpp/tools/mv_preview/model-viewer.min.js')),type:'text/javascript'});
routes.set('/reference.jpg',{bytes:await readFile(path.join(root,'assets/rimo-neko/source/user-reference.jpg')),type:'image/jpeg'});
const html=`<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>りもねこ：原画像と3D試作の比較</title>
<style>*{box-sizing:border-box}body{margin:0;background:#edf1f0;color:#233431;font:15px system-ui}header{padding:18px 24px;background:white}h1{margin:0;font-size:24px}p{line-height:1.6}main{display:grid;grid-template-columns:230px 1fr;height:calc(100dvh - 190px);min-height:450px}aside{padding:20px}img{width:100%;border-radius:18px}model-viewer{height:100%;width:100%;--poster-color:transparent}footer{padding:14px 24px;background:white;display:flex;gap:12px;align-items:center;flex-wrap:wrap}select,button{font:inherit;padding:9px;border:1px solid #adbbb6;border-radius:8px;background:#fff}small{font-size:11px;overflow-wrap:anywhere}#status{color:#426358}#error{color:#b22}@media(max-width:700px){main{grid-template-columns:110px 1fr}aside{padding:10px}aside p{font-size:12px}}</style>
<header><h1>りもねこ：原画像と3D試作の比較</h1><p id="note"></p><small id="hash"></small></header><main><aside><img src="/reference.jpg" alt="ユーザー提供の元画像：灰白色、緑の目のりもねこ"><p>保存されている原画像。ドラッグで3Dを回転できます。</p><p><b>新候補は未採用</b><br>ゲーム用はC1 / r10のままです。</p></aside><model-viewer id="mv" camera-controls camera-orbit="30deg 76deg 145%" field-of-view="30deg" shadow-intensity=".3" exposure="1" interaction-prompt="none" alt="実際のGLBを再生するりもねこの比較ビューアー"></model-viewer></main>
<footer><select id="version" aria-label="モデルの版">${options.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join('')}</select><select id="angle" aria-label="見る方向"><option value="30deg 76deg 145%">斜め</option><option value="0deg 88deg 145%">正面</option><option value="90deg 88deg 145%">右</option><option value="180deg 88deg 145%">背面</option><option value="270deg 88deg 145%">左</option><option value="0deg 8deg 145%">上</option></select><span id="status" role="status">読み込み中</span><span id="error" role="alert"></span></footer>
<script type="module" src="/viewer.js"></script><script>
const options=${JSON.stringify(options)},mv=document.querySelector('#mv'),version=document.querySelector('#version');
function select(){const row=options.find(o=>o[0]===version.value);document.querySelector('#note').textContent=row[3];document.querySelector('#hash').textContent='GLB SHA-256: '+row[4];document.querySelector('#status').textContent='読み込み中';document.querySelector('#error').textContent='';mv.src='/model/'+row[0]+'.glb';}
version.onchange=select;document.querySelector('#angle').onchange=e=>{mv.cameraOrbit=e.target.value;mv.jumpCameraToGoal();};
mv.addEventListener('load',()=>{mv.pause();mv.animationName='Idle_Loop';mv.currentTime=0;document.querySelector('#status').textContent='実GLB 読み込み完了';});
mv.addEventListener('error',()=>{document.querySelector('#error').textContent='読み込み失敗';});select();</script></html>`;
routes.set('/',{bytes:Buffer.from(html),type:'text/html; charset=utf-8'});
const server=http.createServer((req,res)=>{const route=routes.get(new URL(req.url,'http://localhost').pathname);if(!route){res.writeHead(404);res.end('Not found');return;}res.writeHead(200,{'Content-Type':route.type,'Cache-Control':'no-store','Content-Length':route.bytes.length});res.end(route.bytes);});
server.listen(0,'127.0.0.1',()=>console.log('RIMO_REVIEW http://127.0.0.1:'+server.address().port));
