"""Audition actual default gains; never normalize the quieter wind/river back up."""
from nature_audio_mastering import *
REVIEW=ROOT/'output/nature-audio-quality-20261006'
(REVIEW/'audio').mkdir(exist_ok=True)
before=ROOT/'assets/nature-audio/before-soften-20261006'
records=[]
def preview(name,path,gain):
    target=REVIEW/f'audio/{name}.mp3'
    subprocess.run([FF,'-v','error','-y','-i',str(path),'-af',f'volume={gain}', '-map_metadata','-1','-c:a','libmp3lame','-q:a','2',str(target)],check=True)
    records.append({'name':name,'source':path.relative_to(ROOT).as_posix(),'gain':gain,'gainDB':20*math.log10(gain),'file':target.relative_to(REVIEW).as_posix()})
    return f'audio/{name}.mp3'
def player(label,url): return f'<div><label>{label}</label><audio controls preload="none" src="{url}"></audio></div>'
def card(title,body,players): return f'<article><h2>{title}</h2><p>{body}</p><div class="pair">'+''.join(players)+'</div></article>'
cards=[]
for name,label,oldgain,newgain,desc in [
 ('wind','風',(.38+.35*.3)*.7*.8,(.32+.35*.14)*.7*.8,'風の強さを中程度で比較。音量を約8dB下げ、高域のザラつきを抑えています。'),
 ('river','川',.42*.7*.8,.34*.7*.8,'川の近くで比較。前回から約6dB下げています。離れるとさらに小さくなります。')]:
    cards.append(card(label,desc,[player('直前の版',preview(name+'-previous',before/f'audio/{name}.mp3',oldgain)),player('今回：ゲームの初期音量',preview(name+'-soft',OUT/f'{name}.mp3',newgain))]))
mixcards=[]
for name,label in [('camp','キャンプ'),('cave','洞窟')]:
    path=ROOT/f'output/playwright/nature-audio-restored-20261007/game-r01/{name}-mix.webm'
    if path.exists(): mixcards.append(player(label+'：実ゲームの録音',preview(name+'-restored-mix',path,1)))
if mixcards: cards.append(card('ゲーム全体の音量','保存なしの検証ゲームで録音。環境音70%・BGM30%・効果音50%。',mixcards))
effects=[
 ('step-grass','足音：草','草を踏む短い接触音。',3,.5),('step-sand','足音：砂','砂の原録音を再加工。',3,.5),
 ('step-stone','足音：石','石の原録音の硬さを残し、鋭い帯域を抑制。',3,.5),('step-snow','足音：雪','雪を踏む録音へ差し替え。',3,.5),
 ('step-water','足音：水','小さな水しぶきの別素材を使用。',3,.5),('attack','攻撃','竹を振った実録音の短い風切り。',3,.6),
 ('jump','ジャンプ','跳ぶときの短い衣擦れ。',2,.6),('hurt','被弾','柔らかい接触音。',2,.6),
 ('gather','採集','石・木・草の素材に応じて鳴り分け。',['stone','wood','plant'],.6),('torch-switch','松明の切替','小さく短い炎。',0,.5),
 ('mount','乗降','革が動く短い音。',2,.6),('recall','仲間を呼ぶ','録音された笛の、短いひと息。',0,.6),
 ('throw','投げる','攻撃とは別の控えめな風切り。',3,.6),('pet','撫でる','柔らかい布が触れる小さな音。',2,.6),
 ('hiss','猫の威嚇','実録音。ゲームでは距離に応じて減衰。',0,.6),('confirm','成功通知','ハープの静かな単音。',0,.5),
 ('discovery','発見','ハープ2音の短い余韻。',0,.5)]
