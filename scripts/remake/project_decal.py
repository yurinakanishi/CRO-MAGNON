"""Repaints a small painted motif of the reference (a hand stencil on a tunic) onto the base colour of one material,
seen from the front, the way project_face.py paints the face onto the head.

TRELLIS-2 reconstructs small painted motifs as blurred blobs (the chibi topknot boy's red-ochre hand stencil became a
round red patch, smaller and higher than the reference hand because the torso came out shorter). Two steps, both
limited to texels of --material whose surface point projects (registration of project_face.py: u = CX + SCALE * x,
v = CY - SCALE * y on the placed model in metres) inside --ellipse (model grid pixels, feathered by --feather, a
fraction of the radii) and that face the camera (normal z ramp --facing):

1. erase: texels redder than the ramp --erase-redness (R - G, 0-255) are pulled to the --erase colour (the tunic);
2. motif: the reference's motif (pixels within --motif-tolerance of --motif, the largest connected component inside
   the ellipse, closed and slightly blurred) is painted where it lands, through --transform (the reference point
   FROM is drawn at TO on the model grid, scaled by S about it) and, for texels that are the front-most surface there
   (a z-buffer of every primitive), with the reference colours passed through --map (per-channel linear fit through
   FROM:TO colour pairs, so that the motif's anti-aliased edge meets the model's tunic instead of the reference's).
Texels brighter than --keep-bright (luminance ramp of the model's own colour: a necklace tooth, fur trim) are left as
they are in both steps.

  python scripts/remake/project_decal.py IN.glb REFERENCE.png OUT.glb --registration SCALE,CX,CY
      --ellipse U,V,RX,RY --motif R,G,B [--motif-tolerance 48] [--transform S,FX,FY,TX,TY]
      [--erase R,G,B --erase-redness 55,75] [--map 105,73,61:127,85,65 --map 188,105,82:188,105,82]
      [--keep-bright 0.66,0.74] [--material BodySurface] [--feather 0.3] [--facing 0.2,0.5]

Only that material's base colour image changes. Writes OUT.glb, OUT.json and OUT-decal.png (red: erase weight,
green: motif weight, on the atlas) and OUT-motif.png (the motif mask on the reference).
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

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Builder, Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('reference')
ap.add_argument('out')
ap.add_argument('--registration', required=True)
ap.add_argument('--ellipse', required=True, help='U,V,RX,RY on the model grid (reference pixels)')
ap.add_argument('--motif', required=True, help='R,G,B of the motif in the reference')
ap.add_argument('--motif-tolerance', type=float, default=48)
ap.add_argument('--motif-close', type=int, default=3, help='closing radius of the motif mask (reference pixels)')
ap.add_argument('--motif-blur', type=float, default=0.8, help='Gaussian sigma of the motif mask edge (reference pixels)')
ap.add_argument('--transform', default='', help='S,FX,FY,TX,TY: reference point FX,FY drawn at TX,TY, scaled by S')
ap.add_argument('--erase', default='', help='R,G,B the redder texels inside the ellipse are pulled to')
ap.add_argument('--erase-redness', default='55,75', help='R - G ramp (0-255) of the erase')
ap.add_argument('--map', action='append', default=[], help='FROM_R,G,B:TO_R,G,B colour pair for the reference samples')
ap.add_argument('--keep-bright', default='', help='LO,HI luminance ramp (0-1) of model texels left untouched (teeth, fur)')
ap.add_argument('--material', default='BodySurface')
ap.add_argument('--feather', type=float, default=0.3)
ap.add_argument('--facing', default='0.2,0.5')
ap.add_argument('--gutter', type=float, default=2, help='atlas texels around the charts painted with them')
ap.add_argument('--depth-tolerance', type=float, default=0.012, help='metres behind the front-most surface still painted')
ap.add_argument('--webp-quality', type=int, default=92)
args = ap.parse_args()

scale, cx, cy = (float(x) for x in args.registration.split(','))
eu, ev, erx, ery = (float(x) for x in args.ellipse.split(','))
f0, f1 = (float(x) for x in args.facing.split(','))
ts, fx, fy, tx, ty = (float(x) for x in args.transform.split(',')) if args.transform else (1.0, 0.0, 0.0, 0.0, 0.0)
ref = np.asarray(Image.open(args.reference).convert('RGB'), dtype=np.float32) / 255
RH, RW = ref.shape[:2]


def to_reference(q):
    return np.stack([fx + (q[:, 0] - tx) / ts, fy + (q[:, 1] - ty) / ts], axis=1)


# colour map of the reference samples: per channel, a line through the FROM:TO pairs (one pair: an offset)
pairs = [[[float(v) / 255 for v in side.split(',')] for side in m.split(':')] for m in args.map]
colour_map = []
for ch in range(3):
    if not pairs:
        colour_map.append((1.0, 0.0))
    elif len(pairs) == 1:
        colour_map.append((1.0, pairs[0][1][ch] - pairs[0][0][ch]))
    else:
        slope, offset = np.polyfit([p[0][ch] for p in pairs], [p[1][ch] for p in pairs], 1)
        colour_map.append((float(slope), float(offset)))

# the motif mask on the reference: colour distance, the largest component inside the ellipse's preimage
motif = np.array([float(v) / 255 for v in args.motif.split(',')], np.float32)
close = np.linalg.norm(ref - motif, axis=2) < args.motif_tolerance / 255
ys_r, xs_r = np.mgrid[0:RH, 0:RW]
pu, pv = fx + (eu - tx) / ts, fy + (ev - ty) / ts
inside = ((xs_r - pu) / (erx / ts)) ** 2 + ((ys_r - pv) / (ery / ts)) ** 2 < 1
count, labels, comp_stats, _ = cv2.connectedComponentsWithStats((close & inside).astype(np.uint8), connectivity=8)
if count < 2:
    raise SystemExit('no motif pixels inside the ellipse')
largest = 1 + int(np.argmax(comp_stats[1:, cv2.CC_STAT_AREA]))
mask = (labels == largest).astype(np.uint8)
if args.motif_close > 0:
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * args.motif_close + 1,) * 2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel)
mask = mask.astype(np.float32)
if args.motif_blur > 0:
    mask = cv2.GaussianBlur(mask, (0, 0), args.motif_blur)
motif_box = comp_stats[largest, :4].tolist()

g = Glb(args.glb)
doc = g.doc
material = next(i for i, m in enumerate(doc['materials']) if m.get('name') == args.material)
prims = doc['meshes'][0]['primitives']


def project(points):
    return np.stack([cx + scale * points[:, 0], cy - scale * points[:, 1]], axis=1)


# 1. the front-most depth (largest z) of every primitive, per model-grid pixel
depth = np.full((RH, RW), -np.inf, np.float32)
for prim in prims:
    P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
    F = g.accessor(prim['indices']).reshape(-1, 3)
    q = project(P)
    for tri in F:
        a, b, c = q[tri]
        x0, x1 = int(max(0, np.floor(min(a[0], b[0], c[0])))), int(min(RW - 1, np.ceil(max(a[0], b[0], c[0]))))
        y0, y1 = int(max(0, np.floor(min(a[1], b[1], c[1])))), int(min(RH - 1, np.ceil(max(a[1], b[1], c[1]))))
        if x1 < x0 or y1 < y0:
            continue
        den = (b[1] - c[1]) * (a[0] - c[0]) + (c[0] - b[0]) * (a[1] - c[1])
        if abs(den) < 1e-12:
            continue
        ys, xs = np.mgrid[y0:y1 + 1, x0:x1 + 1]
        px, py = xs + 0.5, ys + 0.5
        w0 = ((b[1] - c[1]) * (px - c[0]) + (c[0] - b[0]) * (py - c[1])) / den
        w1 = ((c[1] - a[1]) * (px - c[0]) + (a[0] - c[0]) * (py - c[1])) / den
        w2 = 1 - w0 - w1
        hit = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6)
        if not hit.any():
            continue
        z = w0 * P[tri[0], 2] + w1 * P[tri[1], 2] + w2 * P[tri[2], 2]
        region = depth[y0:y1 + 1, x0:x1 + 1]
        np.maximum(region, np.where(hit, z, -np.inf), out=region)

# 2. the covered texels of the material near the ellipse: surface point, normal and projection
prim = next(p for p in prims if p.get('material') == material)
P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3)
mat = doc['materials'][material]
image_index = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(image_index))).convert('RGB'), dtype=np.float32) / 255
AH, AW = albedo.shape[:2]
normals = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
normals /= np.linalg.norm(normals, axis=1, keepdims=True) + 1e-12
centres = project(P[F].mean(axis=1))
near = ((centres[:, 0] - eu) / (erx * 1.2)) ** 2 + ((centres[:, 1] - ev) / (ery * 1.2)) ** 2 < 1
# every face of the material on the atlas, then the gutter texels within --gutter of a chart take the nearest chart
# texel's face (the renderer's bilinear filter reads them along chart edges: unpainted, they show as a seam line)
texel_face = np.full((AH, AW), -1, np.int32)
for f in range(len(F)):
    cv2.fillPoly(texel_face, [(UV[F[f]] * [AW, AH] * 16).round().astype(np.int32)], int(f), lineType=cv2.LINE_8, shift=4)
if args.gutter > 0:
    empty = (texel_face < 0).astype(np.uint8)
    distance, nearest = cv2.distanceTransformWithLabels(empty, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    zy, zx = np.nonzero(empty == 0)
    face_of_label = np.full(nearest.max() + 1, -1, np.int32)
    face_of_label[nearest[zy, zx]] = texel_face[zy, zx]
    gy, gx = np.nonzero((empty == 1) & (distance <= args.gutter))
    texel_face[gy, gx] = face_of_label[nearest[gy, gx]]
texel_face[(texel_face >= 0) & ~near[np.maximum(texel_face, 0)]] = -1
ys, xs = np.nonzero(texel_face >= 0)
fid = texel_face[ys, xs]
uvp = np.c_[(xs + 0.5) / AW, (ys + 0.5) / AH]
a, b, c = UV[F[fid, 0]], UV[F[fid, 1]], UV[F[fid, 2]]
v0, v1, v2 = b - a, c - a, uvp - a
d00, d01, d11 = (v0 * v0).sum(1), (v0 * v1).sum(1), (v1 * v1).sum(1)
d20, d21 = (v2 * v0).sum(1), (v2 * v1).sum(1)
den = np.where(np.abs(d00 * d11 - d01 * d01) < 1e-18, 1e-18, d00 * d11 - d01 * d01)
l1 = np.clip((d11 * d20 - d01 * d21) / den, 0, 1)
l2 = np.clip((d00 * d21 - d01 * d20) / den, 0, 1)
l0 = np.clip(1 - l1 - l2, 0, 1)
X = P[F[fid, 0]] * l0[:, None] + P[F[fid, 1]] * l1[:, None] + P[F[fid, 2]] * l2[:, None]
q = project(X)


def sample_at(image, points, border):
    # bilinear samples at reference pixel positions; cv2.remap maps must stay under 32767 rows
    n = len(points)
    rows = -(-n // 1024)
    grid = np.zeros((rows * 1024, 2), np.float32)
    grid[:n] = points - 0.5
    grid = grid.reshape(rows, 1024, 2)
    values = cv2.remap(image, grid[..., 0], grid[..., 1], cv2.INTER_LINEAR, borderMode=border, borderValue=0)
    return values.reshape(rows * 1024, -1)[:n]


def smooth(t):
    t = np.clip(t, 0, 1)
    return t * t * (3 - 2 * t)


rr = np.sqrt(((q[:, 0] - eu) / erx) ** 2 + ((q[:, 1] - ev) / ery) ** 2)
w_ellipse = smooth((1 - rr) / args.feather)
w_facing = np.clip((normals[fid, 2] - f0) / (f1 - f0), 0, 1)
qi = np.clip(q.round().astype(int), [0, 0], [RW - 1, RH - 1])
w_visible = (X[:, 2] >= depth[qi[:, 1], qi[:, 0]] - args.depth_tolerance).astype(np.float32)
before = albedo[ys, xs]
colour = before.copy()
w_keep = np.ones(len(ys), np.float32)
if args.keep_bright:
    k0, k1 = (float(v) for v in args.keep_bright.split(','))
    w_keep = (1 - smooth((before @ np.array([0.299, 0.587, 0.114], np.float32) - k0) / (k1 - k0))).astype(np.float32)

# 3. erase the reconstruction's blob
w_erase = np.zeros(len(ys), np.float32)
if args.erase:
    erase = np.array([float(v) / 255 for v in args.erase.split(',')], np.float32)
    r0, r1 = (float(v) / 255 for v in args.erase_redness.split(','))
    redness = before[:, 0] - before[:, 1]
    w_erase = (w_ellipse * w_facing * w_keep * smooth((redness - r0) / (r1 - r0))).astype(np.float32)
    colour = colour * (1 - w_erase[:, None]) + erase * w_erase[:, None]

# 4. paint the reference's motif
p = to_reference(q).astype(np.float32)
sample = sample_at(ref, p, cv2.BORDER_REPLICATE).reshape(-1, 3)
for ch, (slope, offset) in enumerate(colour_map):
    sample[:, ch] = sample[:, ch] * slope + offset
w_motif = sample_at(mask, p, cv2.BORDER_CONSTANT).reshape(-1)
w_motif = (np.clip(w_motif, 0, 1) * w_facing * w_visible * w_keep * (rr < 1)).astype(np.float32)
colour = colour * (1 - w_motif[:, None]) + np.clip(sample, 0, 1) * w_motif[:, None]

out = albedo.copy()
out[ys, xs] = colour
weights = np.zeros((AH, AW, 3), np.float32)
weights[ys, xs, 0] = w_erase
weights[ys, xs, 1] = w_motif
buffer = io.BytesIO()
Image.fromarray((np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
view = doc['images'][image_index]['bufferView']
builder = Builder(doc)
for i, vdef in enumerate(doc['bufferViews']):
    builder.add_view(buffer.getvalue() if i == view else g.view_bytes(i), vdef.get('target'))
    if 'byteStride' in vdef:
        builder.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
builder.write(args.out)
stem = str(Path(args.out).with_suffix(''))
Image.fromarray((np.clip(weights, 0, 1) * 255).astype(np.uint8)).save(stem + '-decal.png')
Image.fromarray((np.clip(mask, 0, 1) * 255).astype(np.uint8)).save(stem + '-motif.png')
sha = lambda path: hashlib.sha256(Path(path).read_bytes()).hexdigest()  # noqa: E731
report = dict(script='scripts/remake/project_decal.py', source=args.glb, sourceSha256=sha(args.glb), reference=args.reference,
              referenceSha256=sha(args.reference), output=args.out, outputSha256=sha(args.out), material=args.material,
              registration=args.registration, ellipse=args.ellipse, feather=args.feather, facing=args.facing,
              transform=args.transform or None, motif=args.motif, motifTolerance=args.motif_tolerance,
              motifBoxReference=motif_box, motifPixels=int(comp_stats[largest, cv2.CC_STAT_AREA]),
              erase=args.erase or None, eraseRedness=args.erase_redness if args.erase else None,
              keepBright=args.keep_bright or None, map=args.map,
              colourMap=[dict(slope=round(s, 4), offset=round(o, 4)) for s, o in colour_map],
              texels=int(len(ys)), erased=int((w_erase > 0.01).sum()), painted=int((w_motif > 0.01).sum()),
              paintedFull=int((w_motif > 0.99).sum()))
Path(stem + '.json').write_text(json.dumps(report, indent=2) + '\n')
print('DECAL_DONE', json.dumps({k: report[k] for k in ('motifBoxReference', 'motifPixels', 'texels', 'erased', 'painted',
                                                        'paintedFull')}))
