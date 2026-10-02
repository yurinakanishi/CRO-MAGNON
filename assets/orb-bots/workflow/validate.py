"""Evaluate every delivered vertex, including the shared-rig LOD, at 120 Hz."""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
sys.path.insert(0, str(ROOT.parent / 'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0, str(ROOT / 'assets/rimo-neko/workflow/lib'))
from glb_skin import Rigged

parser = argparse.ArgumentParser()
parser.add_argument('colour')
parser.add_argument('--revision', default='02')
args = parser.parse_args()
path = ROOT / f'output/model-generation/models/orb-bot-{args.colour}/work/rig/revision-{args.revision}/candidate.glb'
high, low = Rigged(path), Rigged(path.with_name('lod.glb'))
required = {'Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Held_Loop', 'Thrown_Loop', 'Land', 'Catch'}
assert {c['name'] for c in high.animations()} == required
assert not low.animations(), 'LOD borrows the adopted clips, rather than making an independent rig'
names = lambda model: {node.get('name'): i for i, node in enumerate(model.gltf['nodes'])}
high_names, low_names = names(high), names(low)
assert [high.node_name(j) for j in high.joints] == [low.node_name(j) for j in low.joints]
assert len(high.joints) == len(low.joints) == 2
assert np.array_equal(high.ibm, low.ibm), 'The game binds reduced vertices to the original skeleton'
for name in ['Root', 'Body']:
    assert np.array_equal(high.global_transforms({}, 0)[high_names[name]],
                          low.global_transforms({}, 0)[low_names[name]])

errors = []
def inspect(model, level):
    positions = model.skinned({}, 0)
    node_names = names(model)
    root = model.global_transforms({}, 0)[node_names['Root']]
    weights = np.concatenate([p['W'] for p in model.prims])
    assert np.abs(weights.sum(1) - 1).max() < 1e-6
    assert np.isfinite(positions).all()
    for primitive in model.prims:
        assert primitive['UV'] is not None and np.isfinite(primitive['UV']).all()
    records = []
    for clip in high.animations():
        name = clip['name']
        tracks = {node_names[high.node_name(index)]: channels
                  for index, channels in high.tracks(clip).items()}
        duration = high.clip_bounds(clip)[1]
        steps = round(duration * 120)
        first = model.skinned(tracks, 0)
        lo, hi = np.full(3, np.inf), np.full(3, -np.inf)
        drift, max_lowest = 0, -np.inf
        for i in range(steps + 1):
            time = duration * i / steps
            points = model.skinned(tracks, time)
            assert np.isfinite(points).all()
            lo, hi = np.minimum(lo, points.min(0)), np.maximum(hi, points.max(0))
            max_lowest = max(max_lowest, float(points[:, 1].min()))
            drift = max(drift, float(np.abs(model.global_transforms(tracks, time)[node_names['Root']] - root).max()))
        closure = float(np.linalg.norm(first - points, axis=1).max())
        if name not in ['Held_Loop', 'Thrown_Loop'] and lo[1] < -.001:
            errors.append(f'{level}/{name}: ground penetration')
        if drift > 1e-6:
            errors.append(f'{level}/{name}: root drift')
        if name.endswith('_Loop') and closure > 1e-5:
            errors.append(f'{level}/{name}: loop seam')
        records.append(dict(clip=name, seconds=duration, samples=steps + 1,
                            minimumY=float(lo[1]), maximumLowestY=float(max_lowest),
                            bounds=dict(min=lo.tolist(), max=hi.tolist()),
                            rootDrift=drift, loopClosure=closure))
    return dict(sha256=hashlib.sha256(model.raw).hexdigest(), vertices=len(positions),
                triangles=len(model.merged_faces()), bones=len(model.joints), clips=records)

report = inspect(high, 'main')
report['lod'] = inspect(low, 'LOD')
report.update(sampleHz=120, sharedInverseBindMatricesExact=True, sharedRestTransformsExact=True,
              errors=errors, numericPass=not errors)
out = path.parent / 'qa/numeric.json'
out.parent.mkdir(parents=True, exist_ok=True)
out.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
sys.exit(bool(errors))
