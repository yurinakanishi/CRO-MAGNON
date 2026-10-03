"""Append the head/tail correction to the model library, with immutable SHA checks.

--plan reads inputs without writing. No player save files are included.
"""
import argparse
import hashlib
import json
import shutil
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
LIBRARY = ROOT.parent / 'threed-model-creation/models/rimo-neko'
DEST = LIBRARY / 'candidate-2/game-straightening-20261003'
MODEL = ROOT / 'output/model-generation/models/rimo-neko/candidate-2'
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--plan', action='store_true')
args = parser.parse_args()
adoption = json.loads((ROOT / 'assets/rimo-neko/adoption.json').read_text(encoding='utf8'))
assert adoption['candidate'] == 2 and adoption['revision'] == '03'
assert adoption['gameValidation'] == 'passed'
assert LIBRARY.is_dir() and DEST.resolve().is_relative_to(LIBRARY.resolve())
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
    assert source.is_file() and source.is_relative_to(ROOT.resolve()), str(source)
    assert (DEST / relative).resolve().is_relative_to(DEST.resolve()), relative
    assert relative not in copies, relative
    copies[relative] = source


def tree(source, relative):
    assert source.is_dir(), str(source)
    for path in sorted(source.rglob('*')):
        if path.is_file() and '__pycache__' not in path.parts:
            add(path, Path(relative) / path.relative_to(source))


tree(MODEL / 'work/straightening', 'work/straightening')
tree(MODEL / 'work/rig/revision-03', 'work/rig/revision-03')
tree(MODEL / 'qa/straightening-20261003', 'qa/straightening-20261003')
tree(MODEL / 'qa/rig-03', 'qa/rig-03')
tree(ROOT / 'assets/rimo-neko/source', 'source')
tree(ROOT / 'assets/rimo-neko/workflow', 'workflow')
tree(ROOT / 'output/rimo-neko-c2-r03-game', 'qa/game')
for path in sorted((ROOT / 'assets/rimo-neko/qa').glob('c2-r03-*')):
    add(path, 'qa/summary/' + path.name)
for name in ['adoption-c02-r02.json', 'asset-c02-r02.json', 'rig-c02-r02.json']:
    add(ROOT / 'assets/rimo-neko/history' / name, 'history/' + name)
for name in ['asset.json', 'model-c02-r03.glb', 'lod-c02-r03.glb']:
    add(ROOT / 'public/models/rimo-neko' / name, 'delivery/' + name)
for name in ['rimo-neko-model-c02-r03-tex2048.glb', 'rimo-neko-lod-c02-r03-tex2048.glb']:
    add(ROOT / 'assets/public-performance/models' / name, 'delivery/public-derived/' + name)
for name in ['adoption.json', 'rig.json', 'README.md', 'archive-game-c2-20261002.json']:
    add(ROOT / 'assets/rimo-neko' / name, 'documentation/' + name)
add(ROOT / 'docs/rimo-neko-straightening-2026-10-03.md', 'documentation/rimo-neko-straightening-2026-10-03.md')
for path in [
    'scripts/adopt-rimo-candidate-2.mjs', 'scripts/finish-rimo-c2-straightening.mjs',
    'scripts/qa-rimo-c2-straightening.mjs', 'scripts/qa-rimo-c2-preservation.mjs',
    'scripts/qa-rimo-c2-game.mjs', 'scripts/qa-rimo-c2-review.mjs',
    'scripts/qa-rimo-motion.mjs', 'scripts/qa-rimo-happy-contact.mjs',
    'scripts/fast-skin-positions.mjs', 'assets/maruimo-octopus/workflow/align-lod.mjs',
    'assets/world-models.json', 'public/models/world-assets.json',
    'assets/public-performance/manifest.json', 'assets/public-performance/verification.json',
]:
    add(ROOT / path, 'workspace-snapshot/' + path)
for path in sorted((ROOT / 'output').glob('rimo-straight-*.log')):
    add(path, 'qa/logs/' + path.name)
assert sha(ROOT / 'public/models/rimo-neko/model-c02-r03.glb') == adoption['sha256']
assert sha(MODEL / 'work/rig/revision-03/candidate.glb') == adoption['sha256']
assert sha(MODEL / 'work/rig/revision-03/lod.glb') == sha(ROOT / 'public/models/rimo-neko/lod-c02-r03.glb')
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
record = dict(date='2026-10-03', candidate=2, surface='01', rigRevision='03',
              decision='head and tail straightened at explicit user request',
              previousArchive='candidate-2/game-adoption-20261002',
              modelSha256=adoption['sha256'], files=len(records),
              bytes=sum(item['bytes'] for item in records), playerSavesIncluded=False,
              filesVerifiedBySha256=not args.plan, limitations=adoption['knownLimits'], records=records)
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
    (ROOT / 'assets/rimo-neko/archive-straightening-20261003.json').write_text(
        json.dumps(receipt, indent=2, ensure_ascii=False) + '\n', encoding='utf8')
    print(json.dumps(receipt))
