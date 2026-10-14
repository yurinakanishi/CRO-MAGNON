"""Base colour of a reduced mesh from the nearest point of the dense TRELLIS surface (no rays).

Blender's selected-to-active bake (remake_process.py) casts rays along the low mesh's normals from a cage. On a thin
layer over another one (the chibi bear girl's fur cape over her dress), a reduced face that cuts below the dense
layer, or whose normal turned inward on a double-walled sheet, samples the layer underneath: cream dress patches on
the brown cape. Here every texel of the low atlas takes the colour of the nearest of a few million area-weighted
samples of the dense surface, whatever the normals.

  python scripts/remake/nearest_albedo.py DENSE.glb LOW_ATLAS.glb BAKED.glb OUT.glb [--samples 4000000]
      [--only-region X0:X1:Y0:Y1:Z0:Z1] [--max-distance 0.02]

LOW_ATLAS.glb is the xatlas_unwrap.py output (dense units, the atlas the bake used with --keep-low-uv); BAKED.glb the
remake_process.py candidate on that atlas. Only its base colour image is replaced (WebP q92); geometry, UVs, normal
map and materials stay. --only-region limits the replacement to faces whose centroid is in that dense-unit box (the
rest keeps the ray bake); texels whose nearest sample is farther than --max-distance (dense units) keep it too.
Writes OUT.glb and OUT.json.
"""
import argparse
import hashlib
import io
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy.spatial import cKDTree

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Builder, Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('dense')
ap.add_argument('low')
ap.add_argument('baked')
ap.add_argument('out')
ap.add_argument('--samples', type=int, default=4_000_000)
ap.add_argument('--only-region', default='')
ap.add_argument('--max-distance', type=float, default=0.02)
ap.add_argument('--webp-quality', type=int, default=92)
args = ap.parse_args()


def mesh_arrays(g):
    points, uvs, faces, offset = [], [], [], 0
    for prim in g.doc['meshes'][0]['primitives']:
        P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
        points.append(P)
        uvs.append(g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64))
        faces.append(g.accessor(prim['indices']).reshape(-1, 3) + offset)
        offset += len(P)
    return np.concatenate(points), np.concatenate(uvs), np.concatenate(faces)


def base_image(g, material=0):
    mat = g.doc['materials'][material]
    image = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
    return image, np.asarray(Image.open(io.BytesIO(g.image_bytes(image))).convert('RGB'), dtype=np.float32) / 255


# 1. the dense surface as coloured samples
dense = Glb(args.dense)
DP, DUV, DF = mesh_arrays(dense)
_, dense_tex = base_image(dense)
TH, TW = dense_tex.shape[:2]
t = DP[DF]
area = np.linalg.norm(np.cross(t[:, 1] - t[:, 0], t[:, 2] - t[:, 0]), axis=1)
rng = np.random.default_rng(7)
pick = rng.choice(len(DF), args.samples, p=area / area.sum())
w = rng.random((args.samples, 2))
flip = w.sum(1) > 1
w[flip] = 1 - w[flip]
bary = np.c_[1 - w.sum(1), w]
S = (t[pick] * bary[..., None]).sum(1)
suv = (DUV[DF[pick]] * bary[..., None]).sum(1)
colour = dense_tex[np.clip((suv[:, 1] * TH).astype(int), 0, TH - 1), np.clip((suv[:, 0] * TW).astype(int), 0, TW - 1)]
tree = cKDTree(S)

# 2. every covered texel of the low atlas: its 3D point by barycentric interpolation
low = Glb(args.low)
LP, LUV, LF = mesh_arrays(low)
baked = Glb(args.baked)
image_index, baked_tex = base_image(baked)
AH, AW = baked_tex.shape[:2]
faces = np.arange(len(LF))
if args.only_region:
    v = [float(x) for x in args.only_region.split(':')]
    c = LP[LF].mean(1)
    lo_b, hi_b = np.array(v[0:6:2]), np.array(v[1:6:2])
    faces = faces[np.all((c >= lo_b) & (c <= hi_b), axis=1)]
texel_face = np.full((AH, AW), -1, np.int32)
for f in faces:
    tri = (LUV[LF[f]] * [AW, AH] * 16).round().astype(np.int32)
    cv2.fillPoly(texel_face, [tri], int(f), lineType=cv2.LINE_8, shift=4)
ys, xs = np.nonzero(texel_face >= 0)
fid = texel_face[ys, xs]
uvp = np.c_[(xs + 0.5) / AW, (ys + 0.5) / AH]
a, b, c = LUV[LF[fid, 0]], LUV[LF[fid, 1]], LUV[LF[fid, 2]]
v0, v1, v2 = b - a, c - a, uvp - a
d00 = (v0 * v0).sum(1)
d01 = (v0 * v1).sum(1)
d11 = (v1 * v1).sum(1)
d20 = (v2 * v0).sum(1)
d21 = (v2 * v1).sum(1)
den = np.where(np.abs(d00 * d11 - d01 * d01) < 1e-18, 1e-18, d00 * d11 - d01 * d01)
l1 = np.clip((d11 * d20 - d01 * d21) / den, 0, 1)
l2 = np.clip((d00 * d21 - d01 * d20) / den, 0, 1)
l0 = np.clip(1 - l1 - l2, 0, 1)
X = LP[LF[fid, 0]] * l0[:, None] + LP[LF[fid, 1]] * l1[:, None] + LP[LF[fid, 2]] * l2[:, None]

# 3. nearest dense sample; far texels keep the ray bake
dist, nearest = tree.query(X, workers=-1)
near = dist <= args.max_distance
out = baked_tex.copy()
out[ys[near], xs[near]] = colour[nearest[near]]
written = np.zeros((AH, AW), np.uint8)
written[ys[near], xs[near]] = 1
# a 2-texel seam blend into the untouched texels around a region
if args.only_region:
    soft = cv2.GaussianBlur(written.astype(np.float32), (0, 0), 1.0)[..., None]
    out = baked_tex * (1 - soft) + out * soft
buffer = io.BytesIO()
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
view = baked.doc['images'][image_index]['bufferView']
b_ = Builder(baked.doc)
for i, vdef in enumerate(baked.doc['bufferViews']):
    b_.add_view(buffer.getvalue() if i == view else baked.view_bytes(i), vdef.get('target'))
    if 'byteStride' in vdef:
        b_.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
b_.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(script='scripts/remake/nearest_albedo.py', dense=args.dense, denseSha256=sha(args.dense), low=args.low,
              baked=args.baked, bakedSha256=sha(args.baked), output=args.out, outputSha256=sha(args.out),
              samples=args.samples, region=args.only_region or None, maxDistance=args.max_distance,
              texels=int(len(ys)), replaced=int(near.sum()),
              distance=dict(p50=float(np.percentile(dist, 50)), p95=float(np.percentile(dist, 95)), max=float(dist.max())))
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('NEAREST_DONE', json.dumps({k: report[k] for k in ('texels', 'replaced', 'distance')}))
