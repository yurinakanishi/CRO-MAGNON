"""Give the dense TRELLIS face of a chibi character one clean smooth surface before reduction and baking.

python scripts/remake/face_plate.py <dense.glb> <out.glb> --height 1.45 --registration SCALE,CX,CY
    --face U,V,RX,RY --fill "U,V,RX,RY[;...]" [--fill-front 0.012] [--fill-back 0.045] [--rings 12]
    [--smoothing 1e-5] [--front-move 0.006] [--back-move 0.015] [--feather 0.25] [--facing 0.25,0.5]
    [--hair-guard] [--skin-uv U,V]

An anime face is a smooth round surface whose eyes, brows, mouth and cheek paint are only painted. TRELLIS-2
carves the painted features of the reference into the surface: eye recesses 2-3 cm deep with raised lash
rims, ridges along painted cheek stripes, a nose bump. Reduction keeps vertices on those features and the
normal bake shades them, so the painted face (scripts/remake/project_face.py) would sit on wrong relief.
Pressing a recess onto a smooth surface along z folds its undercut walls into inverted triangles, whose
backward normals survive reduction (2026-10-13 candidate 5: a mosaic of unprojected triangles), so the
carved features are cut out and refilled instead:
  1. placement as remake_process.py (ground-centred, uniform scale to --height along +Y) and the reference
     registration of project_face.py (u = CX + SCALE * x, v = CY - SCALE * y): ellipses are given in
     reference pixels; the front layer comes from a z-buffer of the triangles;
  2. a thin-plate spline z(x, y) is fitted to the front-layer skin inside the --face ellipse and outside the
     --fill ellipses, robustly (samples off the fit by more than --clip are dropped and the spline refitted);
  3. in each --fill ellipse, the front-layer vertices and everything connected to them that lies at most
     --fill-front in front of or --fill-back behind the fit (recess walls and floor, lash ridges) are deleted
     with their triangles, and so are small pieces left disconnected there. Every hole is closed by a cap of
     concentric rings (its boundary scaled toward its centre), spread by uniform Laplacian steps in x and y
     with the boundary fixed and lifted onto the fit. Cap triangles take the orientation of the surrounding
     surface and the UV of one skin texel (--skin-uv, else the median UV of the fitted skin near the hole):
     the painted face replaces their colour;
  4. the rest of the face ellipse moves onto the fit along z, within --front-move in front of and
     --back-move behind it, where the fitted surface faces the front. --hair-guard keeps vertices whose
     albedo is dark reddish-brown (hair) and their fringe in place.
Writes OUT.glb (positions, normals, UVs and indices rebuilt; material and texture unchanged) and OUT.json.
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

import cv2
import numpy as np
import scipy.sparse as sp
from PIL import Image
from scipy.interpolate import RBFInterpolator

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Builder, Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('dense')
ap.add_argument('out')
ap.add_argument('--height', type=float, required=True)
ap.add_argument('--registration', required=True)
ap.add_argument('--face', required=True, help='U,V,RX,RY: the face ellipse in reference pixels')
ap.add_argument('--fill', default='', help='U,V,RX,RY[;...]: ellipses in reference pixels whose carved feature is cut out and refilled')
ap.add_argument('--fill-front', type=float, default=0.012, help='metres in front of the fit that belong to a feature (lash ridges)')
ap.add_argument('--fill-back', type=float, default=0.045, help='metres behind the fit that belong to a feature (eye recesses)')
ap.add_argument('--rings', type=int, default=12, help='concentric rings of a cap')
ap.add_argument('--feather', type=float, default=0.25)
ap.add_argument('--front-move', type=float, default=0.006, help='metres in front of the fit that still move (rims, ridges)')
ap.add_argument('--back-move', type=float, default=0.015, help='metres behind the fit that still move (shallow dents)')
ap.add_argument('--clip', type=float, default=0.0025, help='robust fit: drop samples farther than this from the fit')
ap.add_argument('--facing', default='0.25,0.5', help='normal.z ramp (start,full) of the fitted surface where vertices move')
ap.add_argument('--smoothing', type=float, default=1e-5, help='RBFInterpolator smoothing of the thin-plate spline')
ap.add_argument('--hair-guard', action='store_true')
ap.add_argument('--skin-uv', default='', help='U,V: the texel the caps take (default: median UV of fitted skin near each hole)')
args = ap.parse_args()

g = Glb(args.dense)
assert len(g.doc['meshes']) == 1 and len(g.doc['meshes'][0]['primitives']) == 1
prim = g.doc['meshes'][0]['primitives'][0]
P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)
UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)

# welded topology (UV seams split vertices)
_, weld, inverse = np.unique(P.round(7), axis=0, return_index=True, return_inverse=True)
inverse = inverse.ravel()
Q = P[weld].copy()
Fw = inverse[F]
n = len(Q)


def vertex_normals(points, faces, count):
    fn = np.cross(points[faces[:, 1]] - points[faces[:, 0]], points[faces[:, 2]] - points[faces[:, 0]])
    acc = np.zeros((count, 3))
    for c in range(3):
        np.add.at(acc, faces[:, c], fn)
    return acc / (np.linalg.norm(acc, axis=1, keepdims=True) + 1e-12)


def adjacency(faces, count):
    edges = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    A = sp.coo_matrix((np.ones(len(edges) * 2), (np.r_[edges[:, 0], edges[:, 1]], np.r_[edges[:, 1], edges[:, 0]])),
                      shape=(count, count)).tocsr()
    return A


def ellipses(spec):
    return [tuple(map(float, s.split(','))) for s in filter(None, spec.split(';'))]


lo, hi = Q.min(0), Q.max(0)
scale = args.height / (hi[1] - lo[1])
origin = np.array([(hi[0] + lo[0]) / 2, lo[1], (hi[2] + lo[2]) / 2])
placed = (Q - origin) * scale
a, cx, cy = map(float, args.registration.split(','))
u = cx + a * placed[:, 0]
v = cy - a * placed[:, 1]
fu, fv, frx, fry = map(float, args.face.split(','))
rr = np.sqrt(((u - fu) / frx) ** 2 + ((v - fv) / fry) ** 2)
fills = ellipses(args.fill)
in_fill = np.zeros(n, int)  # 1 + index of the fill ellipse, 0 = none
for k, (eu, ev, erx, ery) in enumerate(fills):
    inside = np.sqrt(((u - eu) / erx) ** 2 + ((v - ev) / ery) ** 2) < 1
    in_fill[inside & (in_fill == 0)] = k + 1


# front-most surface per reference pixel: a z-buffer of the triangles around the face (the dense surface has a
# vertex every few millimetres, so a per-vertex maximum would leave the back of the head looking frontmost)
def depth_buffer(xy, z, faces, width, height):
    depth = np.full((height, width), -1e9)
    X, Z = xy[faces], z[faces]
    lo_, hi_ = np.floor(X.min(1)).astype(int), np.ceil(X.max(1)).astype(int)
    for f in range(len(faces)):
        x0, x1 = max(lo_[f, 0], 0), min(hi_[f, 0], width - 1)
        y0, y1 = max(lo_[f, 1], 0), min(hi_[f, 1], height - 1)
        if x0 > x1 or y0 > y1:
            continue
        (ax_, ay_), (bx_, by_), (qx_, qy_) = X[f]
        den = (by_ - qy_) * (ax_ - qx_) + (qx_ - bx_) * (ay_ - qy_)
        if abs(den) < 1e-12:
            continue
        sx, sy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((by_ - qy_) * (sx - qx_) + (qx_ - bx_) * (sy - qy_)) / den
        w1 = ((qy_ - ay_) * (sx - qx_) + (ax_ - qx_) * (sy - qy_)) / den
        w2 = 1.0 - w0 - w1
        d = w0 * Z[f, 0] + w1 * Z[f, 1] + w2 * Z[f, 2]
        box = depth[y0:y1 + 1, x0:x1 + 1]
        hit = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6) & (d > box)
        box[hit] = d[hit]
    return depth


near = np.nonzero((np.sqrt(((u[Fw] - fu) / frx) ** 2 + ((v[Fw] - fv) / fry) ** 2) < 1.6).any(1))[0]
x0b, y0b = int(max(fu - 1.7 * frx, 0)), int(max(fv - 1.7 * fry, 0))
Wb, Hb = int(3.4 * frx) + 2, int(3.4 * fry) + 2
front = depth_buffer(np.stack([u - x0b, v - y0b], 1), placed[:, 2], Fw[near], Wb, Hb)
front = cv2.erode(front.astype(np.float32), np.ones((3, 3), np.uint8)).astype(np.float64)
ui = np.clip((u - x0b).astype(int), 0, Wb - 1)
vi = np.clip((v - y0b).astype(int), 0, Hb - 1)
inside_box = (u - x0b >= 0) & (u - x0b < Wb) & (v - y0b >= 0) & (v - y0b < Hb)
behind = np.where(inside_box, front[vi, ui] - placed[:, 2], np.inf)
N0 = vertex_normals(Q, Fw, n)

hair = np.zeros(n, bool)
hair_report = None
if args.hair_guard:
    mat = g.doc['materials'][prim['material']]
    image = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
    albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(image))).convert('RGB'), dtype=np.float64) / 255.0
    AH, AW = albedo.shape[:2]
    uvw = UV[weld]
    col = albedo[np.clip((uvw[:, 1] * AH).astype(int), 0, AH - 1), np.clip((uvw[:, 0] * AW).astype(int), 0, AW - 1)]
    hsv = cv2.cvtColor(col[None].astype(np.float32), cv2.COLOR_RGB2HSV)[0]
    hue, sat, val = hsv[:, 0], hsv[:, 1], hsv[:, 2]
    hair = ((hue < 32) | (hue > 340)) & (sat > 0.38) & (val < 0.58) & (val > 0.08)
    A0 = adjacency(Fw, n)
    for _ in range(2):  # the fringe of a lock
        hair = hair | (A0 @ hair.astype(float) > 0)
    hair_report = dict(rule='hue <32 or >340 deg, saturation >0.38, value 0.08-0.58, grown 2 rings',
                       inFaceEllipse=int((hair & (rr < 1)).sum()))
protect = hair & (in_fill == 0)  # carved lashes in a fill ellipse have the colour of hair

# ---- the smooth skin
sample = (rr < 1.15) & (behind < 0.002) & ~hair & (N0[:, 2] > 0.2) & (in_fill == 0)
xy = placed[:, :2]
rounds = []
for _ in range(8):
    spline = RBFInterpolator(xy[sample], placed[sample, 2], kernel='thin_plate_spline', smoothing=args.smoothing)
    res = placed[sample, 2] - spline(xy[sample])
    rounds.append(dict(samples=int(sample.sum()), rmsMetres=float(np.sqrt(np.mean(res ** 2))), maxMetres=float(np.abs(res).max())))
    bad = np.abs(res) > args.clip
    if not bad.any():
        break
    idx = np.nonzero(sample)[0]
    sample[idx[bad]] = False
consider = ((rr < 1.05) | (in_fill > 0)) & np.isfinite(behind)
gap = np.full(n, np.nan)
gap[consider] = spline(xy[consider]) - placed[consider, 2]  # > 0: behind the fit

# ---- cut the carved features out
X = placed.copy()
A = adjacency(Fw, n)
deleted_v = np.zeros(n, bool)
fill_report = []
for k in range(1, len(fills) + 1):
    cand = (in_fill == k) & (gap > -args.fill_front) & (gap < args.fill_back)
    seeds = cand & (behind < 0.003)
    region = seeds.copy()
    while True:  # flood fill within the candidates
        grow = region | ((A @ region.astype(float) > 0) & cand)
        if grow.sum() == region.sum():
            break
        region = grow
    deleted_v |= region
    fill_report.append(dict(ellipse=fills[k - 1], candidates=int(cand.sum()), seeds=int(seeds.sum()), deleted=int(region.sum())))
keep_tri = ~deleted_v[Fw].any(1)
# pieces left disconnected inside a fill ellipse (lash tips, a hidden floor) go too
Fk = Fw[keep_tri]
used = np.zeros(n, bool)
used[Fk.ravel()] = True
Ak = adjacency(Fk, n)
ncomp, label = sp.csgraph.connected_components(Ak, directed=False)
sizes = np.bincount(label[used], minlength=ncomp)
main = np.argmax(sizes)
stray_tri = np.zeros(len(Fw), bool)
for c in np.unique(label[used]):
    members = (label == c) & used
    if c != main and sizes[c] < 0.01 * used.sum() and (in_fill[members] > 0).mean() > 0.5:
        stray_tri |= members[Fw].all(1) & keep_tri
keep_tri &= ~stray_tri

# ---- boundary loops of the holes
Fk = Fw[keep_tri]
half = np.concatenate([Fk[:, [0, 1]], Fk[:, [1, 2]], Fk[:, [2, 0]]])
gone = Fw[~keep_tri]
gone_edges = {tuple(sorted(e)) for e in np.concatenate([gone[:, [0, 1]], gone[:, [1, 2]], gone[:, [2, 0]]]).tolist()}
existing = {tuple(e) for e in half.tolist()}
boundary = [tuple(e) for e in half.tolist() if (e[1], e[0]) not in existing and tuple(sorted(e)) in gone_edges]
outgoing = {}
for a_, b_ in boundary:
    outgoing.setdefault(a_, []).append(b_)
loops, seen = [], set()
for start in list(outgoing):
    for first in list(outgoing[start]):
        if (start, first) in seen:
            continue
        loop, cur, nxt = [start], start, first
        ok = True
        while True:
            seen.add((cur, nxt))
            if nxt == start:
                break
            loop.append(nxt)
            choices = [b_ for b_ in outgoing.get(nxt, []) if (nxt, b_) not in seen]
            if not choices or len(loop) > 20000:
                ok = False
                break
            cur, nxt = nxt, choices[0]
        if ok and len(loop) >= 3:
            loops.append(loop)

# ---- caps
new_pos, new_uv, new_tri = [], [], []  # new vertices (placed metres) appended after the kept ones
skin_uv_fixed = tuple(map(float, args.skin_uv.split(','))) if args.skin_uv else None
uv_weld = UV[weld]
cap_report = []
for loop in loops:
    L = np.array(loop)
    ring0 = X[L]
    centre = ring0[:, :2].mean(0)
    M, R = len(L), max(2, args.rings)
    base = n + sum(len(p) for p in new_pos)
    # vertex layout of this cap: ring 0 duplicates (cap UVs), rings 1..R-1, centre
    ring_xy = [ring0[:, :2]] + [centre + (ring0[:, :2] - centre) * (1 - r / R) for r in range(1, R)]
    pts = np.concatenate(ring_xy + [centre[None]])
    idx = lambda r, i: r * M + (i % M)  # noqa: E731
    centre_id = R * M
    tris = []
    for r in range(R - 1):
        for i in range(M):
            o0, o1, i0, i1 = idx(r, i), idx(r, i + 1), idx(r + 1, i), idx(r + 1, i + 1)
            # the kept surface runs L[i] -> L[i+1] along the hole; the cap runs the other way
            tris += [(o1, o0, i0), (o1, i0, i1)]
    for i in range(M):
        tris.append((idx(R - 1, i + 1), idx(R - 1, i), centre_id))
    tris = np.array(tris)
    # uniform Laplacian (x, y) with ring 0 fixed: a Tutte embedding of the cap
    count = len(pts)
    Ac = adjacency(tris, count)
    deg = np.maximum(np.asarray(Ac.sum(1)).ravel(), 1)
    free = np.arange(count) >= M
    for _ in range(60):
        avg = Ac @ pts / deg[:, None]
        pts[free] = avg[free]
    z = spline(pts)
    cap = np.c_[pts, z]
    cap[:M] = ring0  # the boundary keeps its own position
    t = cap[tris]
    fz = np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0])[:, 2]
    if skin_uv_fixed:
        skin = np.array(skin_uv_fixed)
    else:
        d = np.linalg.norm(xy[sample] - centre, axis=1)
        skin = np.median(uv_weld[sample][np.argsort(d)[:40]], axis=0)
    new_pos.append(cap)
    new_uv.append(np.repeat(skin[None], len(cap), axis=0))
    new_tri.append(tris + base)
    cap_report.append(dict(boundaryVertices=M, rings=R, triangles=len(tris), facingBack=int((fz < 0).sum()),
                           centreUV=[float(skin[0]), float(skin[1])],
                           centrePixel=[float(cx + a * centre[0]), float(cy - a * centre[1])]))

# ---- the rest of the face onto the fit along z
step = 0.002
nz = np.zeros(n)
region = consider & ~deleted_v & np.isfinite(gap)
pts_r = xy[region]
dzdx = (spline(pts_r + [step, 0]) - spline(pts_r - [step, 0])) / (2 * step)
dzdy = (spline(pts_r + [0, step]) - spline(pts_r - [0, step])) / (2 * step)
nz[region] = 1 / np.sqrt(1 + dzdx ** 2 + dzdy ** 2)
f0, f1 = map(float, args.facing.split(','))
t = np.clip((nz - f0) / (f1 - f0), 0, 1)
facing = t * t * (3 - 2 * t)
w = np.clip((1 - rr) / args.feather, 0, 1)
w = w * w * (3 - 2 * w)
movable = region & (behind < max(args.back_move, 0.004)) & (gap > -args.front_move) & (gap < args.back_move) & ~protect
weight = np.where(movable, w * facing, 0.0)
X[:, 2] += np.nan_to_num(weight * gap)
moved = np.abs(np.nan_to_num(weight * gap))

# ---- rebuild the unwelded mesh: kept vertices (their own UVs) + caps
all_placed = np.concatenate([X] + new_pos) if new_pos else X
all_src = all_placed / scale + origin
faces_w = np.concatenate([Fw[keep_tri]] + new_tri) if new_tri else Fw[keep_tri]
normals_w = vertex_normals(all_src, faces_w, len(all_src))
kept_src = F[keep_tri]  # unwelded indices of kept triangles
used_unwelded = np.unique(kept_src)
remap = -np.ones(len(P), np.int64)
remap[used_unwelded] = np.arange(len(used_unwelded))
pos_out = [all_src[inverse[used_unwelded]]]
nrm_out = [normals_w[inverse[used_unwelded]]]
uv_out = [UV[used_unwelded]]
tri_out = [remap[kept_src]]
offset = len(used_unwelded)
for cap, uvs, tris in zip(new_pos, new_uv, new_tri):
    ids = tris - tris.min()
    pos_out.append(cap / scale + origin)
    nrm_out.append(normals_w[tris.min():tris.min() + len(cap)])
    uv_out.append(uvs)
    tri_out.append(ids + offset)
    offset += len(cap)
positions = np.concatenate(pos_out).astype(np.float32)
normals_out = np.concatenate(nrm_out).astype(np.float32)
uvs_out = np.concatenate(uv_out).astype(np.float32)
indices = np.concatenate(tri_out).astype(np.uint32).ravel()

b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    b.add_view(g.view_bytes(i), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
primitive = b.doc['meshes'][0]['primitives'][0]
primitive['attributes'] = {
    'POSITION': b.add_accessor(positions, 5126, 'VEC3', 34962, minmax=True),
    'NORMAL': b.add_accessor(normals_out, 5126, 'VEC3', 34962),
    'TEXCOORD_0': b.add_accessor(uvs_out, 5126, 'VEC2', 34962),
}
primitive['indices'] = b.add_accessor(indices, 5125, 'SCALAR', 34963)
b.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(author='Claude Code (Opus 5.5)', script='scripts/remake/face_plate.py', source=args.dense, sourceSha256=sha(args.dense),
              output=args.out, outputSha256=sha(args.out), height=args.height, scale=float(scale), registration=[a, cx, cy],
              face=dict(u=fu, v=fv, rx=frx, ry=fry, feather=args.feather),
              fit=dict(kernel='thin_plate_spline', smoothing=args.smoothing, clip=args.clip, rounds=rounds),
              fill=dict(front=args.fill_front, back=args.fill_back, regions=fill_report, deletedTriangles=int((~keep_tri).sum()),
                        strayTriangles=int(stray_tri.sum()), holes=len(loops), caps=cap_report),
              move=dict(frontMove=args.front_move, backMove=args.back_move, facing=[f0, f1], moved=int((moved > 0.0005).sum()),
                        maxMetres=float(moved.max())), hairGuard=hair_report,
              triangles=dict(before=int(len(F)), after=int(len(indices) // 3)), vertices=dict(before=int(len(P)), after=int(len(positions))))
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('FACE_PLATE_DONE', json.dumps(dict(fit=rounds[-1], fill=report['fill']['regions'], holes=len(loops),
                                         caps=[(c['boundaryVertices'], c['facingBack']) for c in cap_report],
                                         moved=report['move'], triangles=report['triangles'])))
