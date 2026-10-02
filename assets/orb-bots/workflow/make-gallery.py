"""Present all five reviewed GLBs together, with the offline Three.js runtime."""
import base64
import hashlib
import json
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
names = {'white': 'しろbot', 'blue': 'あおbot', 'green': 'みどりbot', 'purple': 'むらさきbot', 'orange': 'オレンジbot'}
runtime = (ROOT.parent / 'threed-model-creation/trellis.cpp/tools/mv_preview/model-viewer.min.js').read_text(encoding='utf8')
records, cards, data = [], [], {}
revisions = json.loads((ROOT / 'assets/orb-bots/revisions.json').read_text())
for colour, name in names.items():
    revision = revisions[colour]
    folder = ROOT / f'output/model-generation/models/orb-bot-{colour}'
    raw = (folder / f'work/rig/revision-{revision}/candidate.glb').read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    review = json.loads((ROOT / f'assets/orb-bots/reviews/{colour}-r{revision}.json').read_text(encoding='utf8'))
    assert review['sha256'] == digest
    assert review['decision'] in ['adopt', 'visual-approved-for-game-qa']
    records.append(dict(colour=colour, sha256=digest, bytes=len(raw)))
    data[colour] = base64.b64encode(raw).decode()
    cards.append(f'''<article><model-viewer data-colour="{colour}" camera-controls camera-orbit="0deg 83deg 150%" field-of-view="30deg" shadow-intensity=".7" exposure="1" interaction-prompt="none" animation-name="Idle_Loop" alt="{name}の実物の3Dモデル"></model-viewer><h2>{name}</h2><a href="model-generation/models/orb-bot-{colour}/qa/final-{revision}/viewer.html">ひとりずつ見る ↗</a></article>''')
html = '''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>5色のbotたち</title>
<style>*{box-sizing:border-box}body{margin:0;background:#e7eee8;color:#193b32;font-family:system-ui,sans-serif}main{max-width:1500px;margin:auto;padding:52px 36px}header small{letter-spacing:.2em;font-weight:700;color:#527466}h1{font-size:clamp(32px,5vw,64px);margin:12px 0}header p{font-size:18px;line-height:1.8;max-width:800px}.models{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px;margin:32px 0}article{background:#f7faf5;border:1px solid #cbdad0;border-radius:22px;overflow:hidden;text-align:center;padding:0 0 23px}model-viewer{width:100%;height:300px;--poster-color:transparent}h2{margin:0 0 12px;font-size:21px}a{color:#286952;font-size:13px}nav{display:flex;gap:14px;flex-wrap:wrap;align-items:center}button,select{border:1px solid #afc3b6;border-radius:12px;padding:12px 20px;background:#fff;color:#193b32;font:inherit}kbd{background:white;border:1px solid #b9cbc0;border-radius:6px;padding:3px 8px;font-family:inherit}.hint{line-height:1.9;font-size:14px;color:#527466}#status{font-size:14px;color:#527466}@media(max-width:850px){main{padding:28px 18px}.models{grid-template-columns:repeat(2,minmax(0,1fr))}model-viewer{height:230px}}@media(max-width:390px){.models{gap:8px}model-viewer{height:190px}h2{font-size:17px}}</style>
<main><header><small>CRO-MAGNON · COMPANIONS</small><h1>5色のbotたち</h1><p>手のひらに乗せて、ぽんっと投げる。<br>着地したら、弾みながらあなたのところへ。</p></header>
<section class="models">__CARDS__</section><nav><button id="play">みんなを動かす</button><label>動き <select id="clip"><option value="Idle_Loop">待機</option><option value="Walk_Loop">歩く</option><option value="Run_Loop">走る</option><option value="Held_Loop">手の上</option><option value="Thrown_Loop">飛んでいく</option><option value="Land">着地</option><option value="Catch">戻ってくる</option></select></label><button id="reset">向きを戻す</button><span id="status">読み込み中…</span></nav>
<p class="hint">それぞれドラッグで回転・ホイールで拡大。ゲームでは <kbd>C</kbd> 持つ／投げる　<kbd>Z</kbd> 種類　<kbd>Q</kbd> 呼ぶ。<br>コントローラー：左スティック押し込みで持つ／投げる、十字キー↑で呼ぶ。種類はメニュー「botたち」。</p></main>
<script type="module">__RUNTIME__</script><script>const models=__DATA__,viewers=[...document.querySelectorAll('model-viewer')];let loaded=0,playing=false;for(const mv of viewers){const raw=Uint8Array.from(atob(models[mv.dataset.colour]),c=>c.charCodeAt(0));mv.src=URL.createObjectURL(new Blob([raw],{type:'model/gltf-binary'}));mv.addEventListener('load',()=>{mv.pause();document.querySelector('#status').textContent=(++loaded)+' / 5 読み込み完了';});mv.addEventListener('error',()=>document.querySelector('#status').textContent='モデルの読み込みに失敗しました');}document.querySelector('#play').onclick=()=>{playing=!playing;viewers.forEach(m=>playing?m.play():m.pause());document.querySelector('#play').textContent=playing?'一時停止':'みんなを動かす';};document.querySelector('#clip').onchange=e=>{viewers.forEach(m=>{m.animationName=e.target.value;m.currentTime=0;m.play();});playing=true;document.querySelector('#play').textContent='一時停止';};document.querySelector('#reset').onclick=()=>viewers.forEach(m=>{m.cameraTarget='auto auto auto';m.cameraOrbit='0deg 83deg 150%';m.jumpCameraToGoal();});</script></html>'''
html = html.replace('__CARDS__', ''.join(cards)).replace('__RUNTIME__', runtime).replace('__DATA__', json.dumps(data))
target = ROOT / 'output/orb-bots-gallery.html'
target.write_text(html, encoding='utf8')
target.with_suffix('.json').write_text(json.dumps(dict(models=records, sha256=hashlib.sha256(target.read_bytes()).hexdigest()), indent=2) + '\n')
print(str(target))
