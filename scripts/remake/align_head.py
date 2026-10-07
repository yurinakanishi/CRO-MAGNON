"""Place a human body dense mesh (height, grounded, feet-centred, front -Y) and fit a separately
reconstructed head dense mesh onto the body's head with similarity ICP (rigid + uniform scale).

blender -b --python align_head.py -- --body B.glb --head Hd.glb --height 1.8 --out DIR
    [--body-yaw 0] [--head-top-band .30] [--neck-keep .16]
Writes DIR/body-matrix.json, DIR/head-matrix.json, DIR/align-report.json.
Only rigid motion and one uniform scale per mesh; no vertex is moved individually.
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
ap.add_argument('--body', required=True)
ap.add_argument('--head', required=True)
ap.add_argument('--height', type=float, default=1.8)
ap.add_argument('--out', required=True)
ap.add_argument('--body-yaw', type=float, default=0.0)
ap.add_argument('--head-top-band', type=float, default=.30, help='metres below the crown used from the body')
ap.add_argument('--upright', action='store_true', help='rotation about the vertical axis only (keep the head reconstruction upright, no pitch/roll)')
ap.add_argument('--skin-only', action='store_true', help='fit on skin-coloured points only (face, ears, neck), so hair volume cannot drive the scale')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)


SKIN = {}


def load(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=path)
    pts, skin = [], []
    for o in bpy.context.scene.objects:
        if o.type == 'MESH':
            m = o.matrix_world
            p = np.empty((len(o.data.vertices), 3))
            o.data.vertices.foreach_get('co', p.ravel())
            pts.append(p @ np.asarray(m.to_3x3()).T + np.asarray(m.translation))
            skin.append(skin_mask(o))
    SKIN[path] = np.concatenate(skin)
    return np.vstack(pts)


def skin_mask(o):
    """Per-vertex skin test on the base-colour texture (warm, moderately saturated, mid luminance)."""
    me = o.data
    img = next((n.image for m in me.materials if m and m.use_nodes for n in m.node_tree.nodes
                if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB'), None)
    if img is None or not me.uv_layers:
        return np.zeros(len(me.vertices), bool)
    w, h = img.size
    px = np.empty(w * h * 4, np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    uv = np.empty(len(me.loops) * 2, np.float32)
    me.uv_layers.active.data.foreach_get('uv', uv)
    uv = uv.reshape(-1, 2)
    vidx = np.empty(len(me.loops), np.int64)
    me.loops.foreach_get('vertex_index', vidx)
    vuv = np.zeros((len(me.vertices), 2), np.float32)
    vuv[vidx] = uv
    c = px[np.clip((vuv[:, 1] * (h - 1)).astype(int), 0, h - 1), np.clip((vuv[:, 0] * (w - 1)).astype(int), 0, w - 1)]
    r, g, b = c[:, 0], c[:, 1], c[:, 2]
    lum = c.mean(1)
    return (r > g) & (g > b) & (r - b > .12) & (r - g < .3) & (lum > .3) & (lum < .85)


B = load(args.body)
# body placement: yaw, uniform scale to height, ground, feet-centred (same rule as remake_process --pivot feet)
Ryaw = np.asarray(Matrix.Rotation(math.radians(args.body_yaw), 3, 'Z'))
p = B @ Ryaw.T
lo, hi = p.min(0), p.max(0)
s = args.height / (hi[2] - lo[2])
origin = np.array([(hi[0] + lo[0]) / 2, (hi[1] + lo[1]) / 2, lo[2]])
p = (p - origin) * s
sole = p[p[:, 2] < .045 * args.height]
lft, rgt = sole[sole[:, 0] > 0], sole[sole[:, 0] < 0]
mid = ((lft[:, :2].min(0) + lft[:, :2].max(0)) / 2 + (rgt[:, :2].min(0) + rgt[:, :2].max(0)) / 2) / 2
shift = np.r_[mid, 0]
p -= shift
body_M = np.eye(4)
body_M[:3, :3] = Ryaw * s
body_M[:3, 3] = -origin @ (np.eye(3) * s).T - shift
assert np.allclose(B @ body_M[:3, :3].T + body_M[:3, 3], p, atol=1e-6)
(out / 'body-matrix.json').write_text(json.dumps({'matrix': body_M.ravel().tolist(), 'height': args.height}))
Bp = p
crown = Bp[:, 2].max()
band = (Bp[:, 2] > crown - args.head_top_band) & (np.abs(Bp[:, 0]) < .2)  # exclude shoulder fur reaching into the band
if args.skin_only:
    band &= SKIN[args.body]
target = Bp[band]
tree = KDTree(len(target))
for i, v in enumerate(target):
    tree.insert(v, i)
tree.balance()

Hd = load(args.head)
if args.skin_only:
    Hd = Hd[SKIN[args.head]]
hlo, hhi = Hd.min(0), Hd.max(0)
best = None
for yaw0 in range(-60, 61, 10):
    R0 = np.asarray(Matrix.Rotation(math.radians(yaw0), 3, 'Z'))
    q = Hd @ R0.T
    span = q[:, 2].max() - q[:, 2].min()
    s0 = (args.head_top_band + .12) / span  # head + neck column
    if args.skin_only:
        # Skin of face, ears and neck: match widths (the head reconstruction's neck runs longer than the body band).
        s0 = np.ptp(target[:, 0]) / np.ptp(q[:, 0])
    q = q * s0
    top_z = target[:, 2].max() if args.skin_only else crown
    t0 = np.array([target[:, 0].mean() - q[:, 0].mean(), target[:, 1].mean() - q[:, 1].mean(), top_z - q[:, 2].max()])
    Rc, sc, tc = R0 * s0, s0, t0  # accumulated similarity: x -> Rc @ x + tc
    for it in range(40):
        cur = Hd @ Rc.T + tc
        top = cur[cur[:, 2] > crown - args.head_top_band]
        if len(top) < 200:
            break
        sample = top[np.random.default_rng(it).choice(len(top), min(4000, len(top)), replace=False)]
        pairs = np.array([tree.find(v)[0] for v in sample])
        d = np.linalg.norm(sample - pairs, axis=1)
        keep = d < np.percentile(d, 85)
        X, Y = sample[keep], pairs[keep]
        mx, my = X.mean(0), Y.mean(0)
        Xc, Yc = X - mx, Y - my
        if args.upright:
            U2, S2, Vt2 = np.linalg.svd(Yc[:, :2].T @ Xc[:, :2])
            D2 = np.diag([1.0, np.sign(np.linalg.det(U2 @ Vt2))])
            R = np.eye(3)
            R[:2, :2] = U2 @ D2 @ Vt2
            k = ((Yc * (Xc @ R.T)).sum()) / (Xc ** 2).sum()
        else:
            U, S, Vt = np.linalg.svd(Yc.T @ Xc)
            D = np.eye(3)
            D[2, 2] = np.sign(np.linalg.det(U @ Vt))
            R = U @ D @ Vt
            k = (S * np.diag(D)).sum() / (Xc ** 2).sum()
        k = float(np.clip(k, .95, 1.05))
        t = my - k * R @ mx
        Rc, tc = k * R @ Rc, k * R @ tc + t
    cur = Hd @ Rc.T + tc
    top = cur[cur[:, 2] > crown - args.head_top_band]
    rms = float(np.sqrt(np.mean([tree.find(v)[2] ** 2 for v in top[::max(1, len(top) // 3000)]])))
    if best is None or rms < best[0]:
        best = (rms, yaw0, Rc.copy(), tc.copy())
rms, yaw0, Rc, tc = best
head_M = np.eye(4)
head_M[:3, :3] = Rc
head_M[:3, 3] = tc
scale = float(np.cbrt(np.linalg.det(Rc)))
placed = Hd @ Rc.T + tc
(out / 'head-matrix.json').write_text(json.dumps({'matrix': head_M.ravel().tolist()}))
report = {'body_scale': float(s), 'body_crown_m': float(crown), 'skin_only': bool(args.skin_only), 'upright': bool(args.upright), 'skin_points': [int(len(target)), int(len(Hd))], 'head_initial_yaw_deg': yaw0, 'head_scale': scale,
          'head_rms_m': rms, 'head_placed_min': placed.min(0).tolist(), 'head_placed_max': placed.max(0).tolist(),
          'method': 'similarity ICP (Umeyama, 85th-percentile inlier trim, scale clamp 0.95-1.05 per step) of the head '
                    'reconstruction onto the placed body crown band; best of 13 yaw starts'}
(out / 'align-report.json').write_text(json.dumps(report, indent=2))
print('ALIGN_DONE', json.dumps(report))
