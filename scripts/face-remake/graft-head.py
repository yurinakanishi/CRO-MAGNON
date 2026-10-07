"""Replace a delivered humanoid's head primitive with a new TRELLIS head (2026-10-07 face remake).

python scripts/face-remake/graft-head.py --key neanderthal-woman --dense <dense.glb> --projection <dir with albedo.png,report.json>
    --landmarks EYE_ROW,CHIN_ROW --target EYE_Y,CHIN_Y --jaw "z:y,..." --out <dir> [--budget 34000] [--lod-budget 5000]
    [--gap .006] [--tone .25] [--neck-blend .06]

* Placement: uniform scale and translation only. Eye and chin rows of the reference (pixels) map through the
  projection's registration to the head's own units; scale and height put them at the old face's eye and chin heights;
  x/z put the new neck's cross-section centre on the body's neck-ring centre.
* Cut: the head is clipped exactly by the body neck-ring plane raised by --gap; floaters are dropped.
* Reduction: meshoptimizer with normal/UV attributes; the cut border is locked. Vertices remain a subset of the
  reconstruction with their exact normals and atlas UVs.
* Seam: a zipper strip joins the cut loop to the body ring. Its lower vertices are copies of the body-ring vertices
  (position, normal and skin weights byte-for-byte equal), so the seam is closed and moves with the body.
* Skin weights: above the jaw curve (+ blend) every vertex is 100% Head (no face shearing in Walk/Run). Down the neck
  the weights go Head -> Neck -> the body-ring weights at the seam.
* Texture: the projected albedo; neck skin near the seam is tinted toward the body's ring skin colour (fading out
  upward), and the whole head gets --tone of that correction so face and body skin agree.
* Output: model.glb and lod.glb rebuilt from the delivered files with only the head primitive (accessors) and the
  head material's textures replaced; every other accessor, image, skin, node and animation keeps identical bytes.
"""
import argparse
import hashlib
import io
import json
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import meshops  # noqa: E402
from glbio import Builder, Glb  # noqa: E402
from raster import dilate, uv_raster  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True)
ap.add_argument('--model', default='')
ap.add_argument('--lod', default='')
ap.add_argument('--dense', required=True)
ap.add_argument('--projection', required=True)
ap.add_argument('--landmarks', required=True, help='eye row,chin row in reference pixels')
ap.add_argument('--target', required=True, help='eye y,chin y in model metres')
ap.add_argument('--jaw', required=True, help='z:y,... jaw curve (model space) above which the head is rigid')
ap.add_argument('--out', required=True)
ap.add_argument('--budget', type=int, default=34000)
ap.add_argument('--lod-budget', type=int, default=5000)
ap.add_argument('--gap', type=float, default=.006)
ap.add_argument('--tone', type=float, default=.25)
ap.add_argument('--neck-tint', type=float, default=.05, help='height (m) over which the seam tint fades out')
ap.add_argument('--blend', type=float, default=.025, help='jaw blend height (m)')
ap.add_argument('--offset', default='0,0,0', help='extra x,y,z translation (m) after the automatic placement')
ap.add_argument('--scale-mul', type=float, default=1.0)
ap.add_argument('--head-prim', type=int, default=1)
ap.add_argument('--error', type=float, default=.02)
ap.add_argument('--debug', action='store_true')
ap.add_argument('--dump-placed', action='store_true', help='write placed.glb (uncut head + delivered body, no skin) and stop')
ap.add_argument('--keep-ring-normals', action='store_true', help='leave the body ring normals untouched')
ap.add_argument('--hair-error', type=float, default=.03)
ap.add_argument('--hair-budget', type=int, default=20000)
ap.add_argument('--attach', default='ring', choices=['ring', 'overlap'],
                help='ring: zip the neck to the body neck ring; overlap: extend the neck down inside a collar (no clean ring)')
ap.add_argument('--cut-y', type=float, default=None, help='overlap: height of the head cut (m)')
ap.add_argument('--remove-body', default='', help='ymin,radius[,skin]: drop body faces above ymin within radius of the neck axis (hidden shards)')
ap.add_argument('--no-cut', action='store_true', help='keep the whole reconstructed neck (overlap into a collar), no seam or sleeve')
ap.add_argument('--remove-body-hair', default='', help='ymin,zmax: drop dark hair-coloured body faces above ymin behind zmax (a braid left from the old head)')
ap.add_argument('--hair-match-body', default='', help='ymin,zmax: grade the head hair toward the dark hair colour found on the body there (e.g. a kept braid)')
ap.add_argument('--nose-z', type=float, default=None, help='align the nose tip at this depth (m) instead of centring the neck')
ap.add_argument('--extend', type=float, default=0.04, help='overlap: how far the neck sleeve extends below the cut (m)')
ap.add_argument('--cut-shape', default='flat', choices=['flat', 'rim'], help='flat: one level just above the highest rim point; rim: follow the rim per angle')
ap.add_argument('--rim-margin', type=float, default=0.015, help='cut this far above the reconstruction rim (drops the bust flare)')
ap.add_argument('--taper', type=float, default=0.0, help='height (m) over which the neck tapers to the body ring radius')
args = ap.parse_args()
out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
model_path = args.model or f'public/models/{args.key}/model-c2.glb'
lod_path = args.lod or f'public/models/{args.key}/lod-c2.glb'
sha = lambda b: hashlib.sha256(b).hexdigest()  # noqa: E731
report = dict(key=args.key, model=model_path, modelSha256=sha(Path(model_path).read_bytes()), lod=lod_path,
              lodSha256=sha(Path(lod_path).read_bytes()), dense=args.dense, denseSha256=sha(Path(args.dense).read_bytes()),
              args=vars(args))

