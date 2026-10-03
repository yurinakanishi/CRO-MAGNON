"""Retain one completed candidate in the canonical model library, without replacing files.

Run from CRO-MAGNON after exact-export and game QA. Existing different bytes fail.
"""
from pathlib import Path
import hashlib,json,shutil

ROOT=Path.cwd().resolve()
SOURCE=ROOT/'output/model-generation/models/rimo-neko'
DEST=ROOT.parent/'threed-model-creation/models/rimo-neko'
assert SOURCE.is_dir() and (ROOT/'assets/rimo-neko/README.md').is_file()
assert DEST.resolve().parent == (ROOT.parent/'threed-model-creation/models').resolve()
records=[]
def digest(data): return hashlib.sha256(data).hexdigest()
def keep(relative,data):
    to=DEST/relative; to.parent.mkdir(parents=True,exist_ok=True)
    sha=digest(data)
    if to.exists():
        if digest(to.read_bytes())!=sha: raise RuntimeError('Refusing to replace retained file: '+str(to))
    else: to.write_bytes(data)
    records.append(dict(path=relative.as_posix(),sha256=sha,bytes=len(data)))
def copy(source,relative): keep(Path(relative),source.read_bytes())
def tree(source,prefix=Path()):
    for path in source.rglob('*'):
        if path.is_file() and '__pycache__' not in path.parts:copy(path,prefix/path.relative_to(source))
def write(relative,value):keep(Path(relative),(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf8'))

tree(SOURCE)
tree(ROOT/'assets/rimo-neko/workflow',Path('workflow'))
for a,b in [('user-reference.jpg','original/user-reference.jpg'),('reference-v1.png','generated/reference-v1.png'),('brief.md','prompts/frozen-request.md')]:
    copy(ROOT/'assets/rimo-neko/source'/a,Path('source')/b)
copy(ROOT/'assets/rimo-neko/README.md','qa/game-readme.md')
copy(ROOT/'assets/rimo-neko/adoption.json','qa/game-adoption.json')
tree(ROOT/'output/playwright/rimo-neko',Path('qa/game'))
copy(SOURCE/'qa/rig-03/viewer.html','qa/candidate-1/viewer.html')
copy(SOURCE/'qa/rig-03/browser/result.json','qa/candidate-1/browser-result.json')
viewer=json.loads((SOURCE/'qa/rig-03/viewer.json').read_text())
viewer.update(source='work/rig/revision-03/candidate.glb',viewer='qa/candidate-1/viewer.html')
write('qa/candidate-1/viewer.json',viewer)
keys={'original':'source/original/user-reference.jpg','reference':'source/generated/reference-v1.png',
      'conditioning':'source/prepared/reference_cutout.png','dense':'work/trellis/dense-res1024-seed0042.glb',
      'candidate':'work/rig/revision-03/candidate.glb','viewer':'qa/candidate-1/viewer.html'}
artifacts={k:dict(path=v,sha256=digest((DEST/v).read_bytes())) for k,v in keys.items()}
write('model.json',dict(schema_version=1,model_key='rimo-neko',name='りもねこ',slug='rimo-neko',lifecycle_status='game-integrated',artifacts=artifacts,
 provenance=dict(candidate=1,revision='03',agent='Codex',claudeUsed=False,trellisRuntime='v0.8.1',gameRepository='../CRO-MAGNON'),
 notes=['One successful candidate, three retained rig revisions.','Not published to Meshmell or social media.']))
write('candidate-index.json',dict(completedCandidates=[dict(number=1,revision='03',file=keys['candidate'],sha256=artifacts['candidate']['sha256'],viewer=keys['viewer'],decision='integrated in CRO-MAGNON')],nextCandidate=2))
keep(Path('README.md'),'''# りもねこ — Candidate 1

ゲームCRO-MAGNONの依頼で制作した1件の候補。2026-09-28完成、rig revision 03。

プレビューは [ローカルビューアー](qa/candidate-1/viewer.html)。正確な採用GLBとビューアーを内蔵し、通信なしで回転・拡大・7動作の再生を確認できる。
最終GLBは `work/rig/revision-03/candidate.glb`。元画像・TRELLIS高密度出力・補修前後・Blender・制作スクリプト・検査画像と失敗記録を保持。
詳細は [ゲームへの組込みと検証](qa/game-readme.md)、元の要求は `source/prompts/frozen-request.md`。
`workflow/` の実行基点は隣のCRO-MAGNON。保存時のログは元の実行場所を記録したまま保持している。
外部公開、Git remote操作、Candidate 2の生成は行っていない。
'''.encode('utf8'))
receipt=dict(destination=str(DEST),files=len(records),bytes=sum(x['bytes'] for x in records),records=records)
(ROOT/'assets/rimo-neko/archive.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:receipt[k] for k in ['destination','files','bytes']},ensure_ascii=False))
