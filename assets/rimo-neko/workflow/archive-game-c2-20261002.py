"""Append this game adoption to the model library; never replace prior archives.

Use --plan to validate inputs without writing. The normal server's player saves
are deliberately outside this allowlist. Each archived file is SHA-256 checked.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
LIBRARY = ROOT.parent / 'threed-model-creation/models/rimo-neko'
DEST = LIBRARY / 'candidate-2/game-adoption-20261002'
MODEL = ROOT / 'output/model-generation/models/rimo-neko/candidate-2'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plan', action='store_true')
args = parser.parse_args()
adoption = json.loads((ROOT / 'assets/rimo-neko/adoption.json').read_text(encoding='utf8'))
assert adoption['candidate'] == 2 and adoption['revision'] == '02'
assert adoption['gameValidation'] == 'passed'
assert LIBRARY.is_dir()
assert DEST.resolve().is_relative_to(LIBRARY.resolve())
copies = {}


def sha(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()


def add(source, relative):
    source = source.resolve()
    relative = Path(relative).as_posix()
    assert source.is_file(), str(source)
    assert source.is_relative_to(ROOT.resolve()), str(source)
    assert (DEST / relative).resolve().is_relative_to(DEST.resolve()), relative
    assert relative not in copies, relative
    copies[relative] = source


def tree(source, relative):
    assert source.is_dir(), str(source)
    for path in sorted(source.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            add(path, Path(relative) / path.relative_to(source))


for revision in ['01', '02']:
    tree(MODEL / f'work/rig/revision-{revision}', f'work/rig/revision-{revision}')
    tree(MODEL / f'qa/rig-{revision}', f'qa/rig-{revision}')
tree(MODEL / 'work/low-poly/revision-01', 'work/low-poly/revision-01')
for name in ['face-landmarks.json', 'landmark-pixels.json']:
    add(MODEL / 'qa' / name, 'qa/' + name)
tree(ROOT / 'assets/rimo-neko/source', 'source')
tree(ROOT / 'assets/rimo-neko/workflow', 'workflow')
tree(ROOT / 'output/rimo-neko-c2-game', 'qa/game')
for path in sorted((ROOT / 'assets/rimo-neko/qa').glob('c2-*')):
    if path.is_file():
        add(path, 'qa/summary/' + path.name)
for name in ['adoption-c01-r10.json', 'asset-c01-r10.json', 'rig-c01-r10.json']:
    add(ROOT / 'assets/rimo-neko/history' / name, 'history/' + name)
for name in ['asset.json', 'model-c02-r02.glb', 'lod-c02-r02.glb']:
    add(ROOT / 'public/models/rimo-neko' / name, 'delivery/' + name)
for name in ['rimo-neko-model-c02-r02-tex2048.glb', 'rimo-neko-lod-c02-r02-tex2048.glb']:
    add(ROOT / 'assets/public-performance/models' / name, 'delivery/public-derived/' + name)
for name in ['adoption.json', 'rig.json', 'c2-landmark-pixels.json']:
    add(ROOT / 'assets/rimo-neko' / name, 'documentation/' + name)
for name in ['README.md', 'quality-review-2026-10-02.md']:
    add(ROOT / 'assets/rimo-neko' / name, 'documentation/game-' + name)
for name in ['rimo-neko-c2-adoption-2026-10-02.md', 'astra-creature-3d-quality-2026-10-02.md']:
    add(ROOT / 'docs' / name, 'documentation/' + name)
for path in [
    'scripts/adopt-rimo-candidate-2.mjs',
    'scripts/finish-rimo-c2-adoption.mjs',
    'scripts/qa-rimo-c2-game.mjs',
    'scripts/qa-rimo-c2-preservation.mjs',
    'scripts/qa-rimo-c2-review.mjs',
    'scripts/qa-rimo-motion.mjs',
    'scripts/qa-rimo-happy-contact.mjs',
    'scripts/fast-skin-positions.mjs',
    'assets/maruimo-octopus/workflow/align-lod.mjs',
    'shared/rimo-neko.mts',
    'assets/world-models.json',
    'public/models/world-assets.json',
    'assets/public-performance/manifest.json',
    'assets/public-performance/verification.json',
]:
    add(ROOT / path, 'workspace-snapshot/' + path)
for path in sorted((ROOT / 'output').glob('rimo-neko-c2-*.log')):
    add(path, 'qa/logs/' + path.name)

assert sha(ROOT / 'public/models/rimo-neko/model-c02-r02.glb') == adoption['sha256']
assert sha(MODEL / 'work/rig/revision-02/candidate.glb') == adoption['sha256']
assert sha(MODEL / 'work/low-poly/revision-01/candidate.glb') == '284095b15d1e08fdfa7a7157ba5806c322e52d280d03a0f0436c8f2311761850'
assert sha(MODEL / 'work/rig/revision-02/lod.glb') == sha(ROOT / 'public/models/rimo-neko/lod-c02-r02.glb')
records = []
for relative, source in sorted(copies.items()):
    digest = sha(source)
    target = DEST / relative
    if target.exists():
        assert sha(target) == digest, 'Immutable archive differs: ' + str(target)
    elif not args.plan:
        target.parent.mkdir(parents=True, exist_ok=True)
        with source.open('rb') as src, target.open('xb') as dst:
            shutil.copyfileobj(src, dst, 8 * 1024 * 1024)
    if not args.plan:
        assert sha(target) == digest, 'Copied bytes differ: ' + str(target)
    records.append(dict(path=relative, source=source.relative_to(ROOT).as_posix(),
                        bytes=source.stat().st_size, sha256=digest))

record = dict(date='2026-10-02', candidate=2, surface='01', rigRevision='02',
              decision='adopted in local game at explicit user request',
              modelSha256=adoption['sha256'], files=len(records),
              bytes=sum(item['bytes'] for item in records),
              playerSavesIncluded=False, filesVerifiedBySha256=not args.plan,
              limitations=adoption['knownLimits'], records=records)
if args.plan:
    print(json.dumps(dict(plan=True, archive=str(DEST), files=record['files'], bytes=record['bytes'])))
else:
    manifest = DEST / 'archive.json'
    data = (json.dumps(record, indent=2, ensure_ascii=False) + '\n').encode('utf8')
    if manifest.exists():
        assert manifest.read_bytes() == data, 'Immutable manifest differs'
    else:
        with manifest.open('xb') as stream:
            stream.write(data)
    receipt = {key: value for key, value in record.items() if key != 'records'}
    receipt.update(archive=str(DEST), manifestSha256=sha(manifest))
    (ROOT / 'assets/rimo-neko/archive-game-c2-20261002.json').write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print(json.dumps(receipt))
