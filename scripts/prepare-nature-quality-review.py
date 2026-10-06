"""A/B audition: identical loudness target, never peak-normalize quiet noise upward."""
import runpy, pathlib, json, math, subprocess, wave
import numpy as np
u=runpy.run_path(str(pathlib.Path(__file__).with_name('inspect-nature-quality.py')))
ROOT, FF, RATE, decode = [u[k] for k in ['ROOT','FF','RATE','decode']]
OUT=ROOT/'output/nature-audio-quality-20261006'; (OUT/'audio').mkdir(parents=True,exist_ok=True)
old=ROOT/'output/nature-audio-review-20261006/audio'
manifest=json.loads((ROOT/'public/audio/nature/manifest.json').read_text())
labels=[('wind','風','合成風から、野外録音の柔らかい風へ。低い吹かれと刺さる高域を整理。'),('river','川','川の流れ専用の録音。ステレオの広がりを残し、遠くでは高域も減衰。'),('shore','岸辺','流れる川とは別の、寄せて返す水音。'),('fire','焚き火','原録音の細部を残して再加工。距離による二重の減衰を解消。'),('torch','松明','別区間を加工。小さな炎の質感に合わせ、低域と鋭い音を抑制。'),('rain','雨','白色雑音から録音素材へ。洞窟の奥では止まる。'),('drop-0','洞窟の水滴','電子的な単音から水滴素材へ。2断片を疎らに配置し、暗い残響を付加。'),('birds-0','鳥の声 1','原録音から再加工。自然な長さと緩い始まり・終わり。'),('birds-1','鳥の声 2','極端な音程変更をやめ、遠方からの声に調整。'),('birds-2','鳥の声 3','同じ断片の連打を避け、鳴く間隔を拡大。'),('bgm-explore','BGM：探索','録音された笛とハープ。開けた場所の、間を置いた旋律。'),('bgm-camp','BGM：キャンプ','ハープの低い響きと穏やかな笛。48秒のフレーズ。'),('bgm-cave','BGM：洞窟','低い弦と少ない笛の音。暗い余韻と長めの間。')]
catalog=[]
for name,label,description in labels:
    paths={'before':old/(('cave-drop' if name=='drop-0' else name)+'.wav'),'after':ROOT/f'public/audio/nature/{name}.mp3'}
    for status,file in paths.items():
        result=subprocess.run([FF,'-hide_banner','-i',str(file),'-af','loudnorm=print_format=json','-f','null','-'],capture_output=True,check=True)
        log=result.stderr.decode(errors='replace'); level=json.loads(log[log.rfind('{'):log.rfind('}')+1])
        gain=min(-28-float(level['input_i']),-3-float(level['input_tp']))
        out=OUT/f'audio/{name}-{status}.mp3'
        subprocess.run([FF,'-v','error','-y','-i',str(file),'-af',f'volume={gain}dB','-map_metadata','-1','-c:a','libmp3lame','-q:a','2',str(out)],check=True)
        catalog.append({'name':name,'status':status,'gainDB':gain,'comparisonLUFS':float(level['input_i'])+gain,'file':out.relative_to(OUT).as_posix()})
    print('A/B',name,flush=True)
# The second water droplet is independently playable too.
subprocess.run([FF,'-v','error','-y','-i',str(ROOT/'public/audio/nature/drop-1.mp3'),'-af','volume=2dB','-c:a','libmp3lame','-q:a','2',str(OUT/'audio/drop-1-after.mp3')],check=True)
mixes=''
for key,label in [('camp','キャンプ'),('cave','洞窟')]:
    file=ROOT/f'output/playwright/nature-audio-quality-20261006/game-r02/{key}-mix.webm'
    if file.exists():
        target=OUT/f'audio/{key}-game-mix.mp3'
        subprocess.run([FF,'-v','error','-y','-i',str(file),'-map_metadata','-1','-c:a','libmp3lame','-q:a','2',str(target)],check=True)
        mixes+=f'<div><label>{label}：実ゲームの録音（12秒）</label><audio controls preload="none" src="audio/{key}-game-mix.mp3"></audio></div>'
