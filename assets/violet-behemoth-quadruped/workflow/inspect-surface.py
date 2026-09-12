"""Extract measured paw, torso and tail sections from the accepted surface."""
import json, sys
from pathlib import Path
import bpy, numpy as np
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M = ROOT/'output/model-generation/models/violet-behemoth-quadruped'
sys.path.insert(0, str(M/'workflow/candidate-01'))
import blender_rig as base
obj = base.import_mesh(M/'work/low-poly/revision-01/candidate.glb')
P = base.positions(obj.data); np.save(M/'work/low-poly/revision-01/positions.npy', P)
lo, hi = P.min(0), P.max(0)
report = {'bounds': [lo.tolist(), hi.tolist()], 'paws': {}, 'body': [], 'tail': []}
for side, s in [('L', 1), ('R', -1)]:
    q = P[(P[:, 2] < .19) & (P[:, 0]*s > .4)]
    ys = np.sort(q[:, 1]); cut = ys[np.argmax(np.diff(ys))]
    for end, gate in [('F', q[:, 1] <= cut), ('B', q[:, 1] > cut)]:
        paw = q[gate]
        report['paws'][end+side] = {'min': paw.min(0).tolist(), 'max': paw.max(0).tolist(), 'mean': paw.mean(0).tolist()}
for y in np.arange(lo[1], hi[1], .2):
    q = P[np.abs(P[:, 1]-y) < .045]
    if len(q): report['body'].append({'y': float(y), 'count': len(q), 'min': q.min(0).tolist(), 'max': q.max(0).tolist(), 'mean': q.mean(0).tolist()})
for z in np.arange(.25, 2.1, .2):
    row = {'z': float(z)}
    for side, s in [('L', 1), ('R', -1)]:
        for end, sign in [('F', -1), ('B', 1)]:
            q = P[(np.abs(P[:, 2]-z)<.04) & (P[:, 0]*s>.6) & (P[:, 1]*sign>.3)]
            if len(q): row[end+side] = {'mean': q.mean(0).tolist(), 'min': q.min(0).tolist(), 'max': q.max(0).tolist()}
    report['tail'].append(row)
(M/'work/low-poly/revision-01/sections.json').write_text(json.dumps(report, indent=2)+'\n')
print(json.dumps(report['paws']))
