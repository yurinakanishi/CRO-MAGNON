"""Retain the r09 trial and r10 gesture, then refresh the existing Candidate 1.

Writes only this model's canonical library. Existing bytes must match the prior
receipt and are saved in presentation history before any replacement.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path.cwd().resolve()
BASE = ROOT / 'output/model-generation/models/rimo-neko'
DEST = ROOT.parent / 'threed-model-creation/models/rimo-neko'
RECEIPT = ROOT / 'assets/rimo-neko/archive.json'
assert DEST.is_dir() and (DEST / 'model.json').is_file()
prior = json.loads(RECEIPT.read_text(encoding='utf8'))
assert Path(prior['destination']).resolve() == DEST.resolve()
known = {r['path']: r for r in prior['records']}
adoption = json.loads((ROOT / 'assets/rimo-neko/adoption.json').read_text(encoding='utf8'))
assert adoption['revision'] == '10' and adoption['gameValidation'] == 'passed'

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
        assert relative in known and sha(old) == known[relative]['sha256'], 'Unexpected edit: ' + relative
        backup = DEST / 'qa/presentation-history/before-happy-r10' / relative
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

for revision in ['09', '10']:
    tree(BASE / ('work/rig/revision-' + revision), 'work/rig/revision-' + revision)
    tree(BASE / ('qa/rig-' + revision), 'qa/rig-' + revision)
tree(ROOT / 'assets/rimo-neko/workflow', 'workflow')
for path in (ROOT / 'scripts').glob('qa-rimo-*.mjs'):
    copy(path, 'workflow/game-qa/' + path.name)
copy(ROOT / 'assets/rimo-neko/README.md', 'qa/game-readme.md')
copy(ROOT / 'assets/rimo-neko/adoption.json', 'qa/game-adoption.json')
copy(ROOT / 'assets/rimo-neko/history/adoption-r08.json', 'qa/history/adoption-r08.json')
for source in (ROOT / 'output/playwright/rimo-neko').glob('game-happy-r10*'):
    tree(source, 'qa/game/' + source.name)

viewer = json.loads((BASE / 'qa/rig-10/viewer.json').read_text(encoding='utf8'))
assert viewer['sourceSha256'] == adoption['sha256']
assert sha((BASE / 'qa/rig-10/viewer.html').read_bytes()) == viewer['viewerSha256']
copy(BASE / 'qa/rig-10/viewer.html', 'qa/candidate-1/viewer.html')
viewer.update(source='work/rig/revision-10/candidate.glb', viewer='qa/candidate-1/viewer.html')
write('qa/candidate-1/viewer.json', viewer)
copy(BASE / 'qa/rig-10/browser/result.json', 'qa/candidate-1/browser-result.json')
model = json.loads((DEST / 'model.json').read_text(encoding='utf8'))
model['artifacts']['candidate'] = dict(path=viewer['source'], sha256=adoption['sha256'])
model['artifacts']['viewer']['sha256'] = viewer['viewerSha256']
model['provenance']['revision'] = '10'
model['notes'][0] = 'One successful candidate, ten retained rig revisions. Revision 10 changes only Happy from revision 08; r09 retained for its idle tail seam.'
write('model.json', model)
index = json.loads((DEST / 'candidate-index.json').read_text(encoding='utf8'))
assert index['nextCandidate'] == 2 and len(index['completedCandidates']) == 1
index['completedCandidates'][0].update(revision='10', file=viewer['source'], sha256=adoption['sha256'])
write('candidate-index.json', index)
readme = (DEST / 'README.md').read_text(encoding='utf8')
readme = readme.replace('rig revision 08', 'rig revision 10').replace('revision-08/candidate.glb', 'revision-10/candidate.glb')
readme += '\n2026-09-30: Happyを1.6秒の首かしげ・尾を上げる仕草へ変更。ゲームでは撫で終わりに524と同じピンクのハートが5つ上がる。四足接地、Pet/Idleとの境界、元形状と他6動作を確認。旧r09の尾の切替差も履歴として保存。詳細は [ゲーム記録](qa/game-readme.md)。\n'
put('README.md', readme.encode('utf8'))
records = []
for path in sorted(DEST.rglob('*')):
    if path.is_file():
        data = path.read_bytes()
        records.append(dict(path=path.relative_to(DEST).as_posix(), sha256=sha(data), bytes=len(data)))
receipt = dict(destination=str(DEST), files=len(records), bytes=sum(r['bytes'] for r in records), records=records)
RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(dict(files=len(records), bytes=receipt['bytes'], modelSha256=adoption['sha256'], viewerSha256=viewer['viewerSha256'])))