fxcards=[]
for key,label,desc,variants,gain in effects:
    players=[player('削除前：音色の参考',preview(key+'-legacy',ROOT/f'output/nature-audio-review-20261006/audio/{key}.wav',.24))]
    suffixes=variants if isinstance(variants,list) else list(range(variants)) if variants else [None]
    for i in suffixes:
        name='fx-'+key+(f'-{i}' if i is not None else '')
        title='今回'+({'stone':'：石','wood':'：木','plant':'：草'}.get(i, f'：{i+1}' if isinstance(i,int) else ''))
        players.append(player(title,preview(name+'-game',OUT/f'{name}.mp3',gain*.5*.8)))
    fxcards.append(card(label,desc,players))
amb=[]
for name,label,gain in [('shore','岸辺',.4),('fire','焚き火',.6),('torch','松明の燃焼',.18),('rain','雨',.55),('drop-0','水滴1',.16),('drop-1','水滴2',.16),('birds-0','鳥1',.36),('birds-1','鳥2',.36),('birds-2','鳥3',.36),('bgm-explore','探索BGM',.55),('bgm-camp','キャンプBGM',.55),('bgm-cave','洞窟BGM',.55)]:
    amb.append(card(label,'前回の改善音源を保持。ゲーム内の初期音量で試聴できます。',[player('今回',preview(name+'-default',OUT/f'{name}.mp3',gain*(.3 if name.startswith('bgm-') else .7)*.8))]))
import re
style=re.search(r'<style>(.*?)</style>',(before/'review/index.html').read_text(encoding='utf-8'),re.S)[1]
html='''<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>柔らかな環境音と効果音</title><style>'''+style+'''nav{display:flex;gap:18px;flex-wrap:wrap;margin:24px 0}section{scroll-margin-top:100px}.pair>div{min-width:0}h2{scroll-margin-top:100px}</style><main><header><small>CRO-MAGNON · SOUND REVIEW · REVISION 3</small><h1>柔らかな風と、控えめな音。</h1><p>風と川をさらに小さく。削除した17分類の音も作り直し、ゲームへ戻しました。</p><nav><a href="#environment">風と川</a><a href="#effects">戻した効果音</a><a href="#retained">環境音・鳥・BGM</a></nav></header><div class="bar"><p>今回の音はゲームの初期音量。大きく補正していません。<br>旧効果音は削除前の試聴版を下げた音色の参考です。</p><button id="stop">すべて停止</button></div><section id="environment">'''+''.join(cards)+'''</section><section id="effects"><h2>戻した効果音 — 17分類</h2><p>足音・動作・通知の音量は、ゲームの設定で独立して変えられます。足音は歩行時、局所音は近距離の基準です。</p>'''+''.join(fxcards)+'''</section><section id="retained"><h2>引き続き残している音</h2>'''+''.join(amb)+'''</section><footer>一度に再生するのは1つだけです。素材・ライセンス・加工値はプロジェクトに記録。<br>CC0素材：<a href="https://kenney.nl/assets/impact-sounds">Kenney</a> · <a href="https://opengameart.org/content/footsteps-leather-cloth-armor">HaelDB</a> · <a href="https://opengameart.org/content/42-snow-and-gravel-footsteps">Corsica_S / qubodup</a> · <a href="https://opengameart.org/content/40-cc0-water-splash-slime-sfx">rubberduck</a> · <a href="https://opengameart.org/content/swish-bamboo-stick-weapon-swhoshes">qubodup</a> · <a href="https://freesound.org/people/Zabuhailo/sounds/146963/">Zabuhailo</a> · <a href="https://versilian-studios.com/vsco-community/">Versilian Studios</a>。その他の素材はCREDITS.txtを参照。</footer></main><script>const players=[...document.querySelectorAll('audio')];for(const a of players)a.addEventListener('play',()=>players.forEach(b=>{if(a!==b)b.pause()}));document.querySelector('#stop').onclick=()=>players.forEach(a=>{a.pause();a.currentTime=0});</script></html>'''
(REVIEW/'index.html').write_text(html,encoding='utf-8',newline='\n')
(REVIEW/'default-levels.json').write_text(json.dumps(records,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
print('Audition players:',html.count('<audio'))
