"""Local listening page for the 2026-10-11 audio remake (no network, no game state).

Writes output/nature-audio-remake-20261011/index.html. New sounds play at their in-game
relative level (the same calibration as src/nature-audio-levels.ts, at a typical
distance); before/after pairs play at matched loudness so only the sound quality differs.
Game recordings come from scripts/qa-nature-audio-remake.mjs.
"""
import html, json, math, pathlib, re, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/nature-audio-remake-20261011'
NEW = ROOT / 'public/audio/nature'
OLD = ROOT / 'assets/nature-audio/before-remake-20261011/audio'
RUN = sys.argv[1] if len(sys.argv) > 1 else 'output/playwright/nature-audio-remake-20261011/game-r04'

levels_ts = (ROOT / 'src/nature-audio-levels.ts').read_text(encoding='utf-8')
LEVELS = {m[0]: (float(m[1]), float(m[2]), m[3]) for m in re.findall(
    r"'?([\w-]+)'?: \{\s*dba: ([\d.]+),\s*at: ([\d.]+),\s*spread: '(\w+)'", levels_ts)}
cal = re.search(r'CALIBRATION = Object\.freeze\(\{ dba: ([\d.]+), lufs: (-?[\d.]+), slope: ([\d.]+)', levels_ts)
PIVOT, PIVOT_LUFS, SLOPE = (float(v) for v in cal.groups())
fixed = dict(re.findall(r'(\w+): (-?\d+)', re.search(r'FIXED_LUFS = Object\.freeze\(\{([^}]*)\}', levels_ts).group(1)))
TYPICAL = {'river': 1, 'stream': 1, 'waterfall': 20, 'shore': 10, 'fire': 3, 'birds': 25, 'drop': 4, 'hiss': 3}


def level_at(name, distance):
    dba, at, spread = LEVELS[name]
    if spread == 'bed':
        return dba
    d = max(at, distance)
    return dba - (10 if spread == 'line' else 20) * math.log10(d / at) - 0.04 * (d - at)


def game_lufs(name):
    base = re.sub(r'^fx-', '', name)
    base = re.sub(r'-\d+$', '', base)
    if name.startswith('bgm-'):
        return float(fixed['music']), 'BGM（固定）'
    if base in ('confirm', 'discovery'):
        return float(fixed[base]), '通知（固定）'
    if base == 'cave-ir':
        return None, ''
    if base == 'wind':
        dba = 33.5 + 15 * 0.35
        where = '中程度の風'
    else:
        dba = level_at(base, TYPICAL.get(base, 0))
        where = f'{TYPICAL[base]} m' if base in TYPICAL else '本人'
    return PIVOT_LUFS + SLOPE * (dba - PIVOT), f'{dba:.0f} dBA（{where}）'


def loudness(path):
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', str(path), '-af', 'ebur128', '-f', 'null', '-'],
                       capture_output=True)
    text = p.stderr.decode(errors='replace')
    return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', text)[-1])


manifest = json.loads((NEW / 'manifest.json').read_text(encoding='utf-8'))
rows = []
for f in manifest['files']:
    target, label = game_lufs(f['name'])
    if target is None:
        continue
    rows.append((f, target, label))
loudest = max(t for _, t, _ in rows)
LABELS = {'loop': '環境音ループ', 'oneshot': '単発音', 'music': 'BGM'}


def player(src, volume, title, detail):
    return (f'<figure><figcaption><b>{html.escape(title)}</b><span>{html.escape(detail)}</span></figcaption>'
            f'<audio controls preload="none" src="{src}" data-volume="{volume:.4f}"></audio></figure>')


sections = []
recordings = [('camp-ambience', 'キャンプ（環境音のみ）'), ('camp-steps-only', 'キャンプで歩く（足音のみ）'),
              ('camp-full-mix', 'キャンプ（全体）'), ('river-bank-ambience', '川岸（環境音のみ）'),
              ('waterfall-ambience', '滝から約22 m（環境音のみ）'), ('cave-mix', '洞窟（松明・水滴・BGM）')]
summary = json.loads((ROOT / RUN / 'summary.json').read_text(encoding='utf-8'))
items = []
for name, title in recordings:
    lv = summary['levels'].get(name, {})
    detail = f"{lv.get('integrated', '?')} LUFS / 実世界換算 " + ', '.join(f'{k} {v}' for k, v in lv.get('dba', {}).items())
    items.append(player(f'../../{RUN}/{name}.webm', 1.0, title, detail))
