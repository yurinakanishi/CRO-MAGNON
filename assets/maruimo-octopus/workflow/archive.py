"""Retain all Maruimo sources, failed revisions, editable scenes and reviewed delivery."""
import hashlib,json,sys
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
ASSETS=ROOT/'assets/maruimo-octopus'
SOURCE=ROOT/'output/model-generation/models/maruimo-octopus'
DEST=ROOT.parent/'threed-model-creation/models/maruimo-octopus'
assert DEST.resolve().parent==(ROOT.parent/'threed-model-creation/models').resolve()
manifest=json.loads((ROOT/'public/models/maruimo-octopus/asset.json').read_text(encoding='utf8'))
assert manifest['status']=='game-integrated'
revision=manifest['revision']; records=[]
def sha(data):return hashlib.sha256(data).hexdigest()
def keep(relative,data):
    target=DEST/relative;target.parent.mkdir(parents=True,exist_ok=True)
    digest=sha(data)
    if target.exists():assert sha(target.read_bytes())==digest,'Refusing to overwrite '+str(target)
    else:target.write_bytes(data)
    assert sha(target.read_bytes())==digest
    records.append(dict(path=str(relative).replace('\\','/'),sha256=digest,bytes=len(data)))
def copy(source,relative):keep(relative,source.read_bytes())
def tree(source,prefix=Path()):
    for path in sorted(source.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:copy(path,prefix/path.relative_to(source))
def write(relative,value):keep(relative,(json.dumps(value,ensure_ascii=False,indent=2)+'\n').encode('utf8'))
tree(SOURCE)
tree(ASSETS/'workflow',Path('workflow'))
tree(ASSETS/'source',Path('source/retained-references'))
tree(ROOT/'public/models/maruimo-octopus',Path('delivery'))
tree(ROOT/'output/playwright/maruimo',Path('qa/game'))
for name in ['README.md','adoption.json','validation.json','revision-history.json','game-qa.json']:
    copy(ASSETS/name,Path('qa/game-records')/name)
for name in ['shared/types.mts','shared/characters.mts','shared/combat-profiles.mts','shared/combat.mts',
             'shared/rimo-neko.mts','shared/companion-524.mts',
             'src/octopus-pose.ts','src/character-assets.ts','src/performance-lod.ts','src/world3d.ts','src/style.css',
             'tests/maruimo.test.mjs','tests/octopus-pose.test.mjs']:
    copy(ROOT/name,Path('qa/game-source')/name)
for name in ['blender_reduce.py','skin_weights.py','graph_tools.py','glb_skin.py']:
    copy(ROOT/'assets/rimo-neko/workflow/lib'/name,Path('workflow/shared-lib')/name)
copy(SOURCE/f'qa/final-{revision}/viewer.html','qa/candidate-1/viewer.html')
copy(SOURCE/f'qa/final-{revision}/viewer.json','qa/candidate-1/viewer.json')
paths=dict(original='source/retained-references/user-reference.png',reference='source/retained-references/reference-v2.png',
           dense='work/trellis/dense-attempt-03-res1024-seed0042.glb',candidate=f'work/rig/revision-{revision}/candidate.glb',
           editable=f'work/rig/revision-{revision}/source.blend',lod='delivery/'+Path(manifest['lods'][0]['url']).name,viewer='qa/candidate-1/viewer.html')
artifacts={k:dict(path=v,sha256=sha((DEST/v).read_bytes())) for k,v in paths.items()}
write('model.json',dict(schema_version=1,model_key='maruimo-octopus',name='まるぃも タコ人間',slug='maruimo-octopus',
      lifecycle_status='game-integrated',artifacts=artifacts,
      provenance=dict(candidate=1,revision=revision,agent='Codex',claudeUsed=False,trellisRuntime='v0.8.1',gameRepository='../CRO-MAGNON'),
      notes=['All reconstruction attempts and rig revisions retained.','The long appendage is interpreted as the right arm. Back and depth are inferred from one supplied image.','No public or exhibition deployment.']))
write('candidate-index.json',dict(completedCandidates=[dict(number=1,revision=revision,file=paths['candidate'],sha256=manifest['sha256'],viewer=paths['viewer'],decision='integrated in CRO-MAGNON')],nextCandidate=2))
keep('README.md',('''# まるぃも — タコ人間

Candidate 1 / rig r10。CRO-MAGNONの9人目の操作キャラクター。

- [ユーザーの元画像](source/retained-references/user-reference.png)
- [立体復元用の参照v2](source/retained-references/reference-v2.png)
- [GLB内蔵プレビュー](qa/candidate-1/viewer.html)
- [ゲーム採用GLB](delivery/model-r10.glb)
- [編集可能なBlenderファイル](work/rig/revision-10/source.blend)
- [制作と検証の記録](qa/game-records/README.md)
- [採用記録](qa/game-records/adoption.json)
- [修正履歴](qa/game-records/revision-history.json)

元画像・全復元試行・リグrevision・失敗・制作スクリプト・QAを保持。
各artifactのSHAはmodel.json、全保存ファイルの照合一覧はCRO-MAGNON側の
assets/maruimo-octopus/archive.jsonを参照。ゲーム側READMEのパスはCRO-MAGNON基準。
独立HTMLはブラウザー操作ツールのfileプロトコル制約で起動未検証。
同じ配信GLBは既存HTTPプレビューと実Chromeのゲームで確認済み。
''').encode('utf8'))
receipt=dict(destination=str(DEST),files=len(records),bytes=sum(r['bytes'] for r in records),records=records)
(ASSETS/'archive.json').write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:receipt[k] for k in ['destination','files','bytes']},ensure_ascii=False))
