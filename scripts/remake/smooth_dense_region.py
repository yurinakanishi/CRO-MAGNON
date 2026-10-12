"""Smooth small regions of a dense TRELLIS surface that the painted reference replaces (eye sockets).

python scripts/remake/smooth_dense_region.py <dense.glb> <out.glb> --height 1.67 --registration SCALE,CX,CY
    --regions "U,V,RX,RY;U,V,RX,RY" [--iterations 40] [--lam 0.5] [--feather 0.4] [--facing 0.2,0.45]

For a character whose face is painted from its front reference (scripts/remake/project_face.py), the
reconstructed eye sockets shade the painted eyes from the side and dull them. The low-poly mesh gets its
look from normals baked off this dense surface, so the sockets are filled here, before reduction and
baking, instead of by flattening the baked normals (which exposes the low-poly facets).
Regions are ellipses in reference pixels (centre U,V and radii RX,RY), mapped onto the surface with the
same ground-centred placement as remake_process.py (--height, measured along glTF +Y) and the reference
registration of project_face.py (u = CX + SCALE * x, v = CY - SCALE * y). Only front-facing vertices
inside an ellipse move, by Laplacian smoothing over the position-welded surface weighted by a feathered
ellipse and the facing ramp. UVs, texture, indices and material are unchanged; normals are recomputed.
Writes <out.glb> and <out>.json (moved vertices, largest and mean displacement).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import scipy.sparse as sp

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Builder, Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('dense')
ap.add_argument('out')
ap.add_argument('--height', type=float, required=True)
ap.add_argument('--registration', required=True)
ap.add_argument('--regions', required=True)
ap.add_argument('--mode', default='smooth', choices=['smooth', 'fill', 'flatten'], help='smooth: Laplacian smoothing; fill: raise vertices '
                'that lie behind a quadratic fitted to the surrounding front surface (deep eye sockets) onto that surface; '
                'flatten: move the region (in front of or behind it, within --pit-depth) onto a quadratic fitted to the ring '
                'below and beside it (protruding lips under a painted mouth; the nose above is left out of the fit and the move)')
ap.add_argument('--pit-depth', type=float, default=0.04, help='fill: largest depth (metres) behind the fitted surface that is '
                'treated as the socket; anything deeper (the back of the head) never moves')
ap.add_argument('--iterations', type=int, default=40)
ap.add_argument('--lam', type=float, default=0.5)
ap.add_argument('--feather', type=float, default=0.4)
ap.add_argument('--facing', default='0.2,0.45')
ap.add_argument('--depth', type=float, default=0.01, help='metres behind the front-most surface at a pixel that still count as the face (deep eye sockets need more)')
args = ap.parse_args()

g = Glb(args.dense)
assert len(g.doc['meshes']) == 1 and len(g.doc['meshes'][0]['primitives']) == 1
prim = g.doc['meshes'][0]['primitives'][0]
P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)

# weld by exact position (UV seams split vertices)
_, weld, inverse = np.unique(P.round(7), axis=0, return_index=True, return_inverse=True)
inverse = inverse.ravel()
Q = P[weld].copy()
Fw = inverse[F]
n = len(Q)


def normals(points):
    fn = np.cross(points[Fw[:, 1]] - points[Fw[:, 0]], points[Fw[:, 2]] - points[Fw[:, 0]])
    acc = np.zeros((n, 3))
    for c in range(3):
        np.add.at(acc, Fw[:, c], fn)
    return acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12)


# placement as remake_process.py: ground-centred, uniform scale to --height along +Y (glTF)
lo, hi = Q.min(0), Q.max(0)
scale = args.height / (hi[1] - lo[1])
origin = np.array([(hi[0] + lo[0]) / 2, lo[1], (hi[2] + lo[2]) / 2])
placed = (Q - origin) * scale
a, cx, cy = map(float, args.registration.split(','))
u = cx + a * placed[:, 0]
v = cy - a * placed[:, 1]
N0 = normals(Q)
f0, f1 = map(float, args.facing.split(','))
t = np.clip((N0[:, 2] - f0) / (f1 - f0), 0, 1)
facing = t * t * (3 - 2 * t)
weight = np.zeros(n)
regions = []
for spec in args.regions.split(';'):
    ru, rv, rx, ry = map(float, spec.split(','))
    rr = np.sqrt(((u - ru) / rx) ** 2 + ((v - rv) / ry) ** 2)
    w = np.clip((1 - rr) / args.feather, 0, 1)
    weight = np.maximum(weight, w * w * (3 - 2 * w))
    regions.append(dict(u=ru, v=rv, rx=rx, ry=ry))
# keep only the front-most layer: a vertex far behind the front surface at its pixel is not the face
weight *= facing
front = np.full((int(v.max()) + 2, int(u.max()) + 2), -1e9)
ui, vi = np.clip(u.astype(int), 0, front.shape[1] - 1), np.clip(v.astype(int), 0, front.shape[0] - 1)
np.maximum.at(front, (vi, ui), placed[:, 2])
# vertices are sparser than pixels: a pixel without a front vertex must not take a vertex of the back of the
# head as its front, so the per-pixel maximum is spread over a 7 x 7 neighbourhood
front = cv2.dilate(front.astype(np.float32), np.ones((7, 7), np.uint8)).astype(np.float64)
weight *= np.clip(1 - (front[vi, ui] - placed[:, 2]) / args.depth, 0, 1)

X = Q.copy()
fits = []
if args.mode == 'smooth':
    edges = np.concatenate([Fw[:, [0, 1]], Fw[:, [1, 2]], Fw[:, [2, 0]]])
    edges = np.unique(np.sort(edges, axis=1), axis=0)
    A = sp.coo_matrix((np.ones(len(edges) * 2), (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])), shape=(n, n)).tocsr()
    degree = np.asarray(A.sum(1)).ravel()
    step = (args.lam * weight)[:, None]
    for _ in range(args.iterations):
        X = X + step * (A @ X / np.maximum(degree, 1)[:, None] - X)
elif args.mode == 'flatten':
    on_front = (front[vi, ui] - placed[:, 2]) < 0.002
    for spec in args.regions.split(';'):
        ru, rv, rx, ry = map(float, spec.split(','))
        rr = np.sqrt(((u - ru) / rx) ** 2 + ((v - rv) / ry) ** 2)
        ring = on_front & (rr > 1.05) & (rr < 1.7) & (v > rv - 0.2 * ry)  # below and beside: never the nose above
        x, y, z = placed[ring, 0], placed[ring, 1], placed[ring, 2]
        M = np.c_[np.ones_like(x), x, y, x * x, x * y, y * y]
        coef, *_ = np.linalg.lstsq(M, z, rcond=None)
        xa, ya = placed[:, 0], placed[:, 1]
        target = np.c_[np.ones(n), xa, ya, xa * xa, xa * ya, ya * ya] @ coef
        gap = target - placed[:, 2]
        t = np.clip((1 - rr) / args.feather, 0, 1)
        near_front = (front[vi, ui] - placed[:, 2]) < args.depth
        w = t * t * (3 - 2 * t) * near_front * (np.abs(gap) < args.pit_depth)
        X[:, 2] += w * gap / scale
        fits.append(dict(ringVertices=int(ring.sum()), residualMetres=float(np.sqrt(np.mean((M @ coef - z) ** 2))),
                         moved=int((w > 0.01).sum()), largestMoveMetres=float(np.abs(w * gap).max())))
else:
    # a quadratic z(x, y) through the visible surface in a ring around each region; vertices of the region lying
    # behind it (at most --pit-depth) are raised onto it, scaled by the feathered weight. Placed metres, +Z front.
    on_front = (front[vi, ui] - placed[:, 2]) < 0.002
    for spec in args.regions.split(';'):
        ru, rv, rx, ry = map(float, spec.split(','))
        rr = np.sqrt(((u - ru) / rx) ** 2 + ((v - rv) / ry) ** 2)
        ring = on_front & (rr > 1.05) & (rr < 1.6)
        x, y, z = placed[ring, 0], placed[ring, 1], placed[ring, 2]
        M = np.c_[np.ones_like(x), x, y, x * x, x * y, y * y]
        coef, *_ = np.linalg.lstsq(M, z, rcond=None)
        xa, ya = placed[:, 0], placed[:, 1]
        target = np.c_[np.ones(n), xa, ya, xa * xa, xa * ya, ya * ya] @ coef
        gap = target - placed[:, 2]
        t = np.clip((1 - rr) / args.feather, 0, 1)
        w = t * t * (3 - 2 * t) * (gap > 0) * (gap < args.pit_depth)
        X[:, 2] += w * gap / scale  # back to source units (uniform scale; +Z is the same axis)
        fits.append(dict(ringVertices=int(ring.sum()), residualMetres=float(np.sqrt(np.mean((M @ coef - z) ** 2))),
                         raised=int((w > 0.01).sum()), largestRaiseMetres=float((w * gap).max())))
moved = np.linalg.norm(X - Q, axis=1) * scale
N1 = normals(X)

b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    b.add_view(g.view_bytes(i), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
attributes = b.doc['meshes'][0]['primitives'][0]['attributes']
attributes['POSITION'] = b.add_accessor(X[inverse].astype(np.float32), 5126, 'VEC3', 34962, minmax=True)
if 'NORMAL' in attributes:
    attributes['NORMAL'] = b.add_accessor(N1[inverse].astype(np.float32), 5126, 'VEC3', 34962)
b.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(author='Claude Code (Opus 5.5)', script='scripts/remake/smooth_dense_region.py', source=args.dense, sourceSha256=sha(args.dense),
              output=args.out, outputSha256=sha(args.out), height=args.height, scale=float(scale), registration=[a, cx, cy],
              mode=args.mode, fits=fits, pitDepth=args.pit_depth, regions=regions, iterations=args.iterations, lam=args.lam, feather=args.feather, facing=[f0, f1], depth=args.depth,
              weldedVertices=int(n), weightedVertices=int((weight > 0.01).sum()),
              movedOverHalfMillimetre=int((moved > 0.0005).sum()), maxDisplacementMetres=float(moved.max()),
              meanDisplacementMetres=float(moved[weight > 0.01].mean()) if (weight > 0.01).any() else 0.0)
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('SMOOTH_DONE', json.dumps({k: report[k] for k in ('weightedVertices', 'movedOverHalfMillimetre', 'maxDisplacementMetres', 'meanDisplacementMetres')}))
