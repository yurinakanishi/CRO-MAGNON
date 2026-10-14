"""A copy of a painted anime reference whose eyes, brows, cheek paint, nose and mouth are filled with the
surrounding skin, for TRELLIS-2: the painted eyes of an anime face reconstruct as recesses 2-3 cm deep with
lash ridges, a featureless face as a smooth surface. The painted face of the original reference is
projected onto the low-poly head afterwards (project_face.py).

  python scripts/remake/blank_face.py REFERENCE.png OUT_DIR --regions "U,V,RX,RY;..." \
      --skin-boxes "X0,X1,Y0,Y1;..." --hair-boxes "X0,X1,Y0,Y1;..." --face U,V,RX,RY

The mask starts at the pixels of the --regions ellipses that are farther than --de (CIELAB) from the
median skin of the --skin-boxes, grows through such pixels within --limit times the ellipses, never takes
hair-coloured pixels (within --hair-de of the median colour of any of the --hair-boxes) outside --free times the
ellipses, fills its holes (eye highlights) and is dilated by --dilate pixels for the anti-aliased edges.
The fill is a per-channel quadratic colour field fitted to the visible skin inside the --face ellipse,
blended with a Gaussian edge of --blur pixels. Writes OUT_DIR/<name>-blankface.png, blankface-mask.png,
blankface-crop.png (the face, enlarged) and blankface.json.
"""
import argparse
import hashlib
import json
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


def boxes(spec):
    return [tuple(int(float(x)) for x in part.split(',')) for part in filter(None, spec.split(';'))]


def ellipses(spec):
    return [tuple(float(x) for x in part.split(',')) for part in filter(None, spec.split(';'))]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
ap.add_argument('reference')
ap.add_argument('out')
ap.add_argument('--regions', required=True, help='U,V,RX,RY[;...] feature ellipses in reference pixels')
ap.add_argument('--skin-boxes', required=True, help='X0,X1,Y0,Y1[;...] plain skin samples')
ap.add_argument('--hair-boxes', required=True, help='X0,X1,Y0,Y1[;...] plain hair samples')
ap.add_argument('--face', required=True, help='U,V,RX,RY ellipse of the face whose skin is fitted')
ap.add_argument('--force', default='', help='U,V,RX,RY[;...] ellipses filled whole, hair excepted: a soft blush is too close '
                'to the skin for --de, and its leftover pink patches reconstruct as cheek bumps')
ap.add_argument('--de', type=float, default=12)
ap.add_argument('--hair-de', type=float, default=16)
ap.add_argument('--limit', type=float, default=1.4)
ap.add_argument('--free', type=float, default=1.15)
ap.add_argument('--dilate', type=int, default=3)
ap.add_argument('--blur', type=float, default=2.0)
ap.add_argument('--skin-fit-de', type=float, default=10)
ap.add_argument('--fill-mode', default='field', choices=['field', 'residual'],
                help='field: the fitted quadratic skin colour; residual: that field plus a harmonic (Laplace) fill of the '
                'difference between the real skin and the field around the mask, so the fill meets the local shading '
                'without a visible oval edge (hair and lashes on the edge count as no difference)')
ap.add_argument('--crop', default='', help='X0,Y0,X1,Y1 of the preview crop (default: around the face ellipse)')
args = ap.parse_args()

out = Path(args.out)
out.mkdir(parents=True, exist_ok=True)
ref = np.asarray(Image.open(args.reference).convert('RGB')).astype(np.float32) / 255
H, W = ref.shape[:2]
lab = cv2.cvtColor(ref, cv2.COLOR_RGB2LAB)
yy, xx = np.mgrid[0:H, 0:W]


def median_lab(spec):
    return np.median(np.concatenate([lab[y0:y1, x0:x1].reshape(-1, 3) for x0, x1, y0, y1 in boxes(spec)]), 0)


skin = median_lab(args.skin_boxes)
# every hair box is its own colour (shadowed and highlighted locks differ by more than --hair-de)
hairs = [median_lab(f'{x0},{x1},{y0},{y1}') for x0, x1, y0, y1 in boxes(args.hair_boxes)]
dE = np.linalg.norm(lab - skin, axis=2)
dH = np.min([np.linalg.norm(lab - hair, axis=2) for hair in hairs], axis=0)
regions = ellipses(args.regions)
core = np.zeros((H, W), bool)
limit = np.zeros((H, W), bool)
free = np.zeros((H, W), bool)
for cu, cv_, rx, ry in regions:
    e = ((xx - cu) / rx) ** 2 + ((yy - cv_) / ry) ** 2
    core |= (e < 1) & (dE > args.de)
    limit |= e < args.limit ** 2
    free |= e < args.free ** 2
protected = (dH < args.hair_de) & ~free  # hair colour outside the features' own ellipses
nonskin = (dE > args.de) & limit & ~protected
mask = core & ~protected
k = np.ones((3, 3), np.uint8)
while True:
    grown = (cv2.dilate(mask.astype(np.uint8), k).astype(bool) & nonskin) | mask
    if grown.sum() == mask.sum():
        break
    mask = grown
