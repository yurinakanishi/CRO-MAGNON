"""Self-contained exact-GLB viewer; no CDN, no placeholder geometry."""
import argparse,base64,hashlib,json
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
p=argparse.ArgumentParser();p.add_argument('--colour',default='mae');p.add_argument('--revision',default='01');a=p.parse_args()
M=ROOT/'output/model-generation/models/mae'
source=M/f'work/rig/revision-{a.revision}/candidate.glb';data=source.read_bytes()
module=(ROOT.parent/'threed-model-creation/trellis.cpp/tools/mv_preview/model-viewer.min.js').read_text(encoding='utf8')
out=M/f'qa/final-{a.revision}/viewer.html';out.parent.mkdir(parents=True,exist_ok=True)
name='mae'
clips=[('Idle_Loop','待機'),('Walk_Loop','歩く'),('Run_Loop','走る'),('Pet','撫でられる'),('Happy','よろこぶ'),('Hit','びっくり')]
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>__NAME__ · Candidate 1</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e5ebe7;color:#203c35;font:15px system-ui;height:100dvh;display:flex;flex-direction:column}header{padding:20px 24px}h1{margin:0;font-size:28px}p{margin:6px 0}model-viewer{flex:1;min-height:180px;width:100%;--poster-color:transparent}footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 24px}button,select,a{background:white;border:1px solid #a6bdb2;border-radius:12px;padding:10px 15px;color:inherit;font:inherit;text-decoration:none}label{display:flex;gap:8px;align-items:center}input{accent-color:#256e51}#error{color:#a12020}</style>
<header><h1>__NAME__</h1><p>ドラッグで回転、ホイールで拡大 · Candidate 1 / r__REV__ · 実物のGLB</p><div id="error" role="alert"></div></header>
<model-viewer id="mv" camera-controls camera-orbit="-25deg 82deg 150%" min-camera-orbit="auto auto 70%" max-camera-orbit="auto auto 300%" field-of-view="30deg" shadow-intensity=".7" exposure="1" interaction-prompt="none" autoplay animation-name="Idle_Loop" alt="__NAME__の3Dモデル"></model-viewer>
<footer><select id="clip" aria-label="動作">__CLIPS__</select><button id="play">一時停止</button><label>速さ<select id="speed" aria-label="再生速度"><option value="1">通常</option><option value=".5">1/2</option><option value=".25">1/4</option></select></label><label>時間<input id="timeline" aria-label="再生位置" type="range" min="0" max="3" value="0" step=".001"></label><button id="reset">視点を戻す</button><a id="download" download="mae.glb">GLBを保存</a><span id="status">読み込み中</span></footer>
<script type="module">__MODULE__</script><script>
const data=Uint8Array.from(atob('__DATA__'),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));
const mv=document.querySelector('#mv'),clip=document.querySelector('#clip'),timeline=document.querySelector('#timeline'),play=document.querySelector('#play');
mv.src=url;document.querySelector('#download').href=url;
mv.addEventListener('load',()=>{document.querySelector('#status').textContent=mv.availableAnimations.length+'の動作';mv.animationName='Idle_Loop';mv.play();});
mv.addEventListener('error',()=>document.querySelector('#error').textContent='モデルの読み込みに失敗しました');
clip.onchange=()=>{mv.animationName=clip.value;mv.currentTime=0;mv.play();play.textContent='一時停止';};
document.querySelector('#speed').onchange=e=>mv.timeScale=Number(e.target.value);
play.onclick=()=>{if(mv.paused){mv.play();play.textContent='一時停止';}else{mv.pause();play.textContent='再生';}};
timeline.oninput=()=>{mv.pause();const rate=mv.timeScale;mv.timeScale=1;mv.currentTime=Number(timeline.value);mv.timeScale=rate;play.textContent='再生';};
document.querySelector('#reset').onclick=()=>{mv.cameraTarget='auto auto auto';mv.cameraOrbit='-25deg 82deg 150%';mv.jumpCameraToGoal();};
setInterval(()=>{timeline.max=mv.duration||3;if(!mv.paused)timeline.value=mv.currentTime;},60);
</script></html>'''
for k,v in {'__NAME__':name,'__REV__':a.revision,'__COLOUR__':a.colour,'__CLIPS__':''.join(f'<option value="{n}">{t}</option>' for n,t in clips),'__DATA__':base64.b64encode(data).decode(),'__MODULE__':module}.items():html=html.replace(k,v)
out.write_text(html,encoding='utf8')
record=dict(source=str(source),sha256=hashlib.sha256(data).hexdigest(),sourceSha256=hashlib.sha256(data).hexdigest(),bytes=len(data),viewer=str(out),viewerSha256=hashlib.sha256(out.read_bytes()).hexdigest(),externalNetworkDependencies=False)
out.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record))
