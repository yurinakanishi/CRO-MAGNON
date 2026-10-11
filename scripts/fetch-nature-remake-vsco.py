"""Download the CC0 VSCO 2 CE instrument samples used by compose-nature-music.py.

Explicit network step (GitHub raw, pinned commit). Writes only under
assets/nature-audio/remake-20261011/source/vsco and records SHA-256 + bytes.
"""
import hashlib, json, pathlib, sys, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor

ROOT = pathlib.Path(__file__).resolve().parents[1]
TREE = ROOT / 'assets/nature-audio/quality-source/vsco-tree.json'
OUT = ROOT / 'assets/nature-audio/remake-20261011/source/vsco'
COMMIT = '440300901dfe9275fd84e0b7763af1f8443ae62e'
# Soft layers only: the score never asks for loud attacks.
SETS = [
    ('Keys/Upright Piano/', lambda n: n.startswith('Player_dyn1') or n.startswith('Player_dyn2') or n.endswith('.txt')),
    ('Keys/Upright Nr1/', lambda n: '_pp_' in n or '_mf_' in n),
    ('Strings/Harp/', lambda n: True),
    ('Strings/Violin Section/susVib/', lambda n: '_v1' in n),
    ('Strings/Viola Section/susvib/', lambda n: '_v1_' in n),
    ('Strings/Cello Section/susvib/', lambda n: '_v1_' in n),
    ('Strings/Solo Contrabass/SusNV/', lambda n: '_v1_' in n),
    ('Woodwinds/Flute/susvib/', lambda n: True),
    ('Woodwinds/Flute/susNV/', lambda n: True),
    ('Brass/F Horn/sus/', lambda n: '_v1_' in n),
    ('Percussion/Marimba/', lambda n: True),
    ('Miscellania Raw/Misc 2/NepaleseBells/', lambda n: True),
    ('Miscellania Raw/Misc 2/rtomtom', lambda n: True),
    ('Percussion/bassdrum_rub', lambda n: True),
    ('Percussion/susCymb1-bow', lambda n: True),
    ('LICENSE', lambda n: True),
]


def wanted(items):
    for item in items:
        if item.get('type') != 'blob':
            continue
        path = item['path']
        for prefix, keep in SETS:
            if path.startswith(prefix) and keep(path.split('/')[-1]):
                yield item
                break


def fetch(item):
    path = item['path']
    target = OUT / path
    if not (target.exists() and target.stat().st_size == item.get('size', -1)):
        target.parent.mkdir(parents=True, exist_ok=True)
        url = f'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/{COMMIT}/' + urllib.parse.quote(path)
        with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'cro-magnon-audio'}), timeout=300) as r:
            target.write_bytes(r.read())
    data = target.read_bytes()
    return {'path': path, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest(),
            'url': f'https://raw.githubusercontent.com/sgossner/VSCO-2-CE/{COMMIT}/{path}'}


if __name__ == '__main__':
    items = list(wanted(json.loads(TREE.read_text(encoding='utf-8'))['tree']))
    print(len(items), 'files', round(sum(i.get('size', 0) for i in items) / 1e6, 1), 'MB', flush=True)
    with ThreadPoolExecutor(4) as pool:
        rows = []
        for row in pool.map(fetch, items):
            rows.append(row)
            if len(rows) % 20 == 0:
                print(len(rows), flush=True)
    rows.sort(key=lambda r: r['path'])
    (OUT / 'vsco-files.json').write_text(json.dumps({'repository': 'https://github.com/sgossner/VSCO-2-CE',
        'commit': COMMIT, 'license': 'CC0-1.0', 'author': 'Versilian Studios / Sam Gossner & Simon Dalzell; cutting: Elan Hickler',
        'files': rows}, indent=1) + '\n', encoding='utf-8', newline='\n')
    print('done', len(rows), file=sys.stderr)
