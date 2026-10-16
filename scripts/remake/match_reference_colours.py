"""Bring the colours of a baked TRELLIS atlas back to its reference image.

python scripts/remake/match_reference_colours.py <in.glb> <reference.png> <out.glb> --mask matte.png
    --rows V0,V1 [--mode quantile|class] [--class hair] [--strength 1.0]

TRELLIS-2 bakes the reference's lighting into the albedo and comes out darker and more saturated than the
reference: for the 2026-10-13 chibi Cro-Magnon woman the hair luminance was half the reference's and the hide
tunic 25% darker. Only the base colour image changes (geometry, UVs, normal map stay):
  --mode quantile  every CIELAB channel of the atlas's covered texels is mapped through the quantiles of the
                   reference's subject pixels between reference rows V0 and V1 (the body below the neck);
  --mode range     the texels in --atlas-range move (CIELAB mean and spread) onto the reference pixels in --ref-range
                   (a pelt hood in another colour than the hair, after the hair class has moved the hair)
  --mode class     only texels of one colour class move: --class hair takes reddish-brown texels (hue <35 or
                   >345 degrees, saturation >0.4, value 0.06-0.75 in the atlas) and moves their CIELAB mean and
                   spread onto those of the reference's hair-coloured pixels in the rows (the head), with a soft
                   class edge, so the painted face and the skin keep their colour.
--strength blends the result with the input. Covered texels are those with a non-zero alpha after the
reconstruction's own seam padding (every texel the triangles reach). Writes OUT.glb and OUT.json.
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
ap.add_argument('--mask', required=True, help='reference foreground matte (8-bit, >127 = subject)')
ap.add_argument('--rows', required=True, help='V0,V1: reference rows of the part this atlas covers')
ap.add_argument('--mode', default='quantile', choices=['quantile', 'class', 'range'])
ap.add_argument('--atlas-range', default='', help='with --mode range: H0,H1,S0,S1,V0,V1 (hue in degrees, wrapping when H0 > H1): '
                'the atlas texels that move (a pelt hood in another colour than the hair, after the hair class)')
ap.add_argument('--ref-range', default='', help='with --mode range: H0,H1,S0,S1,V0,V1 of the reference pixels they move onto')
ap.add_argument('--class', dest='klass', default='hair', choices=['hair'])
ap.add_argument('--class-sat', default='0.32,0.42', help='S0,S1: the saturation ramp of the hair class (a less saturated dark-brown '
                'reference hair, e.g. 0.36-0.46, is only partly in the default ramp and the transfer then aims at its most '
                'saturated part)')
ap.add_argument('--strength', type=float, default=1.0)
ap.add_argument('--channels', default='Lab', help='with --mode quantile: the CIELAB channels matched (L = lightness only: '
                'TRELLIS darkened every colour, but a global chroma match also greys the saturated browns of a body whose '
                'reference is mostly cream)')
ap.add_argument('--material', default='', help='the material whose base colour changes, by name (default: the first; '
                'HeadSurface of a rigged final GLB: only that image changes, the skin and clips stay)')
ap.add_argument('--webp-quality', type=int, default=92)
args = ap.parse_args()

g = Glb(args.glb)
material = next(i for i, m in enumerate(g.doc['materials']) if m.get('name') == args.material) if args.material else 0
mat = g.doc['materials'][material]
image_index = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(image_index))).convert('RGB'), dtype=np.float32) / 255.0
prim = next(p for p in g.doc['meshes'][0]['primitives'] if p.get('material', 0) == material)
UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3)
AH, AW = albedo.shape[:2]
covered = np.zeros((AH, AW), np.uint8)
for tri in np.round(UV[F] * [AW, AH] * 16).astype(np.int32):
    cv2.fillConvexPoly(covered, tri, 1, lineType=cv2.LINE_8, shift=4)
covered = cv2.dilate(covered, np.ones((5, 5), np.uint8)).astype(bool)

ref = np.asarray(Image.open(args.reference).convert('RGB'), dtype=np.float32) / 255.0
matte = np.asarray(Image.open(args.mask).convert('L')) > 127
v0, v1 = map(int, args.rows.split(','))
rows = np.zeros_like(matte)
rows[v0:v1] = True
subject = cv2.erode((matte & rows).astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool)

lab = cv2.cvtColor(albedo, cv2.COLOR_RGB2LAB)
ref_lab = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB)


def hair_weight(rgb):
    hsv = cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2HSV)
    h, s, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
    ramp = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1)  # noqa: E731
    hue = np.maximum(1 - ramp(h, 35, 45), ramp(h, 335, 345))
    s0, s1 = (float(x) for x in args.class_sat.split(','))
    return hue * ramp(s, s0, s1) * ramp(v, 0.04, 0.07) * (1 - ramp(v, 0.72, 0.82))


report = dict(author='Claude Code (Opus 5.5)', script='scripts/remake/match_reference_colours.py', mode=args.mode,
              strength=args.strength, rows=[v0, v1], coveredTexels=int(covered.sum()), subjectPixels=int(subject.sum()))
out_lab = lab.copy()
if args.mode == 'quantile':
    qs = np.linspace(0, 1, 257)
    channels = []
    for c in range(3):
        if 'Lab'[c] not in args.channels:
            channels.append(None)
            continue
        src_q = np.quantile(lab[..., c][covered], qs)
        ref_q = np.quantile(ref_lab[..., c][subject], qs)
        src_q = np.maximum.accumulate(src_q + np.arange(257) * 1e-6)  # strictly increasing for interp
        out_lab[..., c] = np.interp(lab[..., c], src_q, ref_q)
        channels.append(dict(atlasMedian=float(src_q[128]), referenceMedian=float(ref_q[128])))
    weight = covered.astype(np.float32)
    report['channels'] = channels
    report['matchedChannels'] = args.channels
elif args.mode == 'range':
    def in_range(rgb, spec):
        h0, h1, s0, s1, v0, v1 = (float(x) for x in spec.split(','))
        hsv = cv2.cvtColor(rgb.astype(np.float32), cv2.COLOR_RGB2HSV)
        h, s_, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
        hue = ((h >= h0) | (h <= h1)) if h0 > h1 else ((h >= h0) & (h <= h1))
        return hue & (s_ >= s0) & (s_ <= s1) & (v >= v0) & (v <= v1)
    sel_a = in_range(albedo, args.atlas_range) & covered
    sel_r = in_range(ref, args.ref_range) & subject
    mean_a, std_a = lab[sel_a].mean(0), lab[sel_a].std(0) + 1e-6
    mean_r, std_r = ref_lab[sel_r].mean(0), ref_lab[sel_r].std(0)
    out_lab = (lab - mean_a) / std_a * std_r + mean_r
    weight = cv2.GaussianBlur(sel_a.astype(np.float32), (0, 0), 1.0)
    report['range'] = dict(atlas=args.atlas_range, reference=args.ref_range, atlasTexels=int(sel_a.sum()),
                           referencePixels=int(sel_r.sum()),
                           atlasLab=dict(mean=mean_a.round(2).tolist(), std=std_a.round(2).tolist()),
                           referenceLab=dict(mean=mean_r.round(2).tolist(), std=std_r.round(2).tolist()))
else:
    wa = hair_weight(albedo) * covered
    wr = hair_weight(ref) * subject
    sel_a, sel_r = wa > 0.5, wr > 0.5
    mean_a, std_a = lab[sel_a].mean(0), lab[sel_a].std(0) + 1e-6
    mean_r, std_r = ref_lab[sel_r].mean(0), ref_lab[sel_r].std(0)
    out_lab = (lab - mean_a) / std_a * std_r + mean_r
    weight = wa.astype(np.float32)
    report['class'] = dict(name=args.klass, saturationRamp=args.class_sat, atlasTexels=int(sel_a.sum()), referencePixels=int(sel_r.sum()),
                           atlasLab=dict(mean=mean_a.round(2).tolist(), std=std_a.round(2).tolist()),
                           referenceLab=dict(mean=mean_r.round(2).tolist(), std=std_r.round(2).tolist()))
weight = (weight * args.strength)[..., None]
result = cv2.cvtColor(out_lab.astype(np.float32), cv2.COLOR_LAB2RGB)
result = np.clip(albedo * (1 - weight) + result * weight, 0, 1)
before_med = np.median(albedo[covered], 0)
after_med = np.median(result[covered], 0)
report['medianSrgb'] = dict(before=np.round(before_med * 255).astype(int).tolist(), after=np.round(after_med * 255).astype(int).tolist())

u8 = (result * 255 + 0.5).astype(np.uint8)
buffer = io.BytesIO()
Image.fromarray(u8).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
replaced = {g.doc['images'][image_index]['bufferView']: buffer.getvalue()}
b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    b.add_view(replaced.get(i, g.view_bytes(i)), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
b.doc['images'][image_index]['mimeType'] = 'image/webp'
b.write(args.out)
Image.fromarray(u8).save(Path(args.out).with_suffix('.albedo.png'))
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report.update(source=args.glb, sourceSha256=sha(args.glb), reference=args.reference, referenceSha256=sha(args.reference),
              output=args.out, outputSha256=sha(args.out), geometry='unchanged (only the base colour image is replaced)')
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('MATCH_DONE', json.dumps({k: report[k] for k in ('mode', 'medianSrgb')}))
