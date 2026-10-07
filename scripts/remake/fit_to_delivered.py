"""Fit a dense TRELLIS mesh onto the frame of a previously delivered (aligned) mesh made from the same
dense, so an existing body-specific rig script (absolute bone heights, forward -Y, ground z=0) keeps working.

blender -b --python fit_to_delivered.py -- --dense D.glb --target old-low.glb --out matrix.json
    [--yaw-hint DEG] [--scale-hint S]
Similarity ICP (Umeyama, rigid + one uniform scale) from 12 yaw starts (or the hint); writes {'matrix': 16 row-major}
for remake_process.py --matrix. No vertex is moved individually.
"""
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix
from mathutils.kdtree import KDTree

ap = argparse.ArgumentParser()
ap.add_argument('--dense', required=True)
ap.add_argument('--target', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--yaw-hint', type=float, default=None)
ap.add_argument('--scale-hint', type=float, default=None)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    pts = []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            m = o.matrix_world
            p = np.empty((len(o.data.vertices), 3))
            o.data.vertices.foreach_get('co', p.ravel())
            pts.append(p @ np.asarray(m.to_3x3()).T + np.asarray(m.translation))
    return np.vstack(pts)


T = load(args.target)
tree = KDTree(len(T))
for i, v in enumerate(T):
    tree.insert(v, i)
tree.balance()
D = load(args.dense)
rng = np.random.default_rng(7)
Ds = D[rng.choice(len(D), min(12000, len(D)), replace=False)]
span_t = np.linalg.norm(T.max(0) - T.min(0))
starts = [args.yaw_hint] if args.yaw_hint is not None else list(range(0, 360, 30))
best = None
for yaw0 in starts:
    R0 = np.asarray(Matrix.Rotation(math.radians(yaw0), 3, 'Z'))
    q = Ds @ R0.T
    s0 = args.scale_hint or span_t / np.linalg.norm(q.max(0) - q.min(0))
    q = q * s0
    t0 = (T.max(0) + T.min(0)) / 2 - (q.max(0) + q.min(0)) / 2
    Rc, tc = R0 * s0, t0
    for it in range(60):
        cur = Ds @ Rc.T + tc
        sample = cur[rng.choice(len(cur), 5000, replace=False)]
        pairs = np.array([tree.find(v)[0] for v in sample])
        d = np.linalg.norm(sample - pairs, axis=1)
        keep = d < np.percentile(d, 90)
        X, Y = sample[keep], pairs[keep]
        mx, my = X.mean(0), Y.mean(0)
        Xc, Yc = X - mx, Y - my
        U, S, Vt = np.linalg.svd(Yc.T @ Xc)
        Dg = np.eye(3)
        Dg[2, 2] = np.sign(np.linalg.det(U @ Vt))
        R = U @ Dg @ Vt
        k = float(np.clip((S * np.diag(Dg)).sum() / (Xc ** 2).sum(), .9, 1.1))
        t = my - k * R @ mx
        Rc, tc = k * R @ Rc, k * R @ tc + t
    cur = Ds @ Rc.T + tc
    dist = np.array([tree.find(v)[2] for v in cur[::3]])
    rms = float(np.sqrt(np.mean(dist ** 2)))
    if best is None or rms < best[0]:
        best = (rms, yaw0, Rc.copy(), tc.copy(), float(np.percentile(dist, 95)))
rms, yaw0, Rc, tc, p95 = best
M = np.eye(4)
M[:3, :3] = Rc
M[:3, 3] = tc
placed = D @ Rc.T + tc
report = {'matrix': M.ravel().tolist(), 'dense': args.dense, 'target': args.target, 'yaw_start_deg': yaw0,
          'scale': float(np.cbrt(np.linalg.det(Rc))), 'rms_m': rms, 'p95_m': p95,
          'placed_min': placed.min(0).tolist(), 'placed_max': placed.max(0).tolist(),
          'target_min': T.min(0).tolist(), 'target_max': T.max(0).tolist(),
          'method': 'similarity ICP (Umeyama, 90th-percentile trim, per-step scale clamp 0.9-1.1) of dense vertices onto '
                    'the delivered mesh vertices'}
Path(args.out).write_text(json.dumps(report, indent=2), newline='\n')
print('FIT_DONE', json.dumps({k: v for k, v in report.items() if k != 'matrix'}))
