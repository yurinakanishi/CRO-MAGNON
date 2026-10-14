"""Evens a fur region of a baked atlas toward its own dominant colour (CIELAB, the variation kept in part).

TRELLIS-2 can paint light pink streaks into a brown fur cape where the reference has fur highlights and stitches
(the chibi bear girl, 2026-10-13); the reference colour restore then lightens them further. Only the texels of the
faces whose centroid lies in --region (dense units of LOW_ATLAS.glb, the xatlas atlas the bake used) and whose hue is
in --hue (degrees, may wrap) change: each moves toward the median of the region's proper fur (saturation at least
--fur-sat, value at most --fur-val), keeping --keep of its lightness and --chroma-keep of its a*/b* difference. The
dress under the cape (another hue), the belt and the hem stay as they are.

  python scripts/remake/even_fur.py COLOURED.glb LOW_ATLAS.glb OUT.glb --region X0:X1:Y0:Y1:Z0:Z1 [--hue 340,25]
      [--keep 0.45] [--chroma-keep 0.6] [--fur-sat 0.4] [--fur-val 0.7]

Only the base colour image of material 0 is replaced (WebP q92). Writes OUT.glb and OUT.json.
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
ap.add_argument('low')
ap.add_argument('out')
ap.add_argument('--region', required=True)
ap.add_argument('--hue', default='340,25')
ap.add_argument('--keep', type=float, default=0.45)
ap.add_argument('--chroma-keep', type=float, default=0.6)
ap.add_argument('--fur-sat', type=float, default=0.4)
ap.add_argument('--fur-val', type=float, default=0.7)
ap.add_argument('--target', default='', help='R,G,B: move toward this sRGB colour (e.g. the reference pelt) instead of the '
                "region's own proper fur median")
ap.add_argument('--min-sat', type=float, default=0.0, help='only texels at least this saturated move (leaves cream trims)')
ap.add_argument('--webp-quality', type=int, default=92)
args = ap.parse_args()

low = Glb(args.low)
prim = low.doc['meshes'][0]['primitives'][0]
P = low.accessor(prim['attributes']['POSITION']).astype(np.float64)
UV = low.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
F = low.accessor(prim['indices']).reshape(-1, 3)
v = [float(x) for x in args.region.split(':')]
c = P[F].mean(1)
faces = np.nonzero(np.all((c >= np.array(v[0:6:2])) & (c <= np.array(v[1:6:2])), axis=1))[0]

g = Glb(args.glb)
mat = g.doc['materials'][0]
image = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
alb = np.asarray(Image.open(io.BytesIO(g.image_bytes(image))).convert('RGB'), dtype=np.float32) / 255
AH, AW = alb.shape[:2]
region = np.zeros((AH, AW), np.uint8)
for f in faces:
    cv2.fillPoly(region, [(UV[F[f]] * [AW, AH] * 16).round().astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
hsv = cv2.cvtColor(alb, cv2.COLOR_RGB2HSV)
h0, h1 = (float(x) for x in args.hue.split(','))
hue = hsv[..., 0]
in_hue = ((hue >= h0) | (hue <= h1)) if h0 > h1 else ((hue >= h0) & (hue <= h1))
fur = (region > 0) & in_hue & (hsv[..., 1] >= args.min_sat)
proper = fur & (hsv[..., 1] >= args.fur_sat) & (hsv[..., 2] <= args.fur_val)
lab = cv2.cvtColor(alb, cv2.COLOR_RGB2LAB)
if args.target:
    target_rgb = np.array([float(x) for x in args.target.split(',')], np.float32) / 255.0
    target = cv2.cvtColor(target_rgb[None, None], cv2.COLOR_RGB2LAB)[0, 0]
else:
    target = np.median(lab[proper], axis=0)
evened = target + (lab - target) * np.array([args.keep, args.chroma_keep, args.chroma_keep], np.float32)
weight = cv2.GaussianBlur((fur * 1.0).astype(np.float32), (0, 0), 1.0)[..., None]
lab = lab * (1 - weight) + evened * weight
rgb = np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB), 0, 1)
buffer = io.BytesIO()
Image.fromarray((rgb * 255 + .5).astype(np.uint8)).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
view = g.doc['images'][image]['bufferView']
b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    b.add_view(buffer.getvalue() if i == view else g.view_bytes(i), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
b.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(script='scripts/remake/even_fur.py', source=args.glb, sourceSha256=sha(args.glb), low=args.low, output=args.out,
              outputSha256=sha(args.out), region=args.region, hue=args.hue, keep=args.keep, chromaKeep=args.chroma_keep,
              faces=int(len(faces)), furTexels=int(fur.sum()), properTexels=int(proper.sum()), targetLab=target.round(2).tolist(),
              targetSrgb=args.target or None, minSat=args.min_sat)
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('EVEN_DONE', json.dumps({k: report[k] for k in ('faces', 'furTexels', 'properTexels', 'targetLab')}))
