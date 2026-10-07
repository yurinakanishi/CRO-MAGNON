"""Measure how far face vertices leave rigid Head-bone motion during every clip of an exported GLB.

python scripts/face-remake/measure-face-rigidity.py <model.glb> --prim 1 --face "z:y,..." [--samples 61] [--report r.json]

Face vertices: head-primitive vertices above the jaw-line curve y_b(z) by at least 3 cm (bind space, glTF axes), the
same curve given to rigid-head-weights.py. For each clip and sample time the skinned position of every face vertex is
compared with the position it would have if it followed only the Head joint. A shearing face (the walk/run bug) gives
centimetres; a rigidly bound face gives float rounding only.
"""
import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'remake' / 'riglib'))
sys.path.insert(0, 'C:/Users/yurin/Desktop/projects/threed-model-creation/trellis.cpp/tools')
import glb_skin  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('--prim', type=int, default=1)
ap.add_argument('--face', required=True)
ap.add_argument('--margin', type=float, default=.03)
ap.add_argument('--samples', type=int, default=61)
ap.add_argument('--report', default='')
args = ap.parse_args()
r = glb_skin.Rigged(args.glb)
names = [r.node_name(j) for j in r.joints]
head = names.index('Head')
offset = sum(len(p['P']) for p in r.prims[:args.prim])
P = r.prims[args.prim]['P']
curve = np.array([[float(x) for x in pair.split(':')] for pair in args.face.split(',')])
curve = curve[np.argsort(curve[:, 0])]
face = P[:, 1] > np.interp(P[:, 2], curve[:, 0], curve[:, 1]) + args.margin
idx = np.nonzero(face)[0] + offset
rows = []
for anim in r.animations():
    tracks = r.tracks(anim)
    t0, t1 = r.clip_bounds(anim)
    worst, worst_t = 0.0, t0
    for t in np.linspace(t0, t1, args.samples):
        g = r.global_transforms(tracks, t)
        posed = r.skinned(tracks, t)
        M = np.linalg.inv(g[r.mesh_node_index]) @ g[r.joints[head]] @ r.ibm[head]
        rigid = (np.c_[P[face], np.ones(face.sum())] @ M.T)[:, :3]
        d = float(np.linalg.norm(posed[idx] - rigid, axis=1).max())
        if d > worst:
            worst, worst_t = d, t
    rows.append(dict(clip=anim['name'], maxFaceDeviationM=round(worst, 6), atSeconds=round(float(worst_t), 4)))
report = dict(file=args.glb, prim=args.prim, faceVertices=int(face.sum()), samplesPerClip=args.samples, clips=rows,
              worstM=max(r_['maxFaceDeviationM'] for r_ in rows))
if args.report:
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
