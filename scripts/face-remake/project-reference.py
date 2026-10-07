"""Fit a TRELLIS head to its generated front reference and project the reference onto the head's texture atlas.

python scripts/face-remake/project-reference.py <dense.glb> <reference.png> <outdir> --landmarks EYE_ROW,CHIN_ROW
    [--warp 1] [--mode detail] [--sigma 28] [--atlas 2048]

TRELLIS-2 reconstructs the head well from the single front image, but (a) its own albedo (512 texture field) is soft
and (b) the facial features of the rebuilt surface drift a few millimetres from the reference (eyes higher, face a little
wider/shorter). The reference itself is a sharp, evenly lit front view of the intended face, so:
  1. Registration: the reference foreground mask (plain grey background) is matched to the orthographic front
     silhouette of the reconstruction (glTF +Z forward, +Y up) by a uniform scale and a 2D offset, maximising IoU.
  2. Feature fit (--warp 1): optical flow between the reconstruction's own albedo seen from the reference camera and the
     reference, restricted to a feathered face ellipse from the eye/chin rows, gives where each facial feature should
     be. Front-facing face vertices slide sideways/up-down by that flow (a few mm; silhouette, ears, hair and the back
     of the head stay put), two iterations. Normals receive only the change caused by the slide. -> warped.glb
  3. Projection: every atlas texel is rasterised in UV space to its 3D point and normal; front-facing, front-visible
     texels take the reference, fading out with the angle to the view and with occlusion depth. In --mode detail the
     reference contributes only detail finer than --sigma pixels on top of the reconstruction's own low-frequency colour
     (no double shadows, no colour seam where the projection fades out).
Outputs warped.glb (if --warp), albedo.png, weight.png, overlay.jpg, trellis-front*.jpg, front-combined.jpg, report.json.
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

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glbio import Builder, Glb  # noqa: E402
import meshops  # noqa: E402
from raster import depth_buffer, dilate, uv_raster  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('dense')
ap.add_argument('reference')
ap.add_argument('outdir')
ap.add_argument('--landmarks', required=True, help='eye row,chin row in reference pixels')
ap.add_argument('--atlas', type=int, default=2048)
ap.add_argument('--facing', default='0.3,0.6', help='normal.z ramp (start,full) for the projection weight')
ap.add_argument('--occlusion', default='0.004,0.012', help='depth gap ramp (full,zero) in mesh units')
ap.add_argument('--mode', default='detail', choices=['detail', 'replace'])
ap.add_argument('--sigma', type=float, default=28.0, help='detail mode low-pass radius (reference pixels)')
ap.add_argument('--warp', type=int, default=1)
ap.add_argument('--match-colour', type=float, default=0.0, help='0..1: move the reconstruction albedo toward the reference colours (affine fit on the face)')
ap.add_argument('--max-flow', type=float, default=45.0)
ap.add_argument('--flow-sigma', type=float, default=20.0)
ap.add_argument('--ellipse', default='1.14,0.06,0.3', help='vertical size factor, downward shift (x eye-chin), feather')
args = ap.parse_args()
out = Path(args.outdir)
out.mkdir(parents=True, exist_ok=True)

g = Glb(args.dense)
prim = g.doc['meshes'][0]['primitives'][0]
P0 = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
N0 = g.accessor(prim['attributes']['NORMAL']).astype(np.float64)
UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)
mat = g.doc['materials'][prim['material']]
albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'),
                    dtype=np.float64) / 255.0
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
mask_bool = mask.astype(bool)

# ---- registration: u = cx + a * x, v = cy - a * y
ys, xs = np.nonzero(mask_bool)
a0 = 0.5 * ((ys.max() - ys.min()) / np.ptp(P0[:, 1]) + (xs.max() - xs.min()) / np.ptp(P0[:, 0]))
cx0 = 0.5 * (xs.max() + xs.min()) - a0 * 0.5 * (P0[:, 0].max() + P0[:, 0].min())
cy0 = 0.5 * (ys.max() + ys.min()) + a0 * 0.5 * (P0[:, 1].max() + P0[:, 1].min())
S = 384
k = S / RW
small = cv2.resize(mask, (S, int(RH * k)), interpolation=cv2.INTER_AREA) > 0


def iou(params):
    a_, cx_, cy_ = params
    xy = np.stack([(cx_ + a_ * P0[:, 0]) * k, (cy_ - a_ * P0[:, 1]) * k], axis=1)
    sil = depth_buffer(xy, P0[:, 2], F, small.shape[1], small.shape[0])[0] > -1e8
    return (sil & small).sum() / max((sil | small).sum(), 1)


best = np.array([a0, cx0, cy0])
best_iou = initial_iou = iou(best)
steps = np.array([a0 * 0.02, 6.0, 6.0])
for _ in range(60):
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


def front_render(P):
    """Depth, triangle ids and the reconstruction's own unlit albedo seen from the reference camera."""
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
    AH, AW = albedo.shape[:2]
    img = np.zeros_like(ref)
    img[py, px] = albedo[np.clip((uvf[:, 1] * AH).astype(int), 0, AH - 1), np.clip((uvf[:, 0] * AW).astype(int), 0, AW - 1)]
    return depth, sil, img


