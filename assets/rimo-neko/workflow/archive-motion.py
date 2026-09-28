"""Retain motion revisions and refresh Candidate 1 only after game validation.

Run from CRO-MAGNON. Every changed library file must match the prior receipt;
its previous bytes are retained before replacement. No unrelated model is touched.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path.cwd().resolve()
BASE = ROOT / 'output/model-generation/models/rimo-neko'
DEST = ROOT.parent / 'threed-model-creation/models/rimo-neko'
RECEIPT = ROOT / 'assets/rimo-neko/archive.json'
assert DEST.resolve() == (ROOT.parent / 'threed-model-creation/models/rimo-neko').resolve()
assert DEST.is_dir() and (DEST / 'model.json').is_file()
prior = json.loads(RECEIPT.read_text(encoding='utf8'))
assert Path(prior['destination']).resolve() == DEST.resolve()
known = {r['path']: r for r in prior['records']}
adoption = json.loads((ROOT / 'assets/rimo-neko/adoption.json').read_text(encoding='utf8'))
assert adoption['revision'] == '08' and adoption['gameValidation'] == 'passed'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def put(relative, data):
    relative = Path(relative).as_posix()
    target = DEST / relative
    assert target.resolve().is_relative_to(DEST.resolve())
    if target.exists():
        old = target.read_bytes()
        if old == data:
            return
        assert relative in known and sha(old) == known[relative]['sha256'], 'Unexpected existing edit: ' + relative
        backup = DEST / 'qa/presentation-history/before-motion-r08' / relative
        backup.parent.mkdir(parents=True, exist_ok=True)
        if backup.exists():
            assert backup.read_bytes() == old, 'History differs: ' + relative
        else:
            backup.write_bytes(old)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
    assert sha(target.read_bytes()) == sha(data)


def copy(source, relative):
    put(relative, source.read_bytes())


def tree(source, relative):
    for path in source.rglob('*'):
        if path.is_file() and '__pycache__' not in path.parts:
            copy(path, Path(relative) / path.relative_to(source))


def write(relative, value):
    put(relative, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf8'))


for revision in ['04', '05', '06', '07', '08']:
    tree(BASE / ('work/rig/revision-' + revision), 'work/rig/revision-' + revision)
    tree(BASE / ('qa/rig-' + revision), 'qa/rig-' + revision)
tree(ROOT / 'assets/rimo-neko/workflow', 'workflow')
for path in (ROOT / 'scripts').glob('qa-rimo-*.mjs'):
    copy(path, 'workflow/game-qa/' + path.name)
copy(ROOT / 'scripts/adopt-rimo-neko.mjs', 'workflow/game-qa/adopt-rimo-neko.mjs')
copy(ROOT / 'assets/rimo-neko/README.md', 'qa/game-readme.md')
copy(ROOT / 'assets/rimo-neko/motion-research-2026-09-28.md', 'qa/motion-research-2026-09-28.md')
copy(ROOT / 'assets/rimo-neko/adoption.json', 'qa/game-adoption.json')
copy(ROOT / 'assets/rimo-neko/history/adoption-r03.json', 'qa/history/adoption-r03.json')
for source in (ROOT / 'output/playwright/rimo-neko').glob('game-motion-r08*'):
    tree(source, 'qa/game/' + source.name)

viewer = json.loads((BASE / 'qa/rig-08/viewer.json').read_text(encoding='utf8'))
assert viewer['sourceSha256'] == adoption['sha256']
assert sha((BASE / 'qa/rig-08/viewer.html').read_bytes()) == viewer['viewerSha256']
copy(BASE / 'qa/rig-08/viewer.html', 'qa/candidate-1/viewer.html')
viewer.update(source='work/rig/revision-08/candidate.glb', viewer='qa/candidate-1/viewer.html')
write('qa/candidate-1/viewer.json', viewer)
copy(BASE / 'qa/rig-08/browser/result.json', 'qa/candidate-1/browser-result.json')

model = json.loads((DEST / 'model.json').read_text(encoding='utf8'))
model['artifacts']['candidate'] = dict(path=viewer['source'], sha256=adoption['sha256'])
model['artifacts']['viewer']['sha256'] = viewer['viewerSha256']
model['provenance']['revision'] = '08'
model['notes'][0] = 'One successful candidate, eight retained rig revisions. Revision 08 changes only Hiss and Run_Loop from revision 03.'
write('model.json', model)
index = json.loads((DEST / 'candidate-index.json').read_text(encoding='utf8'))
assert index['nextCandidate'] == 2 and len(index['completedCandidates']) == 1
index['completedCandidates'][0].update(revision='08', file=viewer['source'], sha256=adoption['sha256'])
write('candidate-index.json', index)
readme = (DEST / 'README.md').read_text(encoding='utf8')
readme = readme.replace('rig revision 03', 'rig revision 08').replace('revision-03/candidate.glb', 'revision-08/candidate.glb')
if '1/4速度' not in readme:
    readme += '\n2026-09-28にGoogleの実猫資料・動画を調べ、低く身構える威嚇とギャロップへ修正。プレビューは通常・1/2・1/4速度を選べる。形状と残る5動作を保持し、旧版・試作・失敗検査も保存。出典は [動作資料](qa/motion-research-2026-09-28.md)。\n'
put('README.md', readme.encode('utf8'))

records = []
for path in sorted(DEST.rglob('*')):
    if path.is_file():
        data = path.read_bytes()
        records.append(dict(path=path.relative_to(DEST).as_posix(), sha256=sha(data), bytes=len(data)))
receipt = dict(destination=str(DEST), files=len(records), bytes=sum(r['bytes'] for r in records), records=records)
RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(dict(files=len(records), bytes=receipt['bytes'], modelSha256=adoption['sha256'], viewerSha256=viewer['viewerSha256'])))