# ---------------------------------------------------------------- delivered model
G = Glb(model_path)
mesh = G.doc['meshes'][0]
skin = G.doc['skins'][next(n['skin'] for n in G.doc['nodes'] if 'skin' in n)]
names = [G.doc['nodes'][j].get('name', '') for j in skin['joints']]
HEAD, NECK = names.index('Head'), names.index('Neck')
body = mesh['primitives'][0]
BP = G.accessor(body['attributes']['POSITION']).astype(np.float64)
BN = G.accessor(body['attributes']['NORMAL']).astype(np.float64)
BUV = G.accessor(body['attributes']['TEXCOORD_0']).astype(np.float64)
BJ = G.accessor(body['attributes']['JOINTS_0'], normalise=False).astype(np.int64)
BW = G.accessor(body['attributes']['WEIGHTS_0']).astype(np.float64)
BF = G.accessor(body['indices']).reshape(-1, 3).astype(np.int64)
BF_kept = None
if args.remove_body:
    parts = args.remove_body.split(',')
    ymin_, rad_ = float(parts[0]), float(parts[1])
    bimg_ = np.asarray(Image.open(io.BytesIO(G.image_bytes(G.texture_image(G.doc['materials'][body['material']]['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'), dtype=np.float64) / 255.0
    fuv_ = BUV[BF].mean(1)
    col_ = bimg_[np.clip((fuv_[:, 1] * bimg_.shape[0]).astype(int), 0, bimg_.shape[0] - 1), np.clip((fuv_[:, 0] * bimg_.shape[1]).astype(int), 0, bimg_.shape[1] - 1)]
    skin_ = (col_[:, 0] > 0.42) & (col_[:, 0] - col_[:, 2] > 0.18) & (col_[:, 0] > col_[:, 1])
    fc_ = BP[BF].mean(1)
    OHc = G.accessor(mesh['primitives'][args.head_prim]['attributes']['POSITION'])
    ax_ = np.median(OHc[OHc[:, 1] < np.percentile(OHc[:, 1], 10)][:, [0, 2]], 0)
    zone_ = (fc_[:, 1] > ymin_) & (np.hypot(fc_[:, 0] - ax_[0], fc_[:, 2] - ax_[1]) < rad_)
    if len(parts) > 2 and parts[2] == 'skin':
        zone_ &= skin_
    BF_kept = BF[~zone_]
    report['bodyFacesRemoved'] = dict(count=int(zone_.sum()), ymin=ymin_, radius=rad_, skinOnly=len(parts) > 2, axis=ax_.tolist())
    print('body faces removed', int(zone_.sum()))
if args.remove_body_hair:
    ymin_h, zmax_h = map(float, args.remove_body_hair.split(','))
    bimg_h = np.asarray(Image.open(io.BytesIO(G.image_bytes(G.texture_image(G.doc['materials'][body['material']]['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'), dtype=np.float64) / 255.0
    fuv_h = BUV[BF].mean(1)
    col_h = bimg_h[np.clip((fuv_h[:, 1] * bimg_h.shape[0]).astype(int), 0, bimg_h.shape[0] - 1), np.clip((fuv_h[:, 0] * bimg_h.shape[1]).astype(int), 0, bimg_h.shape[1] - 1)]
    fc_h = BP[BF].mean(1)
    hairish = (col_h @ np.array([.2126, .7152, .0722]) < 0.24) & (fc_h[:, 1] > ymin_h) & (fc_h[:, 2] < zmax_h) & (np.abs(fc_h[:, 0]) < 0.12)
    base_faces = BF if BF_kept is None else BF_kept
    keep_h = ~(np.isin(np.arange(len(BF)), np.nonzero(hairish)[0]))
    BF_kept = BF[keep_h] if BF_kept is None else BF_kept[~np.isin(np.arange(len(BF_kept)), [])]
    report['bodyHairFacesRemoved'] = dict(count=int(hairish.sum()), ymin=ymin_h, zmax=zmax_h)
    print('body hair faces removed', int(hairish.sum()))
old_head = mesh['primitives'][args.head_prim]
OH = G.accessor(old_head['attributes']['POSITION']).astype(np.float64)
low = OH[OH[:, 1] < np.percentile(OH[:, 1], 10)]
ring = meshops.find_neck_ring(BP, BF, (float(np.median(low[:, 0])), float(np.median(low[:, 2]))), (1.0, 1.9))
if ring is None:
    raise SystemExit('no neck ring on the body primitive')
RP = BP[ring]
rc, rn = meshops.fit_plane(RP)
if args.attach == 'overlap':
    # an irregular collar edge: only its centre is used (neck axis); the frame is horizontal at the cut height
    rc = np.array([RP[:, 0].mean(), args.cut_y, RP[:, 2].mean()])
    rn = np.array([0.0, 1.0, 0.0])
rel = RP - rc
e1 = np.cross(rn, [0, 0, 1.0])
e1 /= np.linalg.norm(e1)
e2 = np.cross(rn, e1)


def angle(points):
    d = points - rc
    return np.arctan2(d @ e2, d @ e1)


ring_ang = angle(RP)
ring_r = np.linalg.norm(rel - np.outer(rel @ rn, rn), axis=1)
report['ring'] = dict(vertices=len(ring), centre=rc.round(5).tolist(), normal=rn.round(5).tolist(),
                      yRange=[float(RP[:, 1].min()), float(RP[:, 1].max())], meanRadius=float(ring_r.mean()))

# ---------------------------------------------------------------- reconstruction + placement
D = Glb(args.dense)
dp = D.doc['meshes'][0]['primitives'][0]
DP = D.accessor(dp['attributes']['POSITION']).astype(np.float64)
DN = D.accessor(dp['attributes']['NORMAL']).astype(np.float64)
DUV = D.accessor(dp['attributes']['TEXCOORD_0']).astype(np.float64)
DF = D.accessor(dp['indices']).reshape(-1, 3).astype(np.int64)
proj = json.loads((Path(args.projection) / 'report.json').read_text())['registration']
a, cx, cy = proj['scalePixelsPerUnit'], proj['cx'], proj['cy']
eye_row, chin_row = map(float, args.landmarks.split(','))
eye_t, chin_t = map(float, args.target.split(','))
ye, yc = (cy - eye_row) / a, (cy - chin_row) / a
s = (eye_t - chin_t) / (ye - yc) * args.scale_mul
ty = eye_t - s * ye
P1 = DP * s
P1[:, 1] += ty
# ---- horizontal placement: centre the neck on the body ring (or align the nose depth, for heads that overlap a collar)
cut_c = rc + rn * 0.03
total_shift = np.zeros(3)
for _ in range(0 if args.nose_z is not None else 3):
    sd = (P1 - cut_c) @ rn
    band = P1[np.abs(sd) < 0.004]
    band = band[np.linalg.norm(band[:, [0, 2]] - np.median(band[:, [0, 2]], 0), axis=1) < 0.09]
    shift = (rc - band.mean(0))
    shift -= rn * (shift @ rn)
    shift *= np.array([1, 0, 1])
    P1 += shift
    total_shift += shift
if args.nose_z is not None:
    mid_x = 0.5 * (P1[:, 0].max() + P1[:, 0].min())
    nose_band = (np.abs(P1[:, 0] - mid_x) < 0.015) & (P1[:, 1] > eye_t - 0.06) & (P1[:, 1] < eye_t - 0.02)
    shift = np.array([rc[0] - mid_x, 0.0, args.nose_z - P1[nose_band, 2].max()])
    P1 += shift
    total_shift += shift
off = np.array([float(x) for x in args.offset.split(',')])
P1 += off
if args.attach == 'overlap':
    # the collar edge is not a usable ring: the neck axis is the centre of the head's own neck section at --cut-y
    sec = P1[np.abs(P1[:, 1] - args.cut_y) < 0.003]
    rc = np.array([0.5 * (sec[:, 0].min() + sec[:, 0].max()), args.cut_y, 0.5 * (sec[:, 2].min() + sec[:, 2].max())])
    ring_r = np.full_like(ring_r, float(np.median(np.linalg.norm(sec[:, [0, 2]] - rc[[0, 2]], axis=1))))

# ---- cut surface. TRELLIS ends the neck in a saddle-shaped bust cut (front and back lower than the sides), often with a
# thin double wall at the rim. The head is cut along a surface that follows that rim 4 mm above it, per angle around the
# neck axis, so the cut loop is always a closed neck loop and no throat or beard is lost. Ring mode keeps it >= --gap
# above the body ring.
NB = 72


def frame(P):
    rel_ = P - rc
    h_ = rel_ @ rn
    rad_ = rel_ - np.outer(h_, rn)
    return h_, np.linalg.norm(rad_, axis=1), np.arctan2(rad_ @ e2, rad_ @ e1)


hp, rr_, angp = frame(P1)
ref_r = float(ring_r.mean())
band_r = (rr_ > 0.6 * ref_r) & (rr_ < 1.6 * ref_r) & (hp < 0.10)
bins = np.floor((angp + np.pi) / (2 * np.pi) * NB).astype(int) % NB
bottom = np.full(NB, np.nan)
for k_ in range(NB):
    m_ = band_r & (bins == k_)
    if m_.any():
        bottom[k_] = hp[m_].min()
good = ~np.isnan(bottom)
rim_raw_max = float(np.nanmax(bottom)) if good.any() else 0.0
if good.sum() < NB // 3:
    raise SystemExit('the neck rim was not found around the axis')
idx_ = np.arange(NB)
bottom = np.interp(idx_, np.r_[idx_[good] - NB, idx_[good], idx_[good] + NB], np.r_[bottom[good], bottom[good], bottom[good]])
bottom = np.max(np.stack([np.roll(bottom, k_) for k_ in (-2, -1, 0, 1, 2)]), axis=0)
bottom = np.mean(np.stack([np.roll(bottom, k_) for k_ in range(-3, 4)]), axis=0)
Hcut = bottom + args.rim_margin
if args.cut_shape == 'flat':
    Hcut = np.full(NB, rim_raw_max + 0.004)
if args.attach == 'ring':
    Hcut = np.maximum(Hcut, args.gap)
bin_ang = -np.pi + (idx_ + 0.5) * 2 * np.pi / NB


def cut_field(P):
    """Height of P above the cut surface (positive = kept)."""
    h_, _, a_ = frame(P)
    return h_ - np.interp(a_, np.r_[bin_ang - 2 * np.pi, bin_ang, bin_ang + 2 * np.pi], np.r_[Hcut, Hcut, Hcut])


offset_cut = float(Hcut.max())
cut_c = rc + rn * float(Hcut.mean())
cn = rn
sfield = cut_field(P1)
band = P1[(np.abs(sfield) < 0.004) & (rr_ < 1.6 * ref_r)]
neck_r = float(np.median(frame(band)[1])) if len(band) else ref_r
top_v = int(np.argmax(P1[:, 1]))
t_total = P1[top_v] - DP[top_v] * s
report['placement'] = dict(scale=float(s), translation=t_total.round(6).tolist(), eyeRow=eye_row, chinRow=chin_row,
                           eyeY=eye_t, chinY=chin_t, neckRadiusAtCut=neck_r, ringRadius=ref_r,
                           radiusRatio=neck_r / ref_r, extraOffset=off.tolist())
# taper the lower neck so its cross-section meets the body ring (necks of the new heads are a little wider)
ratio = ref_r / neck_r
if args.attach == 'ring' and args.taper > 0 and abs(ratio - 1) > 0.01:
    rel1 = P1 - rc
    h_above = rel1 @ rn
    radial = rel1 - np.outer(h_above, rn)
    near_axis = np.linalg.norm(radial, axis=1) < 1.6 * neck_r
    t = np.clip(sfield / args.taper, 0, 1)
    t = t * t * (3 - 2 * t)
    f = np.where(near_axis, ratio + (1 - ratio) * t, 1.0)
    P1 = rc + np.outer(h_above, rn) + radial * f[:, None]
report['placement']['neckTaper'] = dict(ratio=float(ratio), heightM=args.taper, applied=args.attach == 'ring')
report['placement']['cut'] = dict(shape=args.cut_shape, rimMarginM=args.rim_margin, minHeightAboveRingM=float(Hcut.min()),
                                  maxHeightAboveRingM=offset_cut, rimMinM=float(bottom.min()), rimMaxM=float(bottom.max()))
print('placement', json.dumps(report['placement']))

if args.dump_placed:
    dimg = D.image_bytes(D.texture_image(D.doc['materials'][dp['material']]['pbrMetallicRoughness']['baseColorTexture']['index']))
    bimg = G.image_bytes(G.texture_image(G.doc['materials'][body['material']]['pbrMetallicRoughness']['baseColorTexture']['index']))
    from PIL import Image as _I
    def png(b_):
        o_ = io.BytesIO(); _I.open(io.BytesIO(b_)).convert('RGB').save(o_, format='PNG'); return o_.getvalue()
    doc_ = {'asset': {'version': '2.0'}, 'scene': 0, 'scenes': [{'nodes': [0, 1]}], 'nodes': [{'mesh': 0}, {'mesh': 1}],
            'meshes': [], 'materials': [], 'textures': [], 'images': [], 'samplers': [{}], 'accessors': []}
    bb = Builder(doc_)
    for k_, (PP, NN, UU, FF, img) in enumerate([(P1, DN, DUV, DF, png(dimg)), (BP, BN, BUV, BF if BF_kept is None else BF_kept, png(bimg))]):
        bb.doc['images'].append({'mimeType': 'image/png', 'bufferView': bb.add_view(img)})
        bb.doc['textures'].append({'sampler': 0, 'source': k_})
        bb.doc['materials'].append({'pbrMetallicRoughness': {'baseColorTexture': {'index': k_}, 'metallicFactor': 0, 'roughnessFactor': .6}})
        bb.doc['meshes'].append({'primitives': [{'attributes': {
            'POSITION': bb.add_accessor(PP.astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
            'NORMAL': bb.add_accessor(NN.astype(np.float32), 5126, 'VEC3', 34962),
            'TEXCOORD_0': bb.add_accessor(UU.astype(np.float32), 5126, 'VEC2', 34962)},
            'indices': bb.add_accessor(FF.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963), 'material': k_}]})
    bb.write(out / 'placed.glb')
    raise SystemExit('dumped ' + str(out / 'placed.glb'))
# ---------------------------------------------------------------- hidden inner shells
# TRELLIS can build thin double walls (an inner wall 1-2 mm inside the visible surface, e.g. the neck tube). They are
# never seen, they confuse the neck seam and they waste the reduction budget: drop faces no outside view can see.
seen = meshops.visible_faces(P1, DF)
report['hiddenFacesRemoved'] = int((~seen).sum())
DF = DF[seen]
print('hidden faces removed', int((~seen).sum()), 'of', int(len(seen)))
# ---------------------------------------------------------------- cut, clean, reduce
if args.no_cut:
    CP, CN, CUV, CF, on_cut = P1.copy(), DN.copy(), DUV.copy(), DF.copy(), np.zeros(len(P1), bool)
else:
    CP, (CN, CUV), CF, on_cut = meshops.clip_by_values(P1, [DN, DUV], DF, cut_field(P1))
roots = meshops.components(CF, len(CP), CP)
labels, counts = np.unique(roots, return_counts=True)
keep_labels = labels[counts >= max(200, 0.002 * len(CF))]
CF = CF[np.isin(roots, keep_labels)]
used = np.unique(CF.ravel())
remap = -np.ones(len(CP), dtype=np.int64)
remap[used] = np.arange(len(used))
CP, CN, CUV, CF, on_cut = CP[used], CN[used], CUV[used], remap[CF], on_cut[used]
CN /= np.linalg.norm(CN, axis=1, keepdims=True) + 1e-12
tmp_in, tmp_out = out / 'simplify-in.bin', out / 'simplify-out.bin'


def simplify(P, N, UV, F, lock, target, error, flags='LockBorder'):
    blob = io.BytesIO()
    blob.write(np.array([len(P), len(F)], dtype=np.uint32).tobytes())
    blob.write(P.astype(np.float32).tobytes())
    blob.write(np.c_[N, UV].astype(np.float32).tobytes())
    blob.write(lock.astype(np.uint8).tobytes())
    blob.write(b'\0' * ((-blob.tell()) % 4))
    blob.write(F.astype(np.uint32).tobytes())
    tmp_in.write_bytes(blob.getvalue())
    res = subprocess.run(['node', str(HERE / 'simplify.mjs'), str(tmp_in), str(tmp_out), str(target), str(error), flags],
                         capture_output=True, text=True, check=True)
    raw = tmp_out.read_bytes()
    nt = int(np.frombuffer(raw, np.uint32, 1)[0])
    return np.frombuffer(raw, np.uint32, nt * 3, 8).reshape(-1, 3).astype(np.int64), json.loads(res.stdout)


# The projected face and all skin keep their atlas seams (strict reduction); only dark hair that the projection did not
# touch may collapse across seams (Permissive) - a little texture smear inside dark hair is invisible, while seams
# otherwise stall the reduction of curly or braided hair. Hair = albedo luminance below the Otsu threshold.
weight_img = np.asarray(Image.open(Path(args.projection) / 'weight.png'), dtype=np.float64) / 255.0
proj_albedo = np.asarray(Image.open(Path(args.projection) / 'albedo.png').convert('RGB'), dtype=np.float64) / 255.0
WH = weight_img.shape[0]
px_ = np.clip((CUV[:, 0] * WH).astype(int), 0, WH - 1)
py_ = np.clip((CUV[:, 1] * WH).astype(int), 0, WH - 1)
vw = weight_img[py_, px_]
lum_img = proj_albedo @ np.array([.2126, .7152, .0722])
lum8 = (np.clip(lum_img, 0, 1) * 255).astype(np.uint8)
otsu, _ = cv2.threshold(lum8[lum8 > 4].reshape(-1, 1), 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
lum_v = lum_img[py_, px_]
hair_v = (lum_v * 255 < otsu * 0.9) & (vw < 0.02)
hair_tri = hair_v[CF].all(1)
SF1, info1 = simplify(CP, CN, CUV, CF[~hair_tri], on_cut, args.budget, args.error)
SF2, info2 = simplify(CP, CN, CUV, CF[hair_tri], on_cut, args.hair_budget, args.hair_error, 'LockBorder,Permissive')
SF = np.vstack([SF1, SF2])
info = dict(skinAndFace=info1, hair=info2, otsuLuminance=float(otsu) / 255)
used = np.unique(SF.ravel())
remap = -np.ones(len(CP), dtype=np.int64)
remap[used] = np.arange(len(used))
HP, HN, HUV, HF, H_on = CP[used], CN[used], CUV[used], remap[SF], on_cut[used]
# Permissive collapses can leave hair triangles whose UVs straddle two atlas charts (they sample the gap or a skin chart:
# orange specks). Give each such triangle its own vertices with all three UVs on its darkest corner's texel.
hair_rows = np.arange(len(SF1), len(SF1) + len(SF2))
tri3 = HP[HF[hair_rows]]
a3d = np.linalg.norm(np.cross(tri3[:, 1] - tri3[:, 0], tri3[:, 2] - tri3[:, 0]), axis=1)
uvt = HUV[HF[hair_rows]]
auv = np.abs((uvt[:, 1, 0] - uvt[:, 0, 0]) * (uvt[:, 2, 1] - uvt[:, 0, 1]) - (uvt[:, 2, 0] - uvt[:, 0, 0]) * (uvt[:, 1, 1] - uvt[:, 0, 1]))
ratio_t = auv / np.maximum(a3d, 1e-12)
smear = ratio_t > 4 * np.median(ratio_t[a3d > 0])
if smear.any():
    rows_s = hair_rows[smear]
    corner_lum = lum_img[np.clip((HUV[HF[rows_s]][..., 1] * WH).astype(int), 0, WH - 1), np.clip((HUV[HF[rows_s]][..., 0] * WH).astype(int), 0, WH - 1)]
    pick = HF[rows_s, np.argmin(corner_lum, axis=1)]
    new_ids = np.arange(len(HP), len(HP) + 3 * len(rows_s)).reshape(-1, 3)
    HP = np.vstack([HP, HP[HF[rows_s]].reshape(-1, 3)])
    HN = np.vstack([HN, HN[HF[rows_s]].reshape(-1, 3)])
    HUV = np.vstack([HUV, np.repeat(HUV[pick], 3, axis=0)])
    H_on = np.r_[H_on, np.zeros(3 * len(rows_s), bool)]
    HF_connected = HF.copy()   # LOD input keeps the original connectivity (isolated triangles cannot collapse)
    HF = HF.copy()
    HF[rows_s] = new_ids
else:
    HF_connected = HF.copy()
report['reduction'] = dict(clippedTriangles=int(len(CF)), headTriangles=int(len(HF)), meshopt=info, smearedHairTrianglesFixed=int(smear.sum()))
print('reduced', info)

if not args.no_cut:
    # ---------------------------------------------------------------- zipper seam to the body ring
    # Head cut loop: vertices exactly on the cut plane, the connected group (through on-plane edges) that wraps the neck,
    # one representative per position, ordered by angle (necks are star-shaped about the ring axis).
    on_plane = H_on
    wid_h = meshops.weld_ids(HP)
    parent = {}


    def root(x):
        while parent.setdefault(x, x) != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x


    for f_ in HF:
        for u_, v_ in ((f_[0], f_[1]), (f_[1], f_[2]), (f_[2], f_[0])):
            if on_plane[u_] and on_plane[v_]:
                parent[root(wid_h[u_])] = root(wid_h[v_])
    groups = {}
    for v_ in np.nonzero(on_plane)[0]:
        groups.setdefault(root(wid_h[v_]), {}).setdefault(wid_h[v_], v_)
    # a thin double wall gives two interleaved loops at almost the same radius: take the one whose normals face outward
    best_group, best_cover, best_out = None, -1, -2
    for members in groups.values():
        ids_ = np.array(list(members.values()))
        if len(ids_) < 8:
            continue
        th_ = np.sort(np.mod(angle(HP[ids_]), 2 * np.pi))
        cover = 2 * np.pi - np.max(np.diff(np.r_[th_, th_[0] + 2 * np.pi]))
        radial_ = HP[ids_] - rc
        radial_ -= np.outer(radial_ @ rn, rn)
        outward = float(((HN[ids_] * radial_).sum(1) / (np.linalg.norm(radial_, axis=1) + 1e-12)).mean())
        if cover >= 1.6 * np.pi and outward > best_out:
            best_group, best_cover, best_out = ids_, cover, outward
    print('cut groups', int(on_plane.sum()), sorted([len(m) for m in groups.values()])[-5:], best_cover, 'outward', best_out)
    if args.debug:
        from PIL import ImageDraw
        im = Image.new('RGB', (600, 600), 'white'); dr = ImageDraw.Draw(im)
        for gi, members in enumerate(groups.values()):
            col = [(255, 0, 0), (0, 0, 255), (0, 160, 0), (200, 0, 200)][gi % 4]
            for v_ in members.values():
                q = (HP[v_] - rc); dr.ellipse([300 + q[0] * 3000 - 2, 300 + q[2] * 3000 - 2, 300 + q[0] * 3000 + 2, 300 + q[2] * 3000 + 2], fill=col)
        for v_ in ring:
            q = (BP[v_] - rc); dr.ellipse([300 + q[0] * 3000 - 1, 300 + q[2] * 3000 - 1, 300 + q[0] * 3000 + 1, 300 + q[2] * 3000 + 1], fill=(0, 0, 0))
        im.save(out / 'cut-groups.png')
        for members in groups.values():
            ids_ = np.array(list(members.values()))
            if len(ids_) > 20:
                print('group', len(ids_), (HP[ids_] - rc).min(0).round(3), (HP[ids_] - rc).max(0).round(3))
    if best_group is None or best_cover < 1.6 * np.pi:
        raise SystemExit('the cut border was not kept')
    cut_loop = best_group[np.argsort(angle(HP[best_group]))]


    def ccw(ids, P):
        ang = angle(P[ids])
        turn = np.angle(np.exp(1j * (np.roll(ang, -1) - ang))).sum()
        return list(ids) if turn > 0 else list(ids[::-1])


    hl = ccw(np.array(cut_loop), HP)
    if args.attach == 'overlap':
        # synthetic bottom loop: the cut loop lowered by --extend (2% wider), bound half Chest / half Neck; it hangs
        # inside the collar and is never welded to the body (body arrays are extended in memory only)
        CHEST = names.index('Chest')
        syn_rel = HP[hl] - rc
        syn_h = syn_rel @ rn
        syn_p = rc + np.outer(np.full(len(hl), -args.extend), rn) + (syn_rel - np.outer(syn_h, rn)) * 1.02
        n_body = len(BP)
        BP = np.vstack([BP, syn_p])
        BN = np.vstack([BN, HN[hl]])
        BUV = np.vstack([BUV, np.zeros((len(hl), 2))])
        BJ = np.vstack([BJ, np.tile([CHEST, NECK, 0, 0], (len(hl), 1))])
        BW = np.vstack([BW, np.tile([0.5, 0.5, 0.0, 0.0], (len(hl), 1))])
        bl = list(range(n_body, n_body + len(hl)))
    else:
        bl = ccw(np.array(ring), BP)
    ref_angle = angle(HP[hl[:1]])[0]
    ha = np.unwrap(angle(HP[hl]) - ref_angle)
    ha -= ha[0]
    rel_b = np.mod(angle(BP[bl]) - ref_angle, 2 * np.pi)
    start = int(np.argmin(rel_b))
    bl = bl[start:] + bl[:start]
    ba = np.unwrap(np.mod(angle(BP[bl]) - ref_angle, 2 * np.pi))
    ba -= ba[0] - np.mod(ba[0], 2 * np.pi)
    # Sleeve from the head cut loop down to the body ring. Its own vertices: top row = copies of the cut loop, bottom row =
    # copies of the body ring (exact position/normal/weights), rows in between on a cubic Hermite profile with vertical
    # end tangents. Every row carries a closing duplicate at 2*pi so the sleeve's UVs (a dedicated patch) never wrap.
    def along(points, angs, query):
        out_ = np.empty((len(query), points.shape[1]))
        for c in range(points.shape[1]):
            out_[:, c] = np.interp(query, angs, points[:, c])
        return out_


    if (np.diff(ha) < 0).any() or (np.diff(ba) < 0).any():
        raise SystemExit('seam loops are not monotonic in angle')
    hl_ext, ha_ext = hl + hl[:1], np.r_[ha, 2 * np.pi]
    bl_ext, ba_ext = bl + bl[:1], np.r_[ba, ba[0] + 2 * np.pi]
    rows_n = max(1, int(np.ceil(((args.extend + offset_cut) if args.attach == 'overlap' else offset_cut) / 0.006)))
    M = int(min(160, max(len(hl), len(bl))))
    ang_m = np.linspace(0, 2 * np.pi, M + 1)
    Ttop = along(np.vstack([HP[hl], HP[hl[:1]]]), ha_ext, ang_m)
    ba_pad = np.r_[ba[-1] - 2 * np.pi, ba, ba[0] + 2 * np.pi]
    Bbot = along(np.vstack([BP[bl[-1:]], BP[bl], BP[bl[:1]]]), ba_pad, ang_m)
    Ntop = along(np.vstack([HN[hl], HN[hl[:1]]]), ha_ext, ang_m)
    Nbot = along(np.vstack([BN[bl[-1:]], BN[bl], BN[bl[:1]]]), ba_pad, ang_m)
    Lm = np.linalg.norm(Ttop - Bbot, axis=1, keepdims=True)
    mid_rows = []
    for r in range(1, rows_n):
        t = r / rows_n
        h00, h10, h01, h11 = 2 * t**3 - 3 * t**2 + 1, t**3 - 2 * t**2 + t, -2 * t**3 + 3 * t**2, t**3 - t**2
        pos_r = h00 * Ttop + h10 * (-rn * Lm) + h01 * Bbot + h11 * (-rn * Lm)
        nr = Ntop * (1 - t) + Nbot * t
        mid_rows.append((t, pos_r, nr / (np.linalg.norm(nr, axis=1, keepdims=True) + 1e-12)))
    n_head = len(HP)
    top0 = n_head
    mid0 = top0 + len(hl_ext)
    bot0 = mid0 + (rows_n - 1) * (M + 1)


    def zipper(a_ids, a_ang, b_ids, b_ang):
        tris, i, j = [], 0, 0
        while i < len(a_ids) - 1 or j < len(b_ids) - 1:
            if j == len(b_ids) - 1 or (i < len(a_ids) - 1 and a_ang[i + 1] <= b_ang[j + 1]):
                tris.append([a_ids[i], b_ids[j], a_ids[i + 1]])
                i += 1
            else:
                tris.append([a_ids[i], b_ids[j], b_ids[j + 1]])
                j += 1
        return tris


    top_ids = np.arange(top0, top0 + len(hl_ext))
    bot_ids = np.arange(bot0, bot0 + len(bl_ext))
    row_ids = [np.arange(mid0 + r * (M + 1), mid0 + (r + 1) * (M + 1)) for r in range(rows_n - 1)]
    chain = [(top_ids, ha_ext)] + [(ids, ang_m) for ids in row_ids] + [(bot_ids, ba_ext)]
    strip = []
    for (a_ids, a_ang), (b_ids, b_ang) in zip(chain[:-1], chain[1:]):
        strip += zipper(a_ids, a_ang, b_ids, b_ang)
    strip = np.array(strip, dtype=np.int64)
    allP = np.vstack([HP, HP[hl_ext]] + [m[1] for m in mid_rows] + [BP[bl_ext]])
    tri = allP[strip]
    normal = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    radial = tri.mean(1) - rc
    radial -= np.outer(radial @ rn, rn)
    flip = (normal * radial).sum(1) < 0
    strip[flip] = strip[flip][:, [0, 2, 1]]
    hn = np.cross(HP[HF[:, 1]] - HP[HF[:, 0]], HP[HF[:, 2]] - HP[HF[:, 0]])
    agree = float(((hn * HN[HF].mean(1)).sum(1) > 0).mean())
    if agree < .5:
        HF = HF[:, [0, 2, 1]]
    # sleeve normals: geometric (area-weighted from the sleeve faces); the top row keeps the head's normals, the bottom
    # row keeps the body's ring normals where those are sane (a few body edge normals point down/inward)
    geo = np.zeros_like(allP)
    fnn = np.cross(allP[strip[:, 1]] - allP[strip[:, 0]], allP[strip[:, 2]] - allP[strip[:, 0]])
    for c in range(3):
        np.add.at(geo, strip[:, c], fnn)
    geo /= np.linalg.norm(geo, axis=1, keepdims=True) + 1e-12
    allN = np.vstack([HN, HN[hl_ext]] + [m[2] for m in mid_rows] + [BN[bl_ext]])
    for r_ in range(rows_n - 1):
        ids_ = row_ids[r_]
        allN[ids_] = geo[ids_]
    bn_ids = np.arange(bot0, bot0 + len(bl_ext))
    sane = (allN[bn_ids] * geo[bn_ids]).sum(1) > 0.35
    allN[bn_ids[~sane]] = geo[bn_ids[~sane]]
    allF = np.vstack([HF, strip])
    # the body's ring vertices get the sleeve's bottom normals so the collar shades continuously (only these body bytes change)
    ring_normal_fix = None
    if not args.keep_ring_normals and args.attach == 'ring':
        ring_normal_fix = {int(b_): allN[bot0 + k_].copy() for k_, b_ in enumerate(bl)}
        for k_ in range(len(bl_ext)):
            allN[bot0 + k_] = geo[bot0 + k_]
        for k_, b_ in enumerate(bl):
            ring_normal_fix[int(b_)] = geo[bot0 + k_]
    report['seam'] = dict(headLoop=len(hl), bodyRing=len(bl), ringNormalsReplaced=int((~sane).sum()), sleeveRows=rows_n, sleeveColumns=M, stripTriangles=int(len(strip)),
                          headWindingAgreement=agree)

else:
    allP, allN, allF = HP, HN, HF
    hl, bl, ha, ba, mid_rows, ring_normal_fix, ref_angle = [], [], np.zeros(1), np.zeros(1), [], None, 0.0
    report['seam'] = dict(mode='no-cut overlap: the reconstructed neck ends inside the collar')
# ---------------------------------------------------------------- skin weights


def dense_weights(J, W):
    out_ = np.zeros((len(J), len(names)))
    np.add.at(out_, (np.repeat(np.arange(len(J)), J.shape[1]), J.ravel()), W.ravel())
    return out_


if args.no_cut:
    ring_w = np.zeros((1, len(names)))
    ring_w[0, names.index('Chest')] = 0.5
    ring_w[0, NECK] = 0.5
else:
    ring_w = dense_weights(BJ[bl], BW[bl])


def ring_weights_at(th):
    if args.no_cut:
        return np.repeat(ring_w, len(th), axis=0)
    th = np.mod(th, 2 * np.pi)
    ext = np.r_[ba - 2 * np.pi, ba, ba + 2 * np.pi]
    k = np.searchsorted(ext, th)
    t = np.clip((th - ext[k - 1]) / np.maximum(ext[k] - ext[k - 1], 1e-9), 0, 1)[:, None]
    return ring_w[(k - 1) % len(bl)] * (1 - t) + ring_w[k % len(bl)] * t
curve = np.array([[float(x) for x in p.split(':')] for p in args.jaw.split(',')])
curve = curve[np.argsort(curve[:, 0])]


def head_weights(P):
    rw = ring_weights_at(angle(P) - ref_angle)
    yb = np.interp(P[:, 2], curve[:, 0], curve[:, 1])
    hh = np.clip((P[:, 1] - yb) / args.blend, 0, 1)
    hh = hh * hh * (3 - 2 * hh)
    above = cut_field(P)
    span = np.maximum(yb - (cut_c[1] + 0.0), 0.01)
    tn = np.clip(above / (0.6 * span), 0, 1)
    tn = tn * tn * (3 - 2 * tn)
    neck = rw * (1 - tn)[:, None]
    neck[:, NECK] += tn
    w = neck * (1 - hh)[:, None]
    w[:, HEAD] += hh
    return w, hh


hw, hh = head_weights(HP)
if args.no_cut:
    Wall = hw
else:
    mid_w = [ring_weights_at(ang_m) for _ in mid_rows]
    Wall = np.vstack([hw, hw[hl_ext]] + mid_w + [dense_weights(BJ[bl_ext], BW[bl_ext])])


def top4(Wd):
    order = np.argsort(-Wd, axis=1)[:, :4]
    picked = np.take_along_axis(Wd, order, axis=1)
    picked[picked < 1e-4] = 0
    picked /= picked.sum(1, keepdims=True)
    order[picked == 0] = 0
    return order.astype(np.uint8), picked.astype(np.float32)


J4, W4 = top4(Wall)
# the seam copies keep the body's exact quantised weights
if not args.no_cut:
    J4[bot0:] = BJ[bl_ext].astype(np.uint8)
    W4[bot0:] = BW[bl_ext].astype(np.float32)
report['weights'] = dict(rigidHeadVertices=int((hh >= 1).sum()), blendedVertices=int(((hh > 0) & (hh < 1)).sum()),
                         neckVertices=int((hh <= 0).sum()), seamCopies=0 if args.no_cut else len(bl_ext), jaw=curve.tolist(), blend=args.blend)

# ---------------------------------------------------------------- texture: projected albedo + skin tone toward the body
albedo = np.asarray(Image.open(Path(args.projection) / 'albedo.png').convert('RGB'), dtype=np.float64) / 255.0
A = albedo.shape[0]
body_mat = G.doc['materials'][body['material']]
body_img = np.asarray(Image.open(io.BytesIO(G.image_bytes(G.texture_image(body_mat['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'), dtype=np.float64) / 255.0


def sample(img, uv):
    h, w = img.shape[:2]
    x = np.clip((uv[:, 0] * w).astype(int), 0, w - 1)
    y = np.clip((uv[:, 1] * h).astype(int), 0, h - 1)
    return img[y, x]


def sample_patch(img, uv, radius=3):
    h, w = img.shape[:2]
    acc = 0
    for dy in range(-radius, radius + 1):
        for dx in range(-radius, radius + 1):
            x = np.clip((uv[:, 0] * w).astype(int) + dx, 0, w - 1)
            y = np.clip((uv[:, 1] * h).astype(int) + dy, 0, h - 1)
            acc = acc + img[y, x]
    return acc / (2 * radius + 1) ** 2


def circular_smooth(values, k):
    out_ = np.zeros_like(values)
    for d in range(-k, k + 1):
        out_ += np.roll(values, d, axis=0)
    return out_ / (2 * k + 1)


if not args.no_cut:
    # per-angle skin colours on both sides of the seam
    # body skin at the ring: sampled inside the body triangles that touch each ring vertex (chart edges hold gutter texels)
    ring_set = {int(v): k for k, v in enumerate(bl)}
    acc_c = np.zeros((len(bl), 3))
    acc_n = np.zeros(len(bl))
    for f_ in BF[np.isin(BF, bl).any(1)]:
        c_uv = BUV[f_].mean(0) * 0.7 + BUV[f_].mean(0) * 0.0
        inner_uv = BUV[f_].mean(0)
        col = sample(body_img, inner_uv[None])[0]
        for v in f_:
            if int(v) in ring_set:
                acc_c[ring_set[int(v)]] += col
                acc_n[ring_set[int(v)]] += 1
    ring_cols = circular_smooth(acc_c / np.maximum(acc_n, 1)[:, None], 2)
    if args.attach == 'overlap':
        loop_c = sample_patch(albedo, HUV[hl])
        lum_c = loop_c @ np.array([.2126, .7152, .0722])
        skin_c = np.median(loop_c[lum_c >= np.percentile(lum_c, 60)], axis=0)
        ring_cols = np.tile(skin_c, (len(bl), 1))
    head_cols = circular_smooth(sample_patch(albedo, HUV[hl]), max(2, len(hl) // 40))
    ring_col, head_col = np.median(ring_cols, 0), np.median(head_cols, 0)
    gain = np.clip(ring_col / np.maximum(head_col, 1e-3), 0.5, 2.0)
    head_at_ring = np.array([head_cols[int(np.argmin(np.abs(np.angle(np.exp(1j * (ha - b))))))] for b in ba])
    local = np.clip(ring_cols / np.maximum(head_at_ring, 1e-3) / gain, 0.5, 2.0)
    tri_id, bary = uv_raster(np.c_[HUV[:, 0] * A, HUV[:, 1] * A], HF, A, A)
    cov = tri_id >= 0
    pos = (HP[HF[tri_id[cov]]] * bary[cov][..., None]).sum(1)
    height = cut_field(pos)
    th = np.mod(angle(pos) - ref_angle, 2 * np.pi)
    ext = np.r_[ba - 2 * np.pi, ba, ba + 2 * np.pi]
    kk = np.searchsorted(ext, th)
    tt = np.clip((th - ext[kk - 1]) / np.maximum(ext[kk] - ext[kk - 1], 1e-9), 0, 1)[:, None]
    loc = local[(kk - 1) % len(bl)] * (1 - tt) + local[kk % len(bl)] * tt
    f = np.clip(1 - height / args.neck_tint, 0, 1)
    f = f * f * (3 - 2 * f)
    # never tint the face: the seam tint fades out under the jaw line
    yb_t = np.interp(pos[:, 2], curve[:, 0], curve[:, 1])
    jaw_t = np.clip((pos[:, 1] - yb_t) / args.blend + 1.0, 0, 1)
    f = f * (1 - jaw_t * jaw_t * (3 - 2 * jaw_t))
    fg = args.tone + (1 - args.tone) * f
    result = albedo.copy()
    result[cov] = np.clip(albedo[cov] * gain[None, :] ** fg[:, None] * loc ** f[:, None], 0, 1)
    result, _ = dilate(result, cov, 4)
    # dedicated strip patch: 16 extra texture rows under the atlas, filled with the body ring skin colour per angle
    # (xatlas leaves no free rectangle). Head V coordinates are rescaled to the taller image.
    EXTRA = 16
    x0, y0, Wp, Hp = 8, A + 4, A - 16, 8
    col_ang = np.linspace(0, 2 * np.pi, Wp)
    ba_c = np.r_[ba, ba[0] + 2 * np.pi]
    kk = np.searchsorted(ba_c, col_ang).clip(1, len(bl))
    tt = np.clip((col_ang - ba_c[kk - 1]) / np.maximum(ba_c[kk] - ba_c[kk - 1], 1e-9), 0, 1)[:, None]
    rc_ext = np.vstack([ring_cols, ring_cols[:1]])
    bottom_cols = rc_ext[kk - 1] * (1 - tt) + rc_ext[kk] * tt
    loop_cols = circular_smooth(sample_patch(result, HUV[hl], 1), 2)
    top_cols = along(np.vstack([loop_cols, loop_cols[:1]]), ha_ext, col_ang)
    if args.attach == 'overlap':
        top_cols = bottom_cols.copy()
    rows_img = []
    for r in range(EXTRA):
        t = np.clip((r - 4 - 1.5) / (Hp - 3), 0, 1)
        cols = top_cols * (1 - t) + bottom_cols * t
        rows_img.append(np.vstack([cols[:1].repeat(x0, 0), cols, cols[-1:].repeat(A - x0 - Wp, 0)]))
    result = np.vstack([result, np.stack(rows_img)])
    HUV = HUV * np.array([1.0, A / (A + EXTRA)])
    strip_uv = lambda ang, t: np.c_[(x0 + 0.5 + ang / (2 * np.pi) * (Wp - 1)) / A, np.full(len(ang), (y0 + 1.5 + t * (Hp - 3)) / (A + EXTRA))]  # noqa: E731
    allUV = np.vstack([HUV, strip_uv(ha_ext, 0.0)] + [strip_uv(ang_m, m[0]) for m in mid_rows] + [strip_uv(ba_ext, 1.0)])
    report['seam']['uvPatch'] = dict(x=x0, y=y0, width=Wp, height=Hp)
else:
    gain = np.ones(3)
    ring_col = head_col = np.zeros(3)
    tri_id, bary = uv_raster(np.c_[HUV[:, 0] * A, HUV[:, 1] * A], HF, A, A)
    cov = tri_id >= 0
    result, _ = dilate(albedo.copy(), cov, 4)
    allUV = HUV
if args.hair_match_body:
    # grade dark (hair) texels of the new head toward the body's kept hair colour so both read as one hairstyle
    ymin_m, zmax_m = map(float, args.hair_match_body.split(','))
    bimg_m = np.asarray(Image.open(io.BytesIO(G.image_bytes(G.texture_image(G.doc['materials'][body['material']]['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'), dtype=np.float64) / 255.0
    fuv_m = BUV[BF].mean(1)
    col_m = bimg_m[np.clip((fuv_m[:, 1] * bimg_m.shape[0]).astype(int), 0, bimg_m.shape[0] - 1), np.clip((fuv_m[:, 0] * bimg_m.shape[1]).astype(int), 0, bimg_m.shape[1] - 1)]
    fc_m = BP[BF].mean(1)
    body_hair = (col_m @ np.array([.2126, .7152, .0722]) < 0.24) & (fc_m[:, 1] > ymin_m) & (fc_m[:, 2] < zmax_m) & (np.abs(fc_m[:, 0]) < 0.12)
    target_hair = np.median(col_m[body_hair], axis=0)
    lum_r = result[:A] @ np.array([.2126, .7152, .0722])
    weight_m = np.asarray(Image.open(Path(args.projection) / 'weight.png'), dtype=np.float64) / 255.0
    hair_t = np.clip((otsu / 255.0 - lum_r) / 0.06, 0, 1) * (weight_m < 0.02)
    head_hair = np.median(result[:A][hair_t > 0.9], axis=0)
    gain_h = np.clip(target_hair / np.maximum(head_hair, 1e-3), 0.5, 3.0) ** 0.6
    result[:A] = np.clip(result[:A] * (1 + (gain_h[None, None, :] - 1) * hair_t[..., None]), 0, 1)
    report['hairGrade'] = dict(bodyHair=target_hair.round(4).tolist(), headHair=head_hair.round(4).tolist(), gain=gain_h.round(4).tolist())
tex = io.BytesIO()
Image.fromarray((result * 255 + .5).astype(np.uint8)).save(tex, format='WEBP', quality=92, method=6)
Image.fromarray((result * 255 + .5).astype(np.uint8)).save(out / 'head-albedo.png')
report['texture'] = dict(size=A, ringSkin=ring_col.round(4).tolist(), headNeckSkin=head_col.round(4).tolist(), gain=gain.round(4).tolist(),
                         tone=args.tone, neckTint=args.neck_tint, webpBytes=len(tex.getvalue()))

# ---------------------------------------------------------------- GLB assembly (only the head primitive and head textures change)


def rebuild(src, prim_index, geometry, new_image=None, material_overrides=None, body_normals=None, body_indices=None):
    """Copy src into a new GLB with prim `prim_index` replaced. Unused accessors/views/images/textures are dropped
    and the rest keep their exact bytes (only offsets change)."""
    doc = json.loads(json.dumps(src.doc))
    prim = doc['meshes'][0]['primitives'][prim_index]
    head_mat_id = prim.get('material')
    b = Builder({k: v for k, v in doc.items() if k not in ('accessors', 'bufferViews', 'buffers')})
    b.doc['accessors'] = []
    view_map, acc_map = {}, {}

    def copy_view(vid):
        if vid not in view_map:
            v = src.doc['bufferViews'][vid]
            view_map[vid] = b.add_view(src.view_bytes(vid), v.get('target'))
            if 'byteStride' in v:
                b.doc['bufferViews'][view_map[vid]]['byteStride'] = v['byteStride']
        return view_map[vid]

    def copy_acc(aid):
        if aid not in acc_map:
            acc = json.loads(json.dumps(src.doc['accessors'][aid]))
            acc['bufferView'] = copy_view(acc['bufferView'])
            b.doc['accessors'].append(acc)
            acc_map[aid] = len(b.doc['accessors']) - 1
        return acc_map[aid]

    for m in b.doc['meshes']:
        for pi, p in enumerate(m['primitives']):
            if m is b.doc['meshes'][0] and pi == prim_index:
                continue
            if body_normals is not None and m is b.doc['meshes'][0] and pi == 0:
                attrs_ = {k: copy_acc(v) for k, v in p['attributes'].items() if k != 'NORMAL'}
                attrs_['NORMAL'] = b.add_accessor(body_normals.astype(np.float32), 5126, 'VEC3', 34962)
                p['attributes'] = attrs_
            else:
                p['attributes'] = {k: copy_acc(v) for k, v in p['attributes'].items()}
            if body_indices is not None and m is b.doc['meshes'][0] and pi == 0:
                p['indices'] = b.add_accessor(body_indices.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
                continue
            if 'indices' in p:
                p['indices'] = copy_acc(p['indices'])
    for s_ in b.doc.get('skins', []):
        if 'inverseBindMatrices' in s_:
            s_['inverseBindMatrices'] = copy_acc(s_['inverseBindMatrices'])
    for an in b.doc.get('animations', []):
        for smp in an['samplers']:
            smp['input'] = copy_acc(smp['input'])
            smp['output'] = copy_acc(smp['output'])
    gP, gN, gUV, gJ, gW, gF = geometry
    p = b.doc['meshes'][0]['primitives'][prim_index]
    p['attributes'] = {
        'POSITION': b.add_accessor(gP.astype(np.float32), 5126, 'VEC3', 34962, minmax=True),
        'NORMAL': b.add_accessor(gN.astype(np.float32), 5126, 'VEC3', 34962),
        'TEXCOORD_0': b.add_accessor(gUV.astype(np.float32), 5126, 'VEC2', 34962),
        'JOINTS_0': b.add_accessor(gJ.astype(np.uint8), 5121, 'VEC4', 34962),
        'WEIGHTS_0': b.add_accessor(gW.astype(np.float32), 5126, 'VEC4', 34962),
    }
    p['indices'] = b.add_accessor(gF.astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
    p.pop('targets', None)
    # images / textures: keep the ones still referenced, swap the head base colour
    if new_image is not None and head_mat_id is not None:
        mat = b.doc['materials'][head_mat_id]
        if material_overrides:
            mat.update(material_overrides)
        mat.pop('normalTexture', None)
        pbr = mat.setdefault('pbrMetallicRoughness', {})
        pbr.pop('metallicRoughnessTexture', None)
        tex_id = pbr['baseColorTexture']['index']
        # give the head its own texture/image so other materials never share the replaced image
        b.doc['images'].append({'mimeType': 'image/webp', 'name': 'HeadAlbedoC2Face', 'bufferView': -1})
        new_img = len(b.doc['images']) - 1
        old_tex = b.doc['textures'][tex_id]
        b.doc['textures'].append({'sampler': old_tex.get('sampler', 0), 'extensions': {'EXT_texture_webp': {'source': new_img}}})
        pbr['baseColorTexture'] = {'index': len(b.doc['textures']) - 1}
    used_tex = set()
    for mat in b.doc.get('materials', []):
        for slot in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            if slot in mat:
                used_tex.add(mat[slot]['index'])
        for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
            if slot in mat.get('pbrMetallicRoughness', {}):
                used_tex.add(mat['pbrMetallicRoughness'][slot]['index'])
    tex_map, img_map, new_textures, new_images = {}, {}, [], []
    for ti in sorted(used_tex):
        t = json.loads(json.dumps(b.doc['textures'][ti]))
        src_img = t.get('extensions', {}).get('EXT_texture_webp', {}).get('source', t.get('source'))
        if src_img not in img_map:
            im = json.loads(json.dumps(b.doc['images'][src_img]))
            if im['bufferView'] == -1:
                im['bufferView'] = b.add_view(new_image)
            else:
                im['bufferView'] = copy_view(src.doc['images'][src_img]['bufferView'])
            new_images.append(im)
            img_map[src_img] = len(new_images) - 1
        if 'EXT_texture_webp' in t.get('extensions', {}):
            t['extensions']['EXT_texture_webp']['source'] = img_map[src_img]
        else:
            t['source'] = img_map[src_img]
        new_textures.append(t)
        tex_map[ti] = len(new_textures) - 1
    for mat in b.doc.get('materials', []):
        for slot in ('normalTexture', 'occlusionTexture', 'emissiveTexture'):
            if slot in mat:
                mat[slot]['index'] = tex_map[mat[slot]['index']]
        for slot in ('baseColorTexture', 'metallicRoughnessTexture'):
            if slot in mat.get('pbrMetallicRoughness', {}):
                mat['pbrMetallicRoughness'][slot]['index'] = tex_map[mat['pbrMetallicRoughness'][slot]['index']]
    if new_textures:
        b.doc['textures'] = new_textures
        b.doc['images'] = new_images
    else:
        b.doc.pop('textures', None)
        b.doc.pop('images', None)
    return b


geometry = (allP, allN, allUV, J4, W4, allF)
new_body_normals = None
if ring_normal_fix:
    new_body_normals = G.accessor(body['attributes']['NORMAL']).astype(np.float64).copy()
    for b_, n_ in ring_normal_fix.items():
        new_body_normals[b_] = n_
    # body vertices sharing a ring position (UV seam duplicates) get the same normal
    ring_pos = {tuple(np.round(BP[b_], 6)): n_ for b_, n_ in ring_normal_fix.items()}
    for i_ in np.nonzero(np.isin(np.round(BP[:, 1], 6), np.round(BP[bl, 1], 6)))[0]:
        k_ = tuple(np.round(BP[i_], 6))
        if k_ in ring_pos:
            new_body_normals[i_] = ring_pos[k_]
    report['seam']['bodyRingNormalsChanged'] = int((np.abs(new_body_normals - G.accessor(body['attributes']['NORMAL'])).max(1) > 1e-6).sum())
bm = rebuild(G, args.head_prim, geometry, tex.getvalue(),
             {'name': 'C2 face remake head (TRELLIS + projected reference)'}, new_body_normals, BF_kept)
bm.doc['meshes'][0]['primitives'][args.head_prim]['material'] = old_head['material']
mat = bm.doc['materials'][old_head['material']]
mat['pbrMetallicRoughness'].update(metallicFactor=0.0, roughnessFactor=0.6)
model_bytes = bm.write(out / 'model.glb')

# ---------------------------------------------------------------- LOD: same atlas (subset vertices), overlapping the LOD neck
# Permissive: at >= 28 m small UV drift across atlas seams is invisible, and the seams otherwise stop the reduction.
LF_idx, linfo = simplify(HP, HN, HUV, HF_connected, np.isin(np.arange(len(HP)), hl), args.lod_budget, 1.0, 'Sloppy')
used = np.unique(LF_idx.ravel())
remap = -np.ones(len(HP), dtype=np.int64)
remap[used] = np.arange(len(used))
LP, LN, LUV, LFc = HP[used].copy(), HN[used], HUV[used], remap[LF_idx]
if not args.no_cut:
    seam = np.isin(used, hl)
    LP[seam] -= rn * ((args.extend if args.attach == 'overlap' else offset_cut) + 0.01)   # tuck the LOD neck into the LOD body
lw, _ = head_weights(HP[used])
LJ4, LW4 = top4(lw)
L = Glb(lod_path)
lod_head = L.doc['meshes'][0]['primitives'][args.head_prim]
bl_ = rebuild(L, args.head_prim, (LP, LN, LUV, LJ4, LW4, LFc))
bl_.doc['meshes'][0]['primitives'][args.head_prim]['material'] = lod_head.get('material')
lod_bytes = bl_.write(out / 'lod.glb')
report['lod'] = dict(triangles=int(len(LFc)), meshopt=linfo)
report['output'] = dict(model=str(out / 'model.glb'), modelSha256=sha(model_bytes), modelBytes=len(model_bytes),
                        lod=str(out / 'lod.glb'), lodSha256=sha(lod_bytes), lodBytes=len(lod_bytes),
                        headTriangles=int(len(allF)), headVertices=int(len(allP)))
(out / 'graft-report.json').write_text(json.dumps(report, indent=2, default=float) + '\n')
tmp_in.unlink(missing_ok=True)
tmp_out.unlink(missing_ok=True)
print('GRAFT_DONE', json.dumps(report['output']))