if mixes:
    mixes='<article><h2>ゲーム内では、このバランスです。</h2><p>保存なしの検証用ゲームで録音。環境音70%・BGM30%の音量をそのまま保持しています。</p><div class="pair">'+mixes+'</div></article>'
cards=[]
for name,label,description in labels:
    extra='<label>水滴の別断片</label><audio controls preload="none" src="audio/drop-1-after.mp3"></audio>' if name=='drop-0' else ''
    cards.append(f'<article><h2>{label}</h2><p>{description}</p><div class="pair"><div><label>以前</label><audio controls preload="none" src="audio/{name}-before.mp3"></audio></div><div><label class="new">今回</label><audio controls preload="none" src="audio/{name}-after.mp3"></audio></div></div>{extra}</article>')
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>自然音を聴き比べる</title><style>
*{box-sizing:border-box}body{margin:0;background:#101c19;color:#edf1e8;font:16px/1.8 system-ui,sans-serif}main{max-width:1080px;margin:auto;padding:42px 22px 80px}header{padding:20px 0 26px;border-bottom:1px solid #40534a}small,label{color:#b9c4b7}h1{font-size:clamp(27px,5vw,42px);font-weight:550;line-height:1.3;margin:12px 0}h2{font-size:21px;margin:0 0 7px}p{color:#becac1;margin:8px 0 18px}.bar{position:sticky;top:0;background:#101c19ed;backdrop-filter:blur(10px);padding:16px 0;z-index:2;display:flex;align-items:center;justify-content:space-between;gap:16px}.bar p{margin:0;font-size:13px}button{background:#d6e1c7;color:#163027;border:0;border-radius:22px;padding:10px 18px;font:inherit;white-space:nowrap;cursor:pointer}article{background:#1a2b25;border:1px solid #344a40;border-radius:14px;padding:23px;margin:16px 0}.pair{display:grid;grid-template-columns:1fr 1fr;gap:25px}label{display:block;font-size:13px}.new{color:#e1eec9}audio{width:100%;height:42px;margin-top:8px}a{color:#cdddac}footer{padding-top:25px;font-size:13px}button:focus-visible,a:focus-visible{outline:3px solid #e1c57c;outline-offset:3px}@media(max-width:600px){.pair{grid-template-columns:1fr;gap:12px}main{padding:22px 15px 45px}article{padding:18px}.bar{align-items:flex-start}}
</style><main><header><small>CRO-MAGNON · SOUND REVIEW · 2026.10.06</small><h1>自然音を、素材から聴き比べる。</h1><p>残した環境音・鳥・場所別BGMの改善版です。足音や操作音は追加していません。</p></header><div class="bar"><p>音色の比較用に平均音量を揃えています（目標 −28 LUFS）。<br>ゲーム内では距離・場所・音量設定に応じて、もっと小さく聞こえます。</p><button id="stop">すべて停止</button></div>'''+''.join(cards)+'''<footer>一度に再生するのは1音源だけです。原録音と加工値はプロジェクト内に保存しています。<br>素材：<a href="https://opengameart.org/content/park-ambiences">Thimras</a> · <a href="https://opengameart.org/content/sea-and-river-wave-sounds">RandomMind</a> · <a href="https://opengameart.org/content/rain-ambient-not-loopable-2-versions-available">Ove Melaa</a> · <a href="https://opengameart.org/content/dripping-water-loop">Independent.nu / qubodup</a> · <a href="https://versilian-studios.com/vsco-community/">Versilian Studios</a>（CC0）。火・鳥の既存原本はCREDITS参照。</footer></main><script>const players=[...document.querySelectorAll('audio')];for(const a of players)a.addEventListener('play',()=>players.forEach(b=>{if(a!==b)b.pause()}));document.querySelector('#stop').onclick=()=>players.forEach(a=>{a.pause();a.currentTime=0});</script></html>'''
html=html.replace('<article>',mixes+'<article>',1)
(OUT/'index.html').write_text(html,encoding='utf-8')
(OUT/'comparison-levels.json').write_text(json.dumps(catalog,indent=2)+'\n')