for cu, cv_, rx, ry in ellipses(args.force):
    mask |= ((((xx - cu) / rx) ** 2 + ((yy - cv_) / ry) ** 2) < 1) & ~protected
    limit |= (((xx - cu) / rx) ** 2 + ((yy - cv_) / ry) ** 2) < 1.15 ** 2
filled = mask.astype(np.uint8).copy()
contours, _ = cv2.findContours(filled, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
cv2.drawContours(filled, contours, -1, 1, thickness=-1)
size = 2 * args.dilate + 1
mask = (cv2.dilate(filled, np.ones((size, size), np.uint8)).astype(bool) & limit
        & ~cv2.dilate(protected.astype(np.uint8), np.ones((3, 3), np.uint8)).astype(bool))

fu, fv, frx, fry = map(float, args.face.split(','))
face = ((xx - fu) / frx) ** 2 + ((yy - fv) / fry) ** 2 < 1
skinpx = face & (dE < args.skin_fit_de) & ~mask
X = np.c_[np.ones(skinpx.sum()), xx[skinpx], yy[skinpx], xx[skinpx] ** 2, xx[skinpx] * yy[skinpx], yy[skinpx] ** 2]
Xall = np.stack([np.ones_like(xx), xx, yy, xx ** 2, xx * yy, yy ** 2], -1).astype(np.float64)
field = np.zeros(ref.shape, np.float64)
for c in range(3):
    coef, *_ = np.linalg.lstsq(X.astype(np.float64), ref[..., c][skinpx].astype(np.float64), rcond=None)
    field[..., c] = Xall @ coef
if args.fill_mode == 'residual':
    ring = cv2.dilate(mask.astype(np.uint8), np.ones((5, 5), np.uint8)).astype(bool) & ~mask
    residual = ref.astype(np.float64) - field
    residual[ring & (dE >= args.skin_fit_de * 1.5)] = 0
    ys_, xs_ = np.nonzero(mask | ring)
    y0, y1, x0, x1 = ys_.min() - 1, ys_.max() + 2, xs_.min() - 1, xs_.max() + 2
    sub = residual[y0:y1, x0:x1].copy()
    inside = mask[y0:y1, x0:x1]
    sub[inside] = 0
    for _ in range(3000):
        avg = (np.roll(sub, 1, 0) + np.roll(sub, -1, 0) + np.roll(sub, 1, 1) + np.roll(sub, -1, 1)) / 4
        sub[inside] = avg[inside]
    field[y0:y1, x0:x1][inside] += sub[inside]
alpha = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), args.blur)
alpha = np.maximum(alpha, mask * 1.0)[..., None]
img = (np.clip(ref * (1 - alpha) + field * alpha, 0, 1) * 255 + .5).astype(np.uint8)

name = Path(args.reference).stem
blank = out / f'{name}-blankface.png'
Image.fromarray(img).save(blank)
Image.fromarray((mask * 255).astype(np.uint8)).save(out / 'blankface-mask.png')
if args.crop:
    x0, y0, x1, y1 = map(int, args.crop.split(','))
else:
    x0, y0, x1, y1 = int(fu - 1.25 * frx), int(fv - 1.6 * fry), int(fu + 1.25 * frx), int(fv + 1.3 * fry)
pair = np.concatenate([(ref[y0:y1, x0:x1] * 255).astype(np.uint8), img[y0:y1, x0:x1]], 1)
Image.fromarray(pair).resize((pair.shape[1] * 2, pair.shape[0] * 2), Image.LANCZOS).save(out / 'blankface-crop.png')
record = {
    'source': str(Path(args.reference)).replace('\\', '/'),
    'sourceSha256': sha(args.reference),
    'output': {'path': str(blank).replace('\\', '/'), 'sha256': sha(blank)},
    'seedEllipses_uv_rx_ry': regions,
    'forcedEllipses_uv_rx_ry': ellipses(args.force),
    'skinBoxes': boxes(args.skin_boxes), 'hairBoxes': boxes(args.hair_boxes),
    'skinLab': skin.round(2).tolist(), 'hairLab': [hair.round(2).tolist() for hair in hairs],
    'maskPixels': int(mask.sum()), 'skinFitPixels': int(skinpx.sum()),
    'mask': f'pixels farther than dE {args.de} (CIELAB) from the median skin, grown from the ellipses within '
            f'{args.limit}x of them; hair-coloured pixels (dE<{args.hair_de} from the median of any hair box) outside '
            f'{args.free}x of the ellipses are never taken; holes filled, dilated {args.dilate} px',
    'fill': f'per-channel quadratic colour field fitted to the visible face skin (dE<{args.skin_fit_de} inside the '
            f'face ellipse {args.face})'
            + (', plus a harmonic fill (3000 Jacobi steps) of the skin-minus-field difference on the mask edge'
               if args.fill_mode == 'residual' else '')
            + f', blended with a {args.blur} px Gaussian edge',
}
(out / 'blankface.json').write_text(json.dumps(record, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'out': str(blank), 'maskPixels': record['maskPixels'], 'skinFitPixels': record['skinFitPixels'],
                  'sha256': record['output']['sha256']}))
