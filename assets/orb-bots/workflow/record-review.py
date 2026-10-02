"""Record a human/model visual assessment, after the exact-file QA exists.

Pass the actual inspection finding explicitly; this script does not infer a
visual pass from the fact that a file rendered.
"""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
p = argparse.ArgumentParser()
p.add_argument('colour', choices=['white', 'blue', 'green', 'purple', 'orange'])
p.add_argument('--revision', default='02')
p.add_argument('--finding', required=True)
a = p.parse_args()
base = ROOT / f'output/model-generation/models/orb-bot-{a.colour}'
rig = base / f'work/rig/revision-{a.revision}'
qa = base / f'qa/final-{a.revision}'
numeric = json.loads((rig / 'qa/numeric.json').read_text())
viewer = json.loads((qa / 'viewer-qa.json').read_text())
sha = lambda f: hashlib.sha256(f.read_bytes()).hexdigest()
assert numeric['numericPass'] and viewer['passed']
assert numeric['sha256'] == sha(rig / 'candidate.glb')
for view in ['front', 'back', 'left', 'right', 'threequarter', 'top', 'bottom']:
    assert (qa / f'browser-{view}.png').is_file()
    for mode in ['neutral', 'clay']:
        assert (qa / mode / f'{view}.png').is_file()
rel = lambda path: path.relative_to(ROOT).as_posix()
record = dict(candidate=1, revision=a.revision, decision='visual-approved-for-game-qa',
              sha256=numeric['sha256'], lodSha256=numeric['lod']['sha256'],
              review=a.finding, numeric=rel(rig / 'qa/numeric.json'),
              viewer=rel(qa / 'viewer.html'), viewerQA=rel(qa / 'viewer-qa.json'),
              visualEvidence=rel(qa), gameIntegrationVerified=False)
target = ROOT / f'assets/orb-bots/reviews/{a.colour}-r{a.revision}.json'
assert not target.exists(), 'Retain the prior assessment'
target.write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf8')
print(json.dumps(record))