# ---- feathered face ellipse from the eye and chin rows (hair and outline excluded from the fit)
Dfc = chin_row - eye_row
face_cx = 0.5 * (xs.min() + xs.max())
top = eye_row - 0.5 * Dfc
# the falloff reaches a little below the chin so the jaw underside is not creased by the slide
e_size, e_shift, e_feather = map(float, args.ellipse.split(','))
ecy, ery, erx = 0.5 * (top + chin_row) + e_shift * Dfc, 0.5 * (chin_row - top) * e_size, 0.62 * Dfc
gy, gx = np.mgrid[0:RH, 0:RW].astype(np.float64)
rr = np.sqrt(((gx - face_cx) / erx) ** 2 + ((gy - ecy) / ery) ** 2)
ellipse = np.clip((1.0 - rr) / e_feather, 0, 1)
ellipse = ellipse * ellipse * (3 - 2 * ellipse)


def estimate_flow(front_img, sil):
    inner = (sil & mask_bool & (rr < 1.0))
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


def vertex_normals(P):
    wid = meshops.weld_ids(P0)
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    acc = np.zeros((wid.max() + 1, 3))
    for c in range(3):
        np.add.at(acc, wid[F[:, c]], fn)
    n = acc[wid]
    return n / (np.linalg.norm(n, axis=1, keepdims=True) + 1e-12)


