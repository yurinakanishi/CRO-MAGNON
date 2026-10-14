"""Horizontal slices of a standing figure's surface, for rig landmark fractions (legs, hem, fingertips,
armpits, collar, chin): 400k area-weighted surface samples of every primitive, and per 2 % of the height
the separate x-intervals (legs apart, arms apart from the torso) and the depth range.

  python scripts/remake/slice_profile.py MODEL.glb [--step 0.02] [--gap 0.012]

Units are the GLB's (y up); fractions are of the figure's own height.
"""
import argparse
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('--step', type=float, default=0.02)
ap.add_argument('--gap', type=float, default=0.012, help='x gap (GLB units) that separates two parts of a slice')
ap.add_argument('--samples', type=int, default=400000)
args = ap.parse_args()

g = Glb(args.glb)
points, faces, offset = [], [], 0
for mesh in g.doc['meshes']:
    for prim in mesh['primitives']:
        P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
        F = g.accessor(prim['indices']).reshape(-1, 3) + offset
        points.append(P)
        faces.append(F)
        offset += len(P)
P, F = np.concatenate(points), np.concatenate(faces)
lo, hi = P.min(0), P.max(0)
print('bounds', lo.round(4).tolist(), hi.round(4).tolist())
rng = np.random.default_rng(1)
t = P[F]
area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
take = rng.choice(len(F), args.samples, p=area / area.sum())
uv = rng.random((args.samples, 2))
flip = uv.sum(1) > 1
uv[flip] = 1 - uv[flip]
S = t[take, 0] + uv[:, :1] * (t[take, 1] - t[take, 0]) + uv[:, 1:] * (t[take, 2] - t[take, 0])
H = hi[1] - lo[1]


def parts(xs):
    xs = np.sort(xs)
    cuts = np.nonzero(np.diff(xs) > args.gap)[0]
    return [(round(float(a[0]), 3), round(float(a[-1]), 3)) for a in np.split(xs, cuts + 1)]


for z in np.arange(args.step / 2, 1.0, args.step):
    band = S[np.abs(S[:, 1] - (lo[1] + z * H)) < 0.004 * H]
    if len(band) < 10:
        continue
    p = parts(band[:, 0])
    print(f'{z:.2f} n={len(p)} x={p} z={band[:, 2].min():.3f}..{band[:, 2].max():.3f}')
