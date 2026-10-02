"""Archive each independent Candidate 1 without replacing any existing file.

Only the five named new model directories in the canonical library are writable.
All attempts, revisions, exact-file previews and final game evidence are retained.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
LIBRARY = (ROOT.parent / 'threed-model-creation/models').resolve()
p = argparse.ArgumentParser()
p.add_argument('--game-qa', required=True)
a = p.parse_args()
GAME_QA = (ROOT / a.game_qa).resolve()
assert GAME_QA.is_relative_to((ROOT / 'output/playwright/orb-bots').resolve())
assert json.loads((GAME_QA / 'result.json').read_text())['passed']
sha = lambda data: hashlib.sha256(data).hexdigest()
receipt = []
revisions = json.loads((ROOT / 'assets/orb-bots/revisions.json').read_text())
for colour in ['white', 'blue', 'green', 'purple', 'orange']:
    revision = revisions[colour]
    key = 'orb-bot-' + colour
    source = ROOT / 'output/model-generation/models' / key
    target = LIBRARY / key
    assert target.resolve().parent == LIBRARY
    adoption = json.loads((ROOT / f'assets/orb-bots/reviews/{colour}-r{revision}.json').read_text(encoding='utf8'))
    assert adoption['decision'] == 'adopt' and adoption['gameIntegrationVerified']
    manifest = json.loads((ROOT / f'public/models/{key}/asset.json').read_text(encoding='utf8'))
    assert manifest['sha256'] == adoption['sha256']

    def put(relative, data):
        dest = target / relative
        assert dest.resolve().is_relative_to(target.resolve())
        if dest.exists():
            assert dest.read_bytes() == data, f'Keep existing library file: {dest}'
        else:
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_bytes(data)
        assert sha(dest.read_bytes()) == sha(data)

    def tree(folder, relative):
        for path in sorted(folder.rglob('*')):
            if path.is_file() and '__pycache__' not in path.parts:
                put(Path(relative) / path.relative_to(folder), path.read_bytes())

    def record(relative, value):
        put(relative, (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode('utf8'))

    tree(source, '.')
    tree(ROOT / 'assets/orb-bots/workflow', 'workflow')
    put('workflow/revisions.json', (ROOT / 'assets/orb-bots/revisions.json').read_bytes())
    for log in (ROOT / 'output').glob('orb-' + colour + '-*.log'):
        put('qa/process-logs/' + log.name, log.read_bytes())
    for log in (ROOT / 'output').glob('orb-bots-*.log'):
        put('qa/process-logs/' + log.name, log.read_bytes())
    put('source/imagegen-tool-calls.txt', (ROOT / 'assets/orb-bots/source/imagegen-tool-calls.txt').read_bytes())
    for path in (ROOT / 'assets/orb-bots/reviews').glob(colour + '-*.json'):
        put('qa/reviews/' + path.name, path.read_bytes())
    for path in (ROOT / 'assets/orb-bots/history').glob(colour + '-*.json'):
        put('qa/history/' + path.name, path.read_bytes())
    put('qa/padding-preservation.json', (ROOT / 'assets/orb-bots/padding-preservation.json').read_bytes())
    for name in ['adoption.json', 'local-delivery.json']:
        put('qa/' + name, (ROOT / 'assets/orb-bots' / name).read_bytes())
    put('qa/local-save-verification.json', (ROOT / 'output/orb-bots-server/20261001-before-start/verification.json').read_bytes())
    tree(GAME_QA.parent, 'qa/game')
    for name in ['qa-orb-bots.mjs', 'qa-orb-layout.mjs', 'qa-orb-reload.mjs']:
        put('workflow/' + name, (ROOT / 'scripts' / name).read_bytes())
    put('qa/game-readme.md', (ROOT / 'docs/orb-bots-2026-10-01.md').read_bytes())
    put('delivery/asset.json', (ROOT / f'public/models/{key}/asset.json').read_bytes())
    for asset in [manifest, *manifest['lods']]:
        data = (ROOT / ('public' + asset['url'])).read_bytes()
        assert sha(data) == asset['sha256']
        put('delivery/' + Path(asset['url']).name, data)
    viewer = json.loads((source / f'qa/final-{revision}/viewer.json').read_text())
    viewer_data = (source / f'qa/final-{revision}/viewer.html').read_bytes()
    assert sha(viewer_data) == viewer['viewerSha256']
    assert viewer['sourceSha256'] == manifest['sha256']
    put('qa/candidate-1/viewer.html', viewer_data)
    viewer.update(source=f'work/rig/revision-{revision}/candidate.glb', viewer='qa/candidate-1/viewer.html')
    record('qa/candidate-1/viewer.json', viewer)
    record('candidate-index.json', dict(nextCandidate=2, completedCandidates=[dict(
        candidate=1, revision=revision, file=viewer['source'], sha256=manifest['sha256'])]))
    record('model.json', dict(modelKey=key, name=manifest['name'], candidate=1,
        provenance=manifest['provenance'], artifacts=dict(
            candidate=dict(path=viewer['source'], sha256=manifest['sha256']),
            viewer=dict(path='qa/candidate-1/viewer.html', sha256=viewer['viewerSha256'])),
        notes=['One independent referenced bot. Candidate 1, retained reconstruction/rig revisions.',
               'The explicit all-five user request authorizes one candidate for each of five distinct subjects.',
               'No Meshmell upload, social post, public deployment or Git remote action.']))
    put('README.md', (f'# {manifest["name"]}\n\nCandidate 1 / rig revision {revision}.\n\n'
                     '[実物のオフラインビューアー](qa/candidate-1/viewer.html) · '
                     '[ゲーム・制作記録](qa/game-readme.md)\n').encode('utf8'))
    records = [dict(path=f.relative_to(target).as_posix(), bytes=f.stat().st_size,
                    sha256=sha(f.read_bytes())) for f in sorted(target.rglob('*')) if f.is_file()]
    item = dict(modelKey=key, destination=str(target), files=len(records),
                bytes=sum(r['bytes'] for r in records), records=records)
    receipt.append(item)
    print(json.dumps({k: item[k] for k in ['modelKey', 'files', 'bytes']}), flush=True)
(ROOT / 'assets/orb-bots/archive.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
