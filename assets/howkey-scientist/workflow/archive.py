"""Save the completed Howkey candidate and all failed revisions in the model library.

Run from CRO-MAGNON. Never replace different bytes at an existing archive path.
"""
from pathlib import Path
import hashlib
import json

ROOT = Path.cwd().resolve()
SOURCE = ROOT / 'output/model-generation/models/howkey-scientist'
ASSETS = ROOT / 'assets/howkey-scientist'
DEST = ROOT.parent / 'threed-model-creation/models/howkey-scientist'
assert SOURCE.is_dir() and (ASSETS / 'README.md').is_file()
assert DEST.resolve().parent == (ROOT.parent / 'threed-model-creation/models').resolve()
records = []

def digest(data):
    return hashlib.sha256(data).hexdigest()

def keep(relative, data):
    relative = Path(relative)
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    sha = digest(data)
    if target.exists():
        if digest(target.read_bytes()) != sha:
            raise RuntimeError('Refusing to replace retained file: ' + str(target))
    else:
        target.write_bytes(data)
    assert digest(target.read_bytes()) == sha
    records.append(dict(path=relative.as_posix(), sha256=sha, bytes=len(data)))

def copy(source, relative):
    keep(relative, source.read_bytes())

def tree(source, prefix=Path()):
    for path in sorted(source.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            copy(path, prefix / path.relative_to(source))

def write(relative, value):
    keep(relative, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))

tree(SOURCE)
tree(ASSETS / 'workflow', Path('workflow'))
tree(ASSETS / 'source', Path('source/retained-references'))
for name in ['README.md', 'adoption.json', 'validation.json', 'revision-history.json']:
    copy(ASSETS / name, Path('qa/game-records') / name)
tree(ROOT / 'output/playwright/howkey', Path('qa/game'))
tree(ROOT / 'output/playwright/exhibition-menu-1790587404268', Path('qa/exhibition-menu'))
for path in sorted((ROOT / 'output').glob('howkey-*.log')):
    copy(path, Path('qa/logs') / path.name)
for path in sorted((ROOT / 'output').glob('exhibition-20260928-howkey-r01*.json')):
    copy(path, Path('qa/exhibition-delivery') / path.name)
copy(ROOT / 'docs/howkey-delivery-2026-09-28.md', 'qa/exhibition-delivery/README.md')
copy(ROOT / 'output/exhibition-20260928-howkey-r01/exhibition-build.json', 'qa/exhibition-delivery/exhibition-build.json')
for name in ['09_01.amc', '09.asf', '35_01.amc', '35.asf', 'cmu-faq.html', 'subject-09.html', 'subject-35.html']:
    copy(ROOT / 'assets/human-locomotion/source' / name, Path('source/motion/cmu') / name)
copy(ROOT / 'assets/human-locomotion/README.md', 'source/motion/README.md')
for file in ['src/ground-petting-pose.ts', 'src/spell-effects.ts', 'shared/characters.mts',
             'shared/combat-profiles.mts', 'shared/combat.mts', 'shared/rimo-neko.mts',
             'src/character-assets.ts', 'src/main.ts', 'src/style.css', 'src/world3d.ts',
             'scripts/qa-howkey-game.mjs', 'scripts/qa-howkey-viewer.mjs', 'scripts/qa-howkey-detail.mjs',
             'scripts/adopt-howkey.mjs', 'scripts/adopt-howkey-lod.mjs', 'tests/howkey.test.mjs']:
    copy(ROOT / file, Path('qa/game-source') / file)
copy(SOURCE / 'qa/final-11/viewer.html', 'qa/candidate-1/viewer.html')
viewer = json.loads((SOURCE / 'qa/final-11/viewer.json').read_text(encoding='utf-8'))
viewer.update(source='work/final/revision-11/howkey-scientist/model-downed-r01.glb', viewer='qa/candidate-1/viewer.html')
write('qa/candidate-1/viewer.json', viewer)
copy(ROOT / 'output/playwright/howkey/viewer-r11/result.json', 'qa/candidate-1/browser-result.json')
copy(ROOT / 'public/models/howkey-scientist/asset.json', 'delivery/asset.json')
copy(ROOT / 'public/models/howkey-scientist/portrait.png', 'delivery/portrait.png')
paths = {
    'original1': 'source/retained-references/user-reference-01.png',
    'original2': 'source/retained-references/user-reference-02.webp',
    'reference': 'source/retained-references/reference-v2.png',
    'conditioning': 'source/prepared-02/reference_cutout.png',
    'dense': 'work/trellis/dense-attempt-02-res1024-seed0042.glb',
    'candidate': 'work/final/revision-11/howkey-scientist/model-downed-r01.glb',
    'editable': 'work/final/revision-11/howkey-scientist/source.blend',
    'lod': 'work/final/revision-11/howkey-scientist/lod-performance-r02.glb',
    'viewer': 'qa/candidate-1/viewer.html',
}
artifacts = {k: dict(path=v, sha256=digest((DEST / v).read_bytes())) for k, v in paths.items()}
write('model.json', dict(schema_version=1, model_key='howkey-scientist', name='Howkey 科学使い',
    slug='howkey-scientist', lifecycle_status='game-integrated', artifacts=artifacts,
    provenance=dict(candidate=1, revision='11', rigRevision='05', locomotionRevision='10',
                    agent='Codex', claudeUsed=False, trellisRuntime='v0.8.1', gameRepository='../CRO-MAGNON'),
    notes=['One successful candidate. Both reconstructions and all failed/accepted rigs retained.',
           'User portraits do not show trousers, shoes or back; those are an authored interpretation.',
           'PC0 has a verified standby build. No PC1/PC2/PC3 deployment or public publication.']))
write('candidate-index.json', dict(completedCandidates=[dict(number=1, revision='11', file=paths['candidate'],
    sha256=artifacts['candidate']['sha256'], viewer=paths['viewer'], decision='integrated in CRO-MAGNON')], nextCandidate=2))
keep('README.md', '''# Howkey 科学使い — Candidate 1

2026-09-28。添付の人物画から制作した、CRO-MAGNONの8人目の操作キャラクター。
Candidate 1 / delivery r11、66,406三角形・28骨・10動作。

[ローカルプレビュー](qa/candidate-1/viewer.html) は正確な採用GLBを内蔵。
通信なしで回転・拡大・10動作・通常／1/2／1/4速度・時間指定を確認できる。
Attackは手のアニメーションで、科学パルスの発光・命中はゲーム側の実装。

採用GLBと編集用Blenderは `work/final/revision-11/howkey-scientist/`。
原画像と生成参照は `source/retained-references/`、高密度復元・全試作は `work/`。
全2,056姿勢と実ゲーム操作、検査画像・録画、失敗した検査も `qa/` に保持している。
詳細は [ゲーム実装と検証](qa/game-records/README.md)、[配布記録](qa/exhibition-delivery/README.md)。
ゲーム資料のパスは元のCRO-MAGNON基点のまま保存。
`workflow/` の再実行基点もCRO-MAGNON。採用候補を上書きしない。
外部公開・SNS投稿・Git操作・Candidate 2の生成は行っていない。
'''.encode('utf-8'))
receipt = dict(destination=str(DEST), files=len(records), bytes=sum(r['bytes'] for r in records), records=records)
(ASSETS / 'archive.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({k: receipt[k] for k in ['destination', 'files', 'bytes']}, ensure_ascii=False))