sections.append(('実ゲームの録音（保存なしの実Chrome、初期設定100%、そのままの音量）', items))

items = []
for f, target, label in rows:
    # In-game loudness relative to the loudest sound, corrected for the file's own level.
    volume = min(1.0, 10 ** ((target - loudest) / 20) * 10 ** ((-23 - f['loudness']) / 20))
    items.append(player(f"../../public/audio/nature/{f['name']}.mp3", volume, f['name'],
                        f"{LABELS.get(f['kind'], f['kind'])}・{label}・ゲーム内 {target:.1f} LUFS"))
sections.append(('新しい全音源（ゲーム内の相対音量で再生）', items))

pairs = [('wind', 'wind'), ('river', 'river'), ('rain', 'rain'), ('shore', 'shore'), ('fire', 'fire'),
         ('birds-0', 'birds-0'), ('fx-step-grass-0', 'fx-step-grass-0'), ('fx-step-stone-0', 'fx-step-stone-0'),
         ('fx-step-water-0', 'fx-step-water-0'), ('fx-attack-0', 'fx-attack-0'), ('fx-hurt-0', 'fx-hurt-0'),
         ('fx-jump-0', 'fx-jump-0'), ('bgm-explore', 'bgm-explore'), ('bgm-camp', 'bgm-camp'), ('bgm-cave', 'bgm-cave')]
items = []
for old, new in pairs:
    a, b = OLD / f'{old}.mp3', NEW / f'{new}.mp3'
    la, lb = loudness(a), loudness(b)
    ref = max(la, lb)
    items.append(player(f'../../assets/nature-audio/before-remake-20261011/audio/{old}.mp3', 10 ** ((min(la, lb) - la) / 20),
                        f'旧 {old}', f'素材 {la:.1f} LUFS → 同じ平均音量で再生'))
    items.append(player(f'../../public/audio/nature/{new}.mp3', 10 ** ((min(la, lb) - lb) / 20),
                        f'新 {new}', f'素材 {lb:.1f} LUFS → 同じ平均音量で再生'))
sections.append(('旧版との音質比較（平均音量を揃えて再生。音量差ではなく質感の比較）', items))

body = ''.join(f'<section><h2>{html.escape(t)}</h2><div class="grid">{"".join(i)}</div></section>' for t, i in sections)
page = f'''<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>音の作り直し 試聴</title><style>
:root{{color-scheme:light dark;--bg:#f6f4ef;--fg:#1f1d1a;--muted:#6b665d;--card:#fff;--line:#ddd6c8}}
@media (prefers-color-scheme:dark){{:root{{--bg:#151412;--fg:#ece8e0;--muted:#a59f93;--card:#1f1d1a;--line:#36322c}}}}
body{{margin:0;background:var(--bg);color:var(--fg);font:15px/1.6 system-ui,sans-serif}}main{{max-width:1100px;margin:auto;padding:16px}}
h1{{font-size:22px;margin:8px 0}}h2{{font-size:17px;margin:28px 0 10px}}p{{color:var(--muted)}}
.grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr));gap:10px}}
figure{{margin:0;padding:10px 12px;background:var(--card);border:1px solid var(--line);border-radius:10px}}
figcaption{{display:flex;flex-direction:column;margin-bottom:6px}}figcaption span{{color:var(--muted);font-size:13px}}audio{{width:100%}}
</style></head><body><main><h1>音の作り直し 試聴（2026-10-11）</h1>
<p>一度に一つずつ再生してください。自動再生はしません。数値は FFmpeg EBU R128 測定値。dBA は現実の音圧レベル（ゲーム内の基準表 src/nature-audio-levels.ts）。聴感の最終判断は実際に聴いて行ってください。</p>
{body}</main><script>
for (const a of document.querySelectorAll('audio')) {{ a.volume = Number(a.dataset.volume); a.addEventListener('play', () => {{ for (const b of document.querySelectorAll('audio')) if (b !== a) b.pause(); }}); }}
</script></body></html>'''
OUT.mkdir(parents=True, exist_ok=True)
(OUT / 'index.html').write_text(page, encoding='utf-8', newline='\n')
print(OUT / 'index.html', sum(len(i) for _, i in sections), 'players')