P = P0.copy()
N = N0.copy()
depth, sil, trellis_front = front_render(P)
colour_fit = None
if args.match_colour > 0:
    # affine colour map reconstruction -> reference fitted on the face (inside the face ellipse, both images valid)
    m_ = sil & mask_bool & (rr < 0.8)
    X = np.c_[trellis_front[m_], np.ones(m_.sum())]
    M_, *_ = np.linalg.lstsq(X, ref[m_], rcond=None)
    # skin only: dark texels (hair, brows, beard) keep their colour so the hair stays hair
    lum_a = albedo @ np.array([.2126, .7152, .0722])
    w_a = (np.clip((lum_a - 0.12) / 0.10, 0, 1) * args.match_colour)[..., None]
    mapped = np.clip(np.c_[albedo.reshape(-1, 3), np.ones(albedo.size // 3)] @ M_, 0, 1).reshape(albedo.shape)
    albedo = np.clip(albedo * (1 - w_a) + mapped * w_a, 0, 1)
    colour_fit = M_.round(4).tolist()
    depth, sil, trellis_front = front_render(P)
Image.fromarray((trellis_front * 255).astype(np.uint8)).save(out / 'trellis-front-before.jpg', quality=90)
warp_log = []
if args.warp:
    n_rc0 = vertex_normals(P0)
    for it in range(2):
        flow, inner = estimate_flow(trellis_front, sil)
        u = cx + a * P[:, 0]
        v = cy - a * P[:, 1]
        ui = np.clip(u.round().astype(int), 0, RW - 1)
        vi = np.clip(v.round().astype(int), 0, RH - 1)
        # smooth weights only (no per-vertex facing/visibility jumps that would fold the surface): the face ellipse
        # in the image and a front-depth ramp so the back of the head and the ears never move
        zf = depth[vi, ui]
        zr = np.clip((P[:, 2] - (zf - 0.16)) / 0.08, 0, 1)
        zr = zr * zr * (3 - 2 * zr)
        wv = zr * ellipse[vi, ui]
        dx = flow[vi, ui, 0] * wv
        dy = flow[vi, ui, 1] * wv
        P[:, 0] += dx / a
        P[:, 1] -= dy / a
        N = N0 + (vertex_normals(P) - n_rc0)
        N /= np.linalg.norm(N, axis=1, keepdims=True) + 1e-12
        warp_log.append(dict(iteration=it, maxShiftPx=float(np.hypot(dx, dy).max()), movedVertices=int((np.hypot(dx, dy) > 0.25).sum()),
                             maxShiftUnits=float(np.hypot(dx, dy).max() / a)))
        depth, sil, trellis_front = front_render(P)
    b = Builder(g.doc)
    for i, vdef in enumerate(g.doc['bufferViews']):
        b.add_view(g.view_bytes(i), vdef.get('target'))
        if 'byteStride' in vdef:
            b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
    pa = b.add_accessor(P.astype(np.float32), 5126, 'VEC3', 34962, minmax=True)
    na = b.add_accessor(N.astype(np.float32), 5126, 'VEC3', 34962)
    b.doc['meshes'][0]['primitives'][0]['attributes']['POSITION'] = pa
    b.doc['meshes'][0]['primitives'][0]['attributes']['NORMAL'] = na
    b.write(out / 'warped.glb')
Image.fromarray((trellis_front * 255).astype(np.uint8)).save(out / 'trellis-front.jpg', quality=90)
residual, inner = estimate_flow(trellis_front, sil)
grid_x, grid_y = np.meshgrid(np.arange(RW, dtype=np.float32), np.arange(RH, dtype=np.float32))
ref_aligned = cv2.remap(ref.astype(np.float32), grid_x + residual[..., 0], grid_y + residual[..., 1], cv2.INTER_LINEAR,
                        borderMode=cv2.BORDER_REPLICATE).astype(np.float64)
mm = (sil & mask_bool).astype(np.float64)


def lowpass(img):
    num = cv2.GaussianBlur(img * mm[..., None], (0, 0), args.sigma)
    d = cv2.GaussianBlur(mm, (0, 0), args.sigma)[..., None]
    return num / np.maximum(d, 1e-4)


if args.mode == 'detail':
    front_image = np.clip(lowpass(trellis_front) * ref_aligned / np.maximum(lowpass(ref_aligned), 1e-3), 0, 1)
else:
    front_image = ref_aligned
Image.fromarray((front_image * 255).astype(np.uint8)).save(out / 'front-combined.jpg', quality=92)
overlay = (ref * 255).astype(np.uint8).copy()
overlay[cv2.Canny(sil.astype(np.uint8) * 255, 50, 150) > 0] = (255, 0, 0)
overlay[cv2.Canny(mask * 255, 50, 150) > 0] = (0, 255, 0)
overlay[np.abs(rr - 1.0) < 0.004] = (255, 255, 0)
Image.fromarray(overlay).save(out / 'overlay.jpg', quality=90)

# ---- atlas texels -> 3D point / normal (on the fitted surface)
A = args.atlas
if albedo.shape[0] != A:
    albedo = np.asarray(Image.fromarray((albedo * 255).astype(np.uint8)).resize((A, A), Image.LANCZOS), dtype=np.float64) / 255.0
tri, bary = uv_raster(np.stack([UV[:, 0] * A, UV[:, 1] * A], axis=1), F, A, A)
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
vis = np.clip((o_zero - (depth[vi, ui] - pos[:, 2])) / (o_zero - o_full), 0, 1)
f0, f1 = map(float, args.facing.split(','))
fac = np.clip((nrm[:, 2] - f0) / (f1 - f0), 0, 1)
fac = fac * fac * (3 - 2 * fac)
eroded = cv2.erode(mask, np.ones((7, 7), np.uint8)).astype(bool)
weight = fac * vis * inside * eroded[vi, ui]


def bilinear(image, x, y):
    x = np.clip(x, 0, image.shape[1] - 1.001)
    y = np.clip(y, 0, image.shape[0] - 1.001)
    x0 = np.floor(x).astype(int)
    y0 = np.floor(y).astype(int)
    dx = (x - x0)[:, None]
    dy = (y - y0)[:, None]
    return (image[y0, x0] * (1 - dx) * (1 - dy) + image[y0, x0 + 1] * dx * (1 - dy)
            + image[y0 + 1, x0] * (1 - dx) * dy + image[y0 + 1, x0 + 1] * dx * dy)


refc = bilinear(front_image, u - 0.5, v - 0.5)
src = albedo[covered]
blend = src * (1 - weight[:, None]) + refc * weight[:, None]
result = albedo.copy()
result[covered] = blend
result, _ = dilate(result, covered, 8)
wimg = np.zeros((A, A))
wimg[covered] = weight
Image.fromarray((np.clip(result, 0, 1) * 255 + .5).astype(np.uint8)).save(out / 'albedo.png')
Image.fromarray((wimg * 255).astype(np.uint8)).save(out / 'weight.png')
report = dict(
    dense=args.dense, denseSha256=hashlib.sha256(Path(args.dense).read_bytes()).hexdigest(),
    reference=args.reference, referenceSha256=hashlib.sha256(Path(args.reference).read_bytes()).hexdigest(),
    registration=dict(scalePixelsPerUnit=float(a), cx=float(cx), cy=float(cy), silhouetteIoU=float(best_iou), initialIoU=float(initial_iou)),
    landmarks=dict(eyeRow=eye_row, chinRow=chin_row, faceEllipse=dict(cx=face_cx, cy=ecy, rx=erx, ry=ery)),
    warp=warp_log, warpedGlb=str(out / 'warped.glb') if args.warp else None,
    residualFlowMeanPx=float(np.linalg.norm(residual, axis=2)[inner].mean()) if inner.any() else 0.0,
    projectedTexels=int((weight > 0.01).sum()), fullTexels=int((weight > 0.99).sum()), coveredTexels=int(covered.sum()),
    mode=args.mode, sigma=args.sigma, matchColour=args.match_colour, colourFit=colour_fit, facing=[f0, f1], occlusion=[o_full, o_zero], atlas=A)
(out / 'report.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(dict(registration=report['registration'], warp=warp_log, residual=report['residualFlowMeanPx'])))
