"""Self-contained local preview containing the exact adopted GLB and viewer runtime."""
import base64,hashlib,json,sys
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/maruimo-octopus'
revision=sys.argv[1]
source=M/f'work/rig/revision-{revision}/candidate.glb'
data=source.read_bytes()
module=(ROOT.parent/'threed-model-creation/trellis.cpp/tools/mv_preview/model-viewer.min.js').read_text(encoding='utf8')
dest=M/f'qa/final-{revision}/viewer.html'
dest.parent.mkdir(parents=True,exist_ok=True)
clips=[('Idle_Loop','待機'),('Walk_Loop','歩く'),('Run_Loop','走る'),('Attack','触手攻撃'),('Gather','採集'),('Craft','つくる'),('Give','手渡す'),('Eat','食べる'),('Wave','手を振る'),('Jump','ジャンプ'),('Ride_Loop','騎乗'),('Boat_Loop','乗船'),('Downed','ダウン')]
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>まるぃも · タコ人間</title>
<style>*{box-sizing:border-box}body{margin:0;background:#f1e9df;color:#46352e;font:15px system-ui;height:100dvh;display:flex;flex-direction:column}header{padding:18px 24px}h1{margin:0;font-size:27px}p{margin:6px 0;color:#866f62}model-viewer{flex:1;min-height:180px;width:100%;--poster-color:transparent}footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 24px}button,select,a{background:#fff;border:1px solid #cbb8a7;border-radius:12px;padding:10px 15px;color:inherit;font:inherit;text-decoration:none}label{display:flex;gap:8px;align-items:center}input{accent-color:#bc443f}#error{color:#a12020}</style>
<header><h1>まるぃも <span style="font-size:16px;font-weight:400">タコ人間</span></h1><p>ドラッグで回転、ホイールで拡大 · Candidate 1 / r__REV__</p><div id="error" role="alert"></div></header>
<model-viewer id="mv" camera-controls camera-orbit="25deg 78deg 145%" max-camera-orbit="auto auto 250%" field-of-view="30deg" shadow-intensity=".6" exposure="1" interaction-prompt="none" autoplay animation-name="Idle_Loop" alt="丸眼鏡と茶髪、ベージュのセーター、赤い触手と吸盤のタコ人間まるぃも"></model-viewer>
<footer><select id="clip" aria-label="動作">__CLIPS__</select><button id="play">一時停止</button><label>速さ<select id="speed" aria-label="再生速度"><option value="1">通常</option><option value=".5">1/2</option><option value=".25">1/4</option></select></label><label>時間<input id="timeline" aria-label="再生位置" type="range" min="0" max="3" value="0" step=".001"></label><button id="reset">視点を戻す</button><a id="download" download="maruimo-octopus.glb">GLBを保存</a><span id="status">読み込み中</span></footer>
<script type="module">__MODULE__</script><script>
const data=Uint8Array.from(atob('__DATA__'),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));
const mv=document.querySelector('#mv'),clip=document.querySelector('#clip'),timeline=document.querySelector('#timeline'),play=document.querySelector('#play');
mv.src=url;document.querySelector('#download').href=url;
mv.addEventListener('load',()=>{document.querySelector('#status').textContent='13の動作';mv.animationName='Idle_Loop';mv.play();});
mv.addEventListener('error',()=>document.querySelector('#error').textContent='モデルの読み込みに失敗しました');
clip.onchange=()=>{mv.animationName=clip.value;mv.currentTime=0;mv.play();play.textContent='一時停止';};
document.querySelector('#speed').onchange=e=>mv.timeScale=Number(e.target.value);
play.onclick=()=>{if(mv.paused){mv.play();play.textContent='一時停止';}else{mv.pause();play.textContent='再生';}};
timeline.oninput=()=>{mv.pause();const rate=mv.timeScale;mv.timeScale=1;mv.currentTime=Number(timeline.value);mv.timeScale=rate;play.textContent='再生';};
document.querySelector('#reset').onclick=()=>{mv.cameraTarget='auto auto auto';mv.cameraOrbit='25deg 78deg 145%';mv.jumpCameraToGoal();};
setInterval(()=>{timeline.max=mv.duration||3;if(!mv.paused)timeline.value=mv.currentTime;},60);
</script></html>'''
html=html.replace('__REV__',revision).replace('__CLIPS__',''.join(f'<option value="{name}">{label}</option>' for name,label in clips))
html=html.replace('__DATA__',base64.b64encode(data).decode()).replace('__MODULE__',module)
dest.write_text(html,encoding='utf8')
record=dict(candidate=1,revision=revision,source=str(source),sourceSha256=hashlib.sha256(data).hexdigest(),viewer=str(dest),viewerSha256=hashlib.sha256(dest.read_bytes()).hexdigest(),externalNetworkDependencies=False)
dest.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record))
