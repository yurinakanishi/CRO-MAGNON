"""Record completed local game QA; preserve all reconstruction/rig revisions."""
from pathlib import Path
import hashlib
import json

ROOT = Path.cwd()
BASE = ROOT / 'output/model-generation/models/howkey-scientist'
ASSETS = ROOT / 'assets/howkey-scientist'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

asset_path = ROOT / 'public/models/howkey-scientist/asset.json'
asset = read(asset_path)
model = ROOT / ('public' + asset['url'])
assert digest(model) == asset['sha256']
reports = {
    'modelViewer': 'output/playwright/howkey/viewer-r11/result.json',
    'game': 'output/playwright/howkey/game-r03/result.json',
    'detail': 'output/playwright/howkey/detail-r01/result.json',
    'runtimeCrouch': 'output/model-generation/models/howkey-scientist/qa/runtime-crouch.json',
}
for name, path in reports.items():
    value = read(ROOT / path)
    assert value['pass'], (name, value)
    if 'sha256' in value:
        assert value['sha256'] == asset['sha256']

numeric = read(BASE / 'work/final/revision-11/howkey-scientist/qa/numeric.json')
assert numeric['errors'] == [] and numeric['sha256'] == asset['sha256']
tests = (ROOT / 'output/howkey-tests-final.log').read_text(encoding='utf-8')
assert 'pass 615' in tests and 'fail 0' in tests
asset['status'] = 'integrated-reviewed-prototype'
asset['gameQA'] = 'assets/howkey-scientist/README.md'
asset['notes'] = list(dict.fromkeys(
    note for note in asset['notes'] if not note.startswith('Game integration QA follows')
))
asset['notes'].append('Game QA passed in an isolated, unsaved world: two renderers and three additional peers, actions, science hit synchronization, pets, riding, recovery, reload and mobile layouts. Physical controllers and long-duration exhibition use remain untested.')
write(asset_path, asset)
write(BASE / 'qa/delivery-manifest.json', asset)

catalog_path = ROOT / 'assets/world-models.json'
catalog = read(catalog_path)
entry = next(a for a in catalog['assets'] if a['key'] == 'howkey-scientist')
entry.update(status='integrated-and-game-qa-passed', candidate=1, revision='11',
             triangles=asset['triangles'], gameQA=asset['gameQA'])
write(catalog_path, catalog)

reasons = {
    'rig/revision-01': 'Rejected: influence columns did not follow Blender bone hierarchy order.',
    'rig/revision-02': 'Influence ordering repaired; ankle deformation failed subsequent numeric review.',
    'rig/revision-03': 'Leg and armpit ownership repaired; wrist location and cuff weights failed visual review.',
    'rig/revision-04': 'Wrist/cuff repaired; close coat layers required spatially continuous weights.',
    'rig/revision-05': 'Accepted rig: nearest-surface weight continuity joins close coat shells; face remains rigid.',
    'motion/revision-02': 'Rejected inherited rig01 influence error.',
    'motion/revision-04': 'CMU retarget passed; later final05 deformation review failed.',
    'motion/revision-06': 'CMU retarget passed; later final07 wrist/cuff visual review failed.',
    'motion/revision-08': 'CMU retarget passed; later final09 close coat-layer visual review required revision.',
    'motion/revision-10': 'Accepted CMU locomotion from rig05.',
    'final/revision-03': 'Failed script attempt; no completed model. Logs retained.',
    'final/revision-05': 'Rejected ankle stretching. Early stills used incorrect importer FPS and are not acceptance evidence.',
    'final/revision-07': 'Numeric pass; rejected wrist/cuff appearance.',
    'final/revision-09': 'Numeric/browser pass; rejected close coat-layer artifacts.',
    'final/revision-11': 'Adopted. Correct-FPS exact-export stills, numeric, browser and game QA passed.',
}
history = []
for name, reason in reasons.items():
    folder = BASE / 'work' / name
    files = [{'path': p.relative_to(BASE).as_posix(), 'sha256': digest(p), 'bytes': p.stat().st_size}
             for p in sorted(folder.rglob('*.glb'))]
    history.append({'revision': name, 'review': reason, 'files': files})
write(ASSETS / 'revision-history.json', {
    'candidate': 1, 'completedCandidates': 1, 'adoptedRevision': '11',
    'reconstruction': [
        {'attempt': 1, 'decision': 'rejected', 'reason': 'Missing eyes and cloudy glasses; source and outputs retained. Requested unsupported tex-res option did not raise PBR resolution; actual PBR 512, atlas 2048.'},
        {'attempt': 2, 'decision': 'selected', 'reason': 'Frontal upright head, visible eyes, same clothing; shape 1024, PBR 1024, atlas 4096.'},
    ],
    'revisions': history,
})
crouch = read(ROOT / reports['runtimeCrouch'])
summary = {
    'candidate': 1, 'revision': '11', 'sha256': asset['sha256'],
    'triangles': asset['triangles'], 'bytes': asset['bytes'], 'joints': asset['bones'],
    'clips': len(asset['clips']), 'heightMetres': asset['heightMetres'],
    'numeric': {'sampleRate': numeric['sampleRate'], 'poses': sum(c['samples'] for c in numeric['clips']),
                'renderVertices': numeric['renderVertices'],
                'minimumGroundMetres': min(c['minimumGroundMetres'] for c in numeric['clips']),
                'maximumEdgeElongation': max(c['maximumEdgeElongation'] for c in numeric['clips']),
                'errors': numeric['errors']},
    'runtimeCrouch': {'poses': len(crouch['records']), 'minimumGroundMetres': min(r['minY'] for r in crouch['records']),
                      'maximumHandGapMetres': max(r['gap'] for r in crouch['records'])},
    'reports': reports, 'tests': {'passed': 615, 'failed': 0, 'log': 'output/howkey-tests-final.log'},
    'portrait': {'path': 'public/models/howkey-scientist/portrait.png', 'sha256': digest(ROOT / 'public/models/howkey-scientist/portrait.png')},
    'limits': ['Physical controllers, exhibition screens and long-running sessions untested.',
               'Skinned coat and hair; no cloth or hair physics. Reconstructed source has boundary and non-manifold edges.',
               'No public deployment, ordinary-server restart or user-save edits.'],
}
write(ASSETS / 'validation.json', summary)
print(json.dumps(summary, ensure_ascii=False, indent=2))
