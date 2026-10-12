"""Project the generated front reference's face onto a reduced full-body character's albedo atlas.

python scripts/remake/project_face.py <processed.glb> <reference.png> <outdir> --landmarks EYE_ROW,CHIN_ROW
    [--mode detail|replace] [--sigma 48] [--ellipse 0.95,1.15,0.06,0.3] [--facing 0.3,0.6]

For a character reconstructed in one piece from its front reference (2026-10 candidate 3 of the
Cro-Magnon woman): TRELLIS-2 keeps the shape of the face well, but its texture field is soft and its
colours drift (grey eyes, a red nose), while the reference is a sharp, evenly lit front view of the
intended face. Geometry is not touched; only the albedo texels of the face change.
  1. Registration: the reference foreground mask is matched to the orthographic front silhouette of
     the whole character (glTF +Z forward, +Y up) by a uniform scale and a 2D offset, maximising IoU.
  2. Alignment: optical flow between the character's own albedo seen from the reference camera and
     the reference, inside a feathered face ellipse from the eye and chin rows, moves the reference
     (not the mesh) onto the reconstructed features.
  3. Projection: every atlas texel is rasterised in UV space to its 3D point and normal. Texels that
     face the camera, are visible from it and fall inside the face ellipse take the reference,
     fading out with the angle, the occlusion depth and the ellipse feather. In --mode detail the
     reference contributes only detail finer than --sigma pixels on top of the reconstruction's own
     low-frequency colour, so the projected face has no colour step where it fades out.
The ellipse is limited to the face, so the clothes, arms and legs keep their reconstructed albedo.
Outputs face.glb (the processed GLB with only the base colour (and normal) images replaced, WebP),
albedo.png, weight.png, overlay.jpg, front-before.jpg, front-after-source.jpg, report.json.
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


# numpy versions of the face-remake rasterisers (scripts/face-remake/raster.py needs numba); a reduced
# character has only a few thousand triangles, so a per-triangle loop over small boxes is quick.
def depth_buffer(xy, z, faces, width, height):
    """Orthographic front view: largest z wins (camera on +Z looking toward -Z). Returns depth and triangle id."""
    depth = np.full((height, width), -1e9)
    tri = np.full((height, width), -1, dtype=np.int64)
    X, Z = xy[faces], z[faces]
    lo, hi = np.floor(X.min(1)).astype(int), np.ceil(X.max(1)).astype(int)
    for f in range(len(faces)):
        x0, x1 = max(lo[f, 0], 0), min(hi[f, 0], width - 1)
        y0, y1 = max(lo[f, 1], 0), min(hi[f, 1], height - 1)
        if x0 > x1 or y0 > y1:
            continue
        (ax, ay), (bx, by), (qx, qy) = X[f]
        den = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
        if abs(den) < 1e-12:
            continue
        sx, sy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((by - qy) * (sx - qx) + (qx - bx) * (sy - qy)) / den
        w1 = ((qy - ay) * (sx - qx) + (ax - qx) * (sy - qy)) / den
        w2 = 1.0 - w0 - w1
        d = w0 * Z[f, 0] + w1 * Z[f, 1] + w2 * Z[f, 2]
        box = depth[y0:y1 + 1, x0:x1 + 1]
        hit = (w0 >= -1e-6) & (w1 >= -1e-6) & (w2 >= -1e-6) & (d > box)
        box[hit] = d[hit]
        tri[y0:y1 + 1, x0:x1 + 1][hit] = f
    return depth, tri


def silhouette(xy, faces, width, height):
    # one call per triangle: fillPoly with many contours uses the even-odd rule, so overlaps would cancel
    image = np.zeros((height, width), np.uint8)
    for triangle in np.round(xy[faces] * 16).astype(np.int32):
        cv2.fillConvexPoly(image, triangle, 1, lineType=cv2.LINE_8, shift=4)
    return image.astype(bool)


def uv_raster(uvpix, faces, width, height):
    """Per-texel triangle id and barycentrics in UV space (first triangle wins; atlases do not overlap)."""
    tri = np.full((height, width), -1, dtype=np.int64)
    bary = np.zeros((height, width, 3))
    X = uvpix[faces]
    lo, hi = np.floor(X.min(1)).astype(int) - 1, np.ceil(X.max(1)).astype(int) + 1
    for f in range(len(faces)):
        x0, x1 = max(lo[f, 0], 0), min(hi[f, 0], width - 1)
        y0, y1 = max(lo[f, 1], 0), min(hi[f, 1], height - 1)
        (ax, ay), (bx, by), (qx, qy) = X[f]
        den = (by - qy) * (ax - qx) + (qx - bx) * (ay - qy)
        if abs(den) < 1e-14 or x0 > x1 or y0 > y1:
            continue
        sx, sy = np.meshgrid(np.arange(x0, x1 + 1) + 0.5, np.arange(y0, y1 + 1) + 0.5)
        w0 = ((by - qy) * (sx - qx) + (qx - bx) * (sy - qy)) / den
        w1 = ((qy - ay) * (sx - qx) + (ax - qx) * (sy - qy)) / den
        w2 = 1.0 - w0 - w1
        box = tri[y0:y1 + 1, x0:x1 + 1]
        hit = (w0 >= -1e-4) & (w1 >= -1e-4) & (w2 >= -1e-4) & (box < 0)
        box[hit] = f
        bary[y0:y1 + 1, x0:x1 + 1][hit] = np.stack([w0[hit], w1[hit], w2[hit]], 1)
    return tri, bary


def dilate(image, valid, rounds):
    """Push valid texel colours outward into empty texels (seam padding; as scripts/face-remake/raster.py)."""
    image = image.copy()
    valid = valid.copy()
    for _ in range(rounds):
        acc = np.zeros_like(image)
        cnt = np.zeros(valid.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            shifted_v = np.roll(np.roll(valid, dy, 0), dx, 1)
            acc += np.roll(np.roll(image, dy, 0), dx, 1) * shifted_v[..., None]
            cnt += shifted_v
        grow = (~valid) & (cnt > 0)
        if not grow.any():
            break
        image[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    return image, valid

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('reference')
ap.add_argument('outdir')
ap.add_argument('--landmarks', required=True, help='eye row,chin row in reference pixels')
ap.add_argument('--mode', default='detail', choices=['detail', 'replace'])
ap.add_argument('--sigma', type=float, default=48.0, help='detail mode low-pass radius (reference pixels)')
ap.add_argument('--ellipse', default='0.95,1.15,0.06,0.3',
                help='horizontal radius (x eye-chin), vertical size factor, downward shift (x eye-chin), feather')
ap.add_argument('--facing', default='0.3,0.6', help='normal.z ramp (start,full) for the projection weight')
ap.add_argument('--occlusion', default='0.004,0.012', help='depth gap ramp (full,zero) in metres')
ap.add_argument('--mask', default='', help='foreground matte in reference pixels (8-bit, >127 = subject), e.g. the BiRefNet '
                'cutout of the TRELLIS preparation moved onto the reference; default: a colour distance from the border')
ap.add_argument('--hair-guard', action='store_true', help='keep the reconstruction where either image shows hair: dark-brown '
                'reconstruction texels, and large connected hair regions of the reference (eyebrows are small and stay)')
ap.add_argument('--tone-match', action='store_true', help='scale the projected skin to the skin colour of the reconstruction '
                '(per channel, fitted on skin inside the face ellipse; eye whites and dark features keep their colour)')
ap.add_argument('--flat-normals', type=float, default=0.0, help='0..1: blend the tangent-space normal map toward flat by '
                'this much times the projection weight (the painted face replaces the baked eye sockets and lips)')
ap.add_argument('--registration', default='', help='SCALE,CX,CY: use this registration (pixels per metre and offsets) '
                'instead of fitting the silhouette, e.g. the fit of the whole character when only its head part is projected')
ap.add_argument('--flat-regions', default='', help='U,V,RX,RY[;...]: limit --flat-normals to these ellipses in reference pixels '
                '(e.g. the eyes, whose reconstructed sockets shade the painted eyes; elsewhere the baked normals hide the low-poly facets)')
ap.add_argument('--output-size', type=int, default=0, help='downsample the written albedo and normal map to this size '
                '(a 2048 bake delivered at 1024 is supersampled: no single-sample stair steps along hair edges)')
ap.add_argument('--webp-quality', type=int, default=92, help='quality of the written WebP images (q92 as in the Blender exports of the pipeline; '
                '0 = lossless)')
ap.add_argument('--place-height', type=float, default=0.0, help='place the mesh first as remake_process.py does (ground-centred, '
                'uniform scale to this height along +Y): registers a dense or meshopt GLB in the metres of the processed model')
ap.add_argument('--register-only', action='store_true', help='fit and report the registration only (positions and faces are '
                'enough, e.g. a meshopt_reduce.mjs output); nothing is projected or written besides report.json')
ap.add_argument('--max-flow', type=float, default=30.0)
ap.add_argument('--flow-sigma', type=float, default=16.0)
args = ap.parse_args()
out = Path(args.outdir)
out.mkdir(parents=True, exist_ok=True)

g = Glb(args.glb)
assert len(g.doc['meshes']) == 1 and len(g.doc['meshes'][0]['primitives']) == 1, 'one primitive expected'
prim = g.doc['meshes'][0]['primitives'][0]
P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)
placement = None
if args.place_height:
    lo, hi = P.min(0), P.max(0)
    place_scale = args.place_height / (hi[1] - lo[1])
    place_origin = np.array([(hi[0] + lo[0]) / 2, lo[1], (hi[2] + lo[2]) / 2])
    P = (P - place_origin) * place_scale
    placement = dict(height=args.place_height, scale=float(place_scale), origin=place_origin.tolist())
if not args.register_only:
    N = g.accessor(prim['attributes']['NORMAL']).astype(np.float64)
    UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
    mat = g.doc['materials'][prim['material']]
    base_texture = mat['pbrMetallicRoughness']['baseColorTexture']['index']
    base_image = g.texture_image(base_texture)
    albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(base_image))).convert('RGB'), dtype=np.float64) / 255.0
    AH, AW = albedo.shape[:2]
ref = np.asarray(Image.open(args.reference).convert('RGB'), dtype=np.float64) / 255.0
RH, RW = ref.shape[:2]
eye_row, chin_row = map(float, args.landmarks.split(','))

# ---- reference foreground mask (uniform studio background)
border = np.concatenate([ref[:8].reshape(-1, 3), ref[-8:].reshape(-1, 3), ref[:, :8].reshape(-1, 3), ref[:, -8:].reshape(-1, 3)])
dist = np.linalg.norm(ref - np.median(border, axis=0), axis=2)
mask = (dist > 0.07).astype(np.uint8)
mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
count, labels, stats, _ = cv2.connectedComponentsWithStats(mask)
mask = (labels == 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))).astype(np.uint8)
filled = mask.copy()
cv2.floodFill(filled, np.zeros((RH + 2, RW + 2), np.uint8), (0, 0), 1)
mask = mask | (1 - filled)
if args.mask:
    matte = np.asarray(Image.open(args.mask).convert('L'))
    assert matte.shape == (RH, RW), 'the matte must be in reference pixels'
    mask = (matte > 127).astype(np.uint8)
mask_bool = mask.astype(bool)

# ---- registration: u = cx + a * x, v = cy - a * y (whole-character silhouette)
ys, xs = np.nonzero(mask_bool)
a0 = 0.5 * ((ys.max() - ys.min()) / np.ptp(P[:, 1]) + (xs.max() - xs.min()) / np.ptp(P[:, 0]))
cx0 = 0.5 * (xs.max() + xs.min()) - a0 * 0.5 * (P[:, 0].max() + P[:, 0].min())
cy0 = 0.5 * (ys.max() + ys.min()) + a0 * 0.5 * (P[:, 1].max() + P[:, 1].min())
S = 512
k = S / RW
small = cv2.resize(mask, (S, int(RH * k)), interpolation=cv2.INTER_AREA) > 0


def iou(params):
    a_, cx_, cy_ = params
    xy = np.stack([(cx_ + a_ * P[:, 0]) * k, (cy_ - a_ * P[:, 1]) * k], axis=1)
    sil = silhouette(xy, F, small.shape[1], small.shape[0])
    return (sil & small).sum() / max((sil | small).sum(), 1)


best = np.array([a0, cx0, cy0])
best_iou = initial_iou = iou(best)
steps = np.array([a0 * 0.02, 6.0, 6.0])
if args.registration:
    best = np.array([float(x) for x in args.registration.split(',')])
    best_iou = initial_iou = None  # a part's silhouette is not the reference's; the given fit is kept
for _ in range(0 if args.registration else 80):
    improved = False
    for d in range(3):
        for sgn in (1, -1):
            trial = best.copy()
            trial[d] += sgn * steps[d]
            v = iou(trial)
            if v > best_iou:
                best, best_iou, improved = trial, v, True
    if not improved:
        steps *= 0.5
        if steps[1] < 0.25:
            break
a, cx, cy = best
if args.register_only:
    report = dict(script='scripts/remake/project_face.py --register-only', source=args.glb,
                  sourceSha256=hashlib.sha256(Path(args.glb).read_bytes()).hexdigest(), reference=args.reference,
                  placement=placement, registration=dict(scalePixelsPerMetre=float(a), cx=float(cx), cy=float(cy),
                                                         silhouetteIoU=float(best_iou), initialIoU=float(initial_iou)))
    (out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
    print('REGISTRATION', json.dumps(report['registration']))
    sys.exit(0)


def front_render(image):
    """Depth and the given atlas image (unlit) seen from the reference camera."""
    xy = np.stack([cx + a * P[:, 0], cy - a * P[:, 1]], axis=1)
    depth, tri = depth_buffer(xy, P[:, 2], F, RW, RH)
    sil = depth > -1e8
    py, px = np.nonzero(sil)
    t = tri[py, px]
    q = xy[F[t]]
    sx, sy = px + 0.5, py + 0.5
    den = (q[:, 1, 1] - q[:, 2, 1]) * (q[:, 0, 0] - q[:, 2, 0]) + (q[:, 2, 0] - q[:, 1, 0]) * (q[:, 0, 1] - q[:, 2, 1])
    w0 = ((q[:, 1, 1] - q[:, 2, 1]) * (sx - q[:, 2, 0]) + (q[:, 2, 0] - q[:, 1, 0]) * (sy - q[:, 2, 1])) / den
    w1 = ((q[:, 2, 1] - q[:, 0, 1]) * (sx - q[:, 2, 0]) + (q[:, 0, 0] - q[:, 2, 0]) * (sy - q[:, 2, 1])) / den
    bw = np.stack([w0, w1, 1 - w0 - w1], 1)
    uvf = (UV[F[t]] * bw[..., None]).sum(1)
    img = np.zeros_like(ref)
    img[py, px] = image[np.clip((uvf[:, 1] * AH).astype(int), 0, AH - 1), np.clip((uvf[:, 0] * AW).astype(int), 0, AW - 1)]
    return depth, sil, img


# ---- feathered face ellipse from the eye and chin rows
Dfc = chin_row - eye_row
hx, e_size, e_shift, e_feather = map(float, args.ellipse.split(','))
top = eye_row - 0.5 * Dfc
face_rows = mask_bool[int(eye_row)]
face_cols = np.nonzero(face_rows)[0]
# the face centre on the eye row: the middle of the central foreground run (hands are separate runs)
runs = np.split(face_cols, np.nonzero(np.diff(face_cols) > 1)[0] + 1)
centre_run = min(runs, key=lambda r: abs(0.5 * (r[0] + r[-1]) - 0.5 * (xs.min() + xs.max())))
face_cx = 0.5 * (centre_run[0] + centre_run[-1])
ecy, ery, erx = 0.5 * (top + chin_row) + e_shift * Dfc, 0.5 * (chin_row - top) * e_size, hx * Dfc
gy, gx = np.mgrid[0:RH, 0:RW].astype(np.float64)
rr = np.sqrt(((gx - face_cx) / erx) ** 2 + ((gy - ecy) / ery) ** 2)
ellipse = np.clip((1.0 - rr) / e_feather, 0, 1)
ellipse = ellipse * ellipse * (3 - 2 * ellipse)


def estimate_flow(front_img, sil):
    inner = sil & mask_bool & (rr < 1.0)

    def prep(img):
        gimg = cv2.cvtColor((img * 255).astype(np.uint8), cv2.COLOR_RGB2GRAY)
        gimg = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8)).apply(gimg)
        gimg[~inner] = 0
        return gimg
    raw = cv2.DISOpticalFlow_create(cv2.DISOPTICAL_FLOW_PRESET_MEDIUM).calc(prep(front_img), prep(ref), None)
    m = (inner * ellipse).astype(np.float32)
    flow = np.zeros((RH, RW, 2), np.float32)
    den_ = cv2.GaussianBlur(m, (0, 0), args.flow_sigma)
    for c in range(2):
        flow[..., c] = cv2.GaussianBlur(raw[..., c] * m, (0, 0), args.flow_sigma) / np.maximum(den_, 1e-3)
    flow *= ellipse[..., None].astype(np.float32)
    mag = np.linalg.norm(flow, axis=2, keepdims=True)
    flow *= np.minimum(1.0, args.max_flow / np.maximum(mag, 1e-6))
    return flow, inner


depth, sil, before = front_render(albedo)
Image.fromarray((before * 255).astype(np.uint8)).save(out / 'front-before.jpg', quality=92)
flow, inner = estimate_flow(before, sil)
grid_x, grid_y = np.meshgrid(np.arange(RW, dtype=np.float32), np.arange(RH, dtype=np.float32))
ref_aligned = cv2.remap(ref.astype(np.float32), grid_x + flow[..., 0], grid_y + flow[..., 1], cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
mm = (sil & mask_bool).astype(np.float64)


def lowpass(img):
    num = cv2.GaussianBlur(img * mm[..., None], (0, 0), args.sigma)
    d = cv2.GaussianBlur(mm, (0, 0), args.sigma)[..., None]
    return num / np.maximum(d, 1e-4)


LUM = np.array([.2126, .7152, .0722])


def smooth(x, lo, hi):
    t = np.clip((x - lo) / (hi - lo), 0, 1)
    return t * t * (3 - 2 * t)


def skin_likeness(img):
    lum = img @ LUM
    sat = (img.max(-1) - img.min(-1)) / np.maximum(img.max(-1), 1e-3)
    warm = (img[..., 0] > img[..., 1]) & (img[..., 1] > img[..., 2])
    return smooth(lum, 0.40, 0.50) * smooth(sat, 0.15, 0.25) * (1 - smooth(sat, 0.62, 0.72)) * warm


tone = None
if args.tone_match:
    core = sil & mask_bool & (rr < 0.85)
    both = core & (skin_likeness(before) > 0.9) & (skin_likeness(ref_aligned) > 0.9)
    gain = np.median(before[both], axis=0) / np.maximum(np.median(ref_aligned[both], axis=0), 1e-3)
    tone = dict(gain=gain.round(4).tolist(), pixels=int(both.sum()))
    ref_aligned = ref_aligned * (1 + (gain - 1) * skin_likeness(ref_aligned)[..., None])
ref_hair = np.zeros((RH, RW))
if args.hair_guard:
    lum_r = ref_aligned @ LUM
    sat_r = (ref_aligned.max(-1) - ref_aligned.min(-1)) / np.maximum(ref_aligned.max(-1), 1e-3)
    brown = ((lum_r > 0.10) & (lum_r < 0.45) & (sat_r > 0.28) & (ref_aligned[..., 0] - ref_aligned[..., 2] > 0.08)).astype(np.uint8)
    brown = cv2.morphologyEx(brown, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    n_c, lab, st, _ = cv2.connectedComponentsWithStats(brown)
    big = np.zeros(n_c, bool)
    big[1:] = st[1:, cv2.CC_STAT_AREA] > 2500  # the hair mass; an eyebrow is a few hundred pixels
    ref_hair = cv2.GaussianBlur(cv2.dilate(big[lab].astype(np.uint8), np.ones((5, 5), np.uint8)).astype(np.float64), (0, 0), 1.5)
    Image.fromarray((ref_hair * 255).astype(np.uint8)).save(out / 'reference-hair.png')
if args.mode == 'detail':
    front_image = np.clip(lowpass(before) * ref_aligned / np.maximum(lowpass(ref_aligned), 1e-3), 0, 1)
else:
    front_image = np.clip(ref_aligned, 0, 1)
Image.fromarray((front_image * 255).astype(np.uint8)).save(out / 'front-after-source.jpg', quality=92)
overlay = (ref * 255).astype(np.uint8).copy()
overlay[cv2.Canny(sil.astype(np.uint8) * 255, 50, 150) > 0] = (255, 0, 0)
overlay[cv2.Canny(mask * 255, 50, 150) > 0] = (0, 255, 0)
overlay[np.abs(rr - 1.0) < 0.006] = (255, 255, 0)
Image.fromarray(overlay).save(out / 'overlay.jpg', quality=90)

# ---- atlas texels -> 3D point / normal
tri, bary = uv_raster(np.stack([UV[:, 0] * AW, UV[:, 1] * AH], axis=1), F, AW, AH)
covered = tri >= 0
ti = tri[covered]
bw = bary[covered]
pos = (P[F[ti]] * bw[..., None]).sum(1)
nrm = (N[F[ti]] * bw[..., None]).sum(1)
nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-12
u = cx + a * pos[:, 0]
v = cy - a * pos[:, 1]
inside = (u >= 0) & (u < RW - 1) & (v >= 0) & (v < RH - 1)
ui = np.clip(u.round().astype(int), 0, RW - 1)
vi = np.clip(v.round().astype(int), 0, RH - 1)
o_full, o_zero = map(float, args.occlusion.split(','))
# visibility averaged over a 5 x 5 pixel neighbourhood: a nearest-pixel test flickers along occluding edges (the
# fringe over the forehead) and leaves dotted lines in the atlas
vis = np.zeros(len(pos))
for dy in (-2, -1, 0, 1, 2):
    for dx in (-2, -1, 0, 1, 2):
        d = depth[np.clip(vi + dy, 0, RH - 1), np.clip(ui + dx, 0, RW - 1)]
        vis += np.clip((o_zero - (d - pos[:, 2])) / (o_zero - o_full), 0, 1)
vis /= 25
f0, f1 = map(float, args.facing.split(','))
fac = np.clip((nrm[:, 2] - f0) / (f1 - f0), 0, 1)
fac = fac * fac * (3 - 2 * fac)
eroded = cv2.erode(mask, np.ones((5, 5), np.uint8)).astype(bool)
weight = fac * vis * inside * eroded[vi, ui] * ellipse[vi, ui]


def bilinear(image, x, y):
    x = np.clip(x, 0, image.shape[1] - 1.001)
    y = np.clip(y, 0, image.shape[0] - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    dx = (x - x0)[:, None]
    dy = (y - y0)[:, None]
    return (image[y0, x0] * (1 - dx) * (1 - dy) + image[y0, x0 + 1] * dx * (1 - dy)
            + image[y0 + 1, x0] * (1 - dx) * dy + image[y0 + 1, x0 + 1] * dx * dy)


if args.hair_guard:
    own = albedo[covered]
    lum_o = own @ LUM
    # dark-brown hair of the reconstruction (its black eyebrows and eye lines are darker and are replaced)
    hair_o = smooth(lum_o, 0.05, 0.08) * (1 - smooth(lum_o, 0.30, 0.38)) * smooth(own[:, 0] - own[:, 2], 0.04, 0.08)
    weight = weight * (1 - hair_o) * (1 - bilinear(ref_hair[..., None], u - 0.5, v - 0.5)[:, 0])

refc = bilinear(front_image, u - 0.5, v - 0.5)
src = albedo[covered]
result = albedo.copy()
result[covered] = src * (1 - weight[:, None]) + refc * weight[:, None]
result, _ = dilate(result, covered, 8)
wimg = np.zeros((AH, AW))
wimg[covered] = weight
albedo_u8 = (np.clip(result, 0, 1) * 255 + .5).astype(np.uint8)
Image.fromarray(albedo_u8).save(out / 'albedo.png')
Image.fromarray((wimg * 255).astype(np.uint8)).save(out / 'weight.png')
_, _, after = front_render(albedo_u8.astype(np.float64) / 255.0)
Image.fromarray((after * 255).astype(np.uint8)).save(out / 'front-after.jpg', quality=92)

# ---- the processed GLB with only the base colour image replaced (lossless WebP, same texture/sampler)
def webp(array):
    buffer = io.BytesIO()
    if args.webp_quality:
        Image.fromarray(array).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
    else:
        Image.fromarray(array).save(buffer, 'WEBP', lossless=True, quality=100, method=6)
    return buffer.getvalue()


def downsample(array, normal=False):
    size = args.output_size
    if not size or array.shape[0] <= size:
        return array
    out = cv2.resize(array.astype(np.float32) / 255.0, (size, size), interpolation=cv2.INTER_AREA)
    if normal:  # box filter, then renormalise the vectors
        vec = out * 2 - 1
        vec /= np.linalg.norm(vec, axis=-1, keepdims=True) + 1e-12
        out = vec * 0.5 + 0.5
    return (np.clip(out, 0, 1) * 255 + .5).astype(np.uint8)


delivered_albedo = downsample(albedo_u8)
Image.fromarray(delivered_albedo).save(out / 'albedo-delivered.png')
replaced = {g.doc['images'][base_image]['bufferView']: webp(delivered_albedo)}
normal_report = None
if args.flat_normals > 0 and 'normalTexture' in mat:
    normal_image = g.texture_image(mat['normalTexture']['index'])
    nmap = np.asarray(Image.open(io.BytesIO(g.image_bytes(normal_image))).convert('RGB'), dtype=np.float64) / 255.0
    nvec = nmap * 2 - 1
    flat_img = wimg
    if args.flat_regions:
        region = np.zeros(len(u))
        for spec in args.flat_regions.split(';'):
            ru, rv, rx, ry = map(float, spec.split(','))
            t = np.clip((1 - np.sqrt(((u - ru) / rx) ** 2 + ((v - rv) / ry) ** 2)) / 0.35, 0, 1)
            region = np.maximum(region, t * t * (3 - 2 * t))
        flat_img = np.zeros((AH, AW))
        flat_img[covered] = region * vis * inside * fac
        flat_img = dilate(flat_img[..., None], covered, 4)[0][..., 0]
    w_n = flat_img if nmap.shape[:2] == (AH, AW) else cv2.resize(flat_img, (nmap.shape[1], nmap.shape[0]), interpolation=cv2.INTER_AREA)
    flat_w = np.clip(w_n * args.flat_normals, 0, 1)[..., None]
    nvec = nvec * (1 - flat_w) + np.array([0.0, 0.0, 1.0]) * flat_w
    nvec /= np.linalg.norm(nvec, axis=-1, keepdims=True) + 1e-12
    normal_u8 = (np.clip(nvec * 0.5 + 0.5, 0, 1) * 255 + .5).astype(np.uint8)
    Image.fromarray(normal_u8).save(out / 'normal.png')
    replaced[g.doc['images'][normal_image]['bufferView']] = webp(downsample(normal_u8, normal=True))
    normal_report = dict(strength=args.flat_normals, regions=args.flat_regions or 'projection weight', texels=int((flat_w[..., 0] > 0.01).sum()))
elif args.output_size and 'normalTexture' in mat:
    normal_image = g.texture_image(mat['normalTexture']['index'])
    nmap_u8 = np.asarray(Image.open(io.BytesIO(g.image_bytes(normal_image))).convert('RGB'))
    replaced[g.doc['images'][normal_image]['bufferView']] = webp(downsample(nmap_u8, normal=True))
b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    b.add_view(replaced.get(i, g.view_bytes(i)), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
for image in b.doc['images']:
    if image['bufferView'] in replaced:
        image['mimeType'] = 'image/webp'
b.write(out / 'face.glb')

sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
face_texels = (wimg > 0.5).sum()
report = dict(
    author='Claude Code (Opus 5.5)', script='scripts/remake/project_face.py',
    source=args.glb, sourceSha256=sha(args.glb), reference=args.reference, referenceSha256=sha(args.reference),
    output=str(out / 'face.glb'), outputSha256=sha(out / 'face.glb'),
    registration=dict(scalePixelsPerMetre=float(a), cx=float(cx), cy=float(cy), given=bool(args.registration),
                      silhouetteIoU=None if best_iou is None else float(best_iou), initialIoU=None if initial_iou is None else float(initial_iou)),
    landmarks=dict(eyeRow=eye_row, chinRow=chin_row, faceEllipse=dict(cx=face_cx, cy=ecy, rx=erx, ry=ery, feather=e_feather)),
    alignmentFlowMeanPx=float(np.linalg.norm(flow, axis=2)[inner].mean()) if inner.any() else 0.0,
    alignmentFlowMaxPx=float(np.linalg.norm(flow, axis=2).max()),
    projectedTexels=int((weight > 0.01).sum()), fullTexels=int((weight > 0.99).sum()), coveredTexels=int(covered.sum()),
    faceTexelsOverHalfWeight=int(face_texels), atlas=[AW, AH], outputSize=args.output_size or AW, mode=args.mode, sigma=args.sigma, toneMatch=tone, hairGuard=args.hair_guard, flatNormals=normal_report,
    facing=[f0, f1], occlusion=[o_full, o_zero], geometry='unchanged (only the base colour and normal images are replaced)')
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print('PROJECT_FACE_DONE', json.dumps(dict(registration=report['registration'], flow=report['alignmentFlowMeanPx'],
                                           projected=report['projectedTexels'], full=report['fullTexels'])))
