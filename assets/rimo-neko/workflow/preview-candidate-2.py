"""Package exact GLB bytes and the locally bundled Three.js model viewer offline."""
import base64,hashlib,json,sys
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'; revision=sys.argv[1] if len(sys.argv)>1 else '01'
source=M/f'work/rig/revision-{revision}/candidate.glb'; data=source.read_bytes(); digest=hashlib.sha256(data).hexdigest()
module=(ROOT.parent/'threed-model-creation/trellis.cpp/tools/mv_preview/model-viewer.min.js').read_text(encoding='utf8')
dest=M/f'qa/rig-{revision}/viewer.html'; dest.parent.mkdir(parents=True,exist_ok=True)
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>りもねこ · Candidate 2</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e9edef;color:#203330;font:15px system-ui,sans-serif;height:100dvh;display:flex;flex-direction:column}header{padding:18px 24px}h1{margin:0;font-size:25px}header p{margin:5px 0 0;color:#596b64;font-size:13px}model-viewer{flex:1;min-height:0;width:100%;--poster-color:transparent}footer{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:16px 24px}button,select,a{background:#fff;border:1px solid #b5c7c0;border-radius:12px;padding:10px 15px;color:inherit;font:inherit;text-decoration:none;cursor:pointer}label{display:flex;gap:8px;align-items:center}input{accent-color:#307e60}small{color:#597267}#error{color:#a12020}</style>
<header><h1>りもねこ</h1><p>Candidate 2 · ドラッグで回転、ホイールで拡大</p><div id="error" role="alert"></div></header>
<model-viewer id="mv" camera-controls camera-orbit="30deg 76deg 165%" max-camera-orbit="auto auto 250%" field-of-view="30deg" shadow-intensity=".65" exposure="1" interaction-prompt="none" autoplay animation-name="Idle_Loop" alt="白と灰色のふさふさしたりもねこの3Dモデル"></model-viewer>
<footer><select id="clip" aria-label="動作"><option value="Idle_Loop">待機</option><option value="Walk_Loop">歩く</option><option value="Run_Loop">走る</option><option value="Pet">撫でられる</option><option value="Happy">なつく</option><option value="Hit">ノックバック</option><option value="Hiss">シャーッと威嚇</option></select><button id="play">一時停止</button><label>時間<input id="timeline" aria-label="再生位置" type="range" min="0" max="3" value="0" step=".001"></label><button id="reset">視点を戻す</button><a id="download" download="rimo-neko.glb">GLBを保存</a><small id="status">読み込み中</small></footer>
<script type="module">__VIEWER_MODULE__</script><script>
const data=Uint8Array.from(atob('__MODEL_DATA__'),c=>c.charCodeAt(0)),url=URL.createObjectURL(new Blob([data],{type:'model/gltf-binary'}));
const mv=document.querySelector('#mv'),clip=document.querySelector('#clip'),timeline=document.querySelector('#timeline'),play=document.querySelector('#play');
mv.src=url;document.querySelector('#download').href=url;window.candidateSha256='__SOURCE_HASH__';
mv.addEventListener('load',()=>{window.modelReady=true;document.querySelector('#status').textContent='7つの動作';mv.animationName='Idle_Loop';mv.play();});
mv.addEventListener('error',e=>{document.querySelector('#error').textContent='モデルの読み込みに失敗しました';console.error(e.detail);});
clip.onchange=()=>{mv.animationName=clip.value;mv.currentTime=0;mv.play();play.textContent='一時停止';setTimeout(()=>timeline.max=mv.duration,50);};
play.onclick=()=>{if(mv.paused){mv.play();play.textContent='一時停止';}else{mv.pause();play.textContent='再生';}};
timeline.oninput=()=>{mv.pause();mv.currentTime=Number(timeline.value);play.textContent='再生';};
document.querySelector('#reset').onclick=()=>{mv.cameraTarget='auto auto auto';mv.cameraOrbit='30deg 76deg 165%';mv.jumpCameraToGoal();};
setInterval(()=>{timeline.max=mv.duration||3;if(!mv.paused)timeline.value=mv.currentTime;},60);
</script></html>'''
html=html.replace('__MODEL_DATA__',base64.b64encode(data).decode()).replace('__SOURCE_HASH__',digest).replace('__VIEWER_MODULE__',module)
html=html.replace('Candidate 2 · ドラッグ',f'Candidate 2 · r{revision} · ドラッグ')
html=html.replace('<label>時間<input', '<label>速さ<select id="speed" aria-label="再生速度"><option value="1">通常</option><option value="0.5">1/2</option><option value="0.25">1/4</option></select></label><label>時間<input')
html=html.replace("play.onclick=()=>", "document.querySelector('#speed').onchange=e=>{mv.timeScale=Number(e.target.value);};\nplay.onclick=()=>")
html=html.replace('<button id="reset">', '<select id="angle" aria-label="見る方向"><option value="30deg 76deg 165%">斜め</option><option value="0deg 88deg 165%">正面</option><option value="90deg 88deg 165%">右</option><option value="180deg 88deg 165%">背面</option><option value="270deg 88deg 165%">左</option><option value="0deg 8deg 165%">上</option></select><button id="reset">')
html=html.replace("document.querySelector('#reset').onclick", "document.querySelector('#angle').onchange=e=>{mv.cameraOrbit=e.target.value;mv.jumpCameraToGoal();};\ndocument.querySelector('#reset').onclick")
dest.write_text(html,encoding='utf8'); record=dict(candidate=2,revision=revision,source=str(source),sourceSha256=digest,sourceBytes=len(data),viewer=str(dest),viewerSha256=hashlib.sha256(dest.read_bytes()).hexdigest(),externalNetworkDependencies=False)
dest.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n'); print(json.dumps(record))
