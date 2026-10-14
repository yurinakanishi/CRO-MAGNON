"""Give the bare skin of a merged character body its own material, so a clothing dye never reaches it.

python scripts/remake/split_skin_material.py <merged.glb> <out.glb> --arm SX,SY,TX,TY --cuff 0.64
    [--legs Y0,Y1] [--neck Y0,Y1,R] [--body BodySurface] [--skin SkinSurface]

The runtime clothing dye (src/clothing-dye.ts) recolours a material's texels by their colour, keeping a skin
colour range. On the 2026-10-13 chibi Cro-Magnon woman, whose colours were brought back to the reference, the
hands (hue 30, saturation 0.29, value 1.0) have the colour of the cream fur cuffs and hem (hue 30, saturation
0.22-0.28): no colour range keeps one and dyes the other. The bare skin is therefore moved to a second
material, a copy of the body material with the same textures (one more draw call, no new image):
  hands  every face beyond --cuff of the shoulder-to-fingertip span (glTF metres in the A-pose: shoulder
         SX,SY to fingertip TX,TY, mirrored for the other arm);
  legs   faces between heights Y0 and Y1 (between the boot warmers and the hem) whose texture is mostly skin:
         seven samples per face vote skin (saturation 0.27-0.75, value above 0.6, hue below 30 or above
         330 degrees), cream fur (saturation below 0.27, value above 0.75) or dark (value below 0.6);
  neck   faces between heights Y0 and Y1 within R of the body axis whose texture is mostly skin.
Only the body primitive is split (both primitives share its vertex attributes); geometry and UVs are unchanged.
--tone R,G,B moves the skin texels under the new material (CIELAB mean, their variation kept) onto that sRGB colour:
the hands and legs of a TRELLIS bake, whose colours were matched to the reference as a whole, can stay more orange
than the painted face projected from the reference (give the face's own skin colour). Without it the textures are
unchanged. Writes OUT.glb and OUT.json.
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
ap.add_argument('out')
ap.add_argument('--arm', required=True, help='SX,SY,TX,TY: shoulder and fingertip of one arm (x, height) in metres')
ap.add_argument('--cuff', type=float, required=True, help='fraction of the shoulder-to-fingertip span where the hand leaves the sleeve')
ap.add_argument('--legs', default='', help='Y0,Y1: the bare-leg band')
ap.add_argument('--bare-arms', type=float, default=0.0, help='R metres: also the skin-coloured faces within R of the arm '
                'axis along the whole arm (a sleeveless dress: bare upper arms between the shoulder and fur cuffs, which keep '
                'their material); R small enough to leave the torso beside the arm (about 0.06)')
ap.add_argument('--neck', default='', help='Y0,Y1,R: the neck band and radius')
ap.add_argument('--body', default='BodySurface')
ap.add_argument('--skin', default='SkinSurface')
ap.add_argument('--tone', default='', help='R,G,B: sRGB colour the skin texels under the skin material move to (CIELAB mean)')
ap.add_argument('--tone-strength', type=float, default=1.0)
ap.add_argument('--webp-quality', type=int, default=92)
args = ap.parse_args()

g = Glb(args.glb)
doc = g.doc
assert len(doc['meshes']) == 1, 'one mesh expected'
mesh = doc['meshes'][0]
body_index = next(i for i, m in enumerate(doc['materials']) if m.get('name') == args.body)
k = next(i for i, p in enumerate(mesh['primitives']) if p.get('material') == body_index)
prim = mesh['primitives'][k]
P = g.accessor(prim['attributes']['POSITION']).astype(np.float64)
UV = g.accessor(prim['attributes']['TEXCOORD_0']).astype(np.float64)
F = g.accessor(prim['indices']).reshape(-1, 3).astype(np.int64)
mat = doc['materials'][body_index]
albedo = np.asarray(Image.open(io.BytesIO(g.image_bytes(g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])))).convert('RGB'),
                    dtype=np.float32) / 255.0
AH, AW = albedo.shape[:2]

centre = P[F].mean(axis=1)
# seven texture samples per face (its centroid, halfway to each corner, near each corner), each voted skin, fur
# (cream: saturation below 0.27, value above 0.75) or dark (value below 0.6: warmers, cords); a long thin face
# that runs from the skin into the fur goes with the majority
mid = UV[F].mean(axis=1)
samples = np.stack([mid] + [(UV[F][:, c] + mid) / 2 for c in range(3)] + [(3 * UV[F][:, c] + mid) / 4 for c in range(3)], axis=1)
px = np.clip((samples[..., 0] * AW).astype(int), 0, AW - 1)
py = np.clip((samples[..., 1] * AH).astype(int), 0, AH - 1)
hsv = cv2.cvtColor(albedo[py, px].astype(np.float32), cv2.COLOR_RGB2HSV)
h, s_, v = hsv[..., 0], hsv[..., 1], hsv[..., 2]
fur_vote = ((s_ < 0.27) & (v > 0.75)).sum(1)
dark_vote = (v < 0.6).sum(1)
skin_vote = ((s_ >= 0.27) & (s_ < 0.75) & (v >= 0.6) & ((h < 30) | (h > 330))).sum(1)
skin_colour = skin_vote > np.maximum(fur_vote, dark_vote)

sx, sy, tx, ty = map(float, args.arm.split(','))
hands = np.zeros(len(F), bool)
for sign in (1.0, -1.0):
    s = np.array([sign * sx, sy])
    axis = np.array([sign * tx, ty]) - s
    length = np.linalg.norm(axis)
    axis /= length
    rel = centre[:, [0, 1]] - s
    t = rel @ axis / length
    radial = np.abs(rel @ np.array([-axis[1], axis[0]]))
    hands |= (t > args.cuff) & (radial < 0.12) & (sign * centre[:, 0] > 0)
    if args.bare_arms:
        hands |= (t > 0.1) & (radial < args.bare_arms) & (sign * centre[:, 0] > 0) & skin_colour
legs = np.zeros(len(F), bool)
if args.legs:
    y0, y1 = map(float, args.legs.split(','))
    legs = (centre[:, 1] > y0) & (centre[:, 1] < y1) & skin_colour
neck = np.zeros(len(F), bool)
if args.neck:
    y0, y1, r = map(float, args.neck.split(','))
    neck = (centre[:, 1] > y0) & (centre[:, 1] < y1) & (np.hypot(centre[:, 0], centre[:, 2]) < r) & skin_colour
skin = hands | legs | neck

replaced = {}
tone = None
if args.tone:
    # the texels of the skin faces (their UV triangles, 2 px wider, feathered), skin-coloured ones only
    cover = np.zeros((AH, AW), np.uint8)
    for tri in UV[F[skin]]:
        cv2.fillPoly(cover, [np.round(tri * [AW, AH] * 16).astype(np.int32)], 1, lineType=cv2.LINE_8, shift=4)
    cover = cv2.dilate(cover, np.ones((5, 5), np.uint8))
    weight = cv2.GaussianBlur(cover.astype(np.float32), (0, 0), 1.5)
    hsv_img = cv2.cvtColor(albedo, cv2.COLOR_RGB2HSV)
    skin_like = ((hsv_img[..., 1] >= 0.15) & (hsv_img[..., 2] >= 0.5) &
                 ((hsv_img[..., 0] < 35) | (hsv_img[..., 0] > 330))).astype(np.float32)
    weight *= cv2.GaussianBlur(skin_like, (0, 0), 1.0)
    lab = cv2.cvtColor(albedo, cv2.COLOR_RGB2LAB)
    chosen = (cover > 0) & (skin_like > 0)
    before = np.median(lab[chosen], axis=0)
    target_rgb = np.array([float(x) for x in args.tone.split(',')], np.float32) / 255.0
    target = cv2.cvtColor(target_rgb[None, None], cv2.COLOR_RGB2LAB)[0, 0]
    lab = lab + (args.tone_strength * weight)[..., None] * (target - before)
    rgb = np.clip(cv2.cvtColor(lab.astype(np.float32), cv2.COLOR_LAB2RGB), 0, 1)
    image_index = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
    buffer = io.BytesIO()
    Image.fromarray((rgb * 255 + .5).astype(np.uint8)).save(buffer, 'WEBP', quality=args.webp_quality, method=6)
    assert doc['images'][image_index].get('mimeType') == 'image/webp', 'a WebP base colour image is expected'
    replaced[doc['images'][image_index]['bufferView']] = buffer.getvalue()
    tone = dict(targetSrgb=args.tone, strength=args.tone_strength, texels=int(chosen.sum()),
                beforeLab=before.round(2).tolist(), targetLab=target.round(2).tolist())

b = Builder(doc)
for i, vdef in enumerate(doc['bufferViews']):
    b.add_view(replaced.get(i, g.view_bytes(i)), vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
skin_material = json.loads(json.dumps(mat))
skin_material['name'] = args.skin
b.doc['materials'].append(skin_material)
skin_index = len(b.doc['materials']) - 1
body_prim = b.doc['meshes'][0]['primitives'][k]
skin_prim = json.loads(json.dumps(body_prim))
body_prim['indices'] = b.add_accessor(F[~skin].astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
skin_prim['indices'] = b.add_accessor(F[skin].astype(np.uint32).ravel(), 5125, 'SCALAR', 34963)
skin_prim['material'] = skin_index
b.doc['meshes'][0]['primitives'].insert(k + 1, skin_prim)
b.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(author='Claude Code (Opus 5.5)', script='scripts/remake/split_skin_material.py', source=args.glb, sourceSha256=sha(args.glb),
              output=args.out, outputSha256=sha(args.out), materials=[m.get('name') for m in b.doc['materials']],
              faces=dict(body=int((~skin).sum()), skin=int(skin.sum()), hands=int(hands.sum()), legs=int(legs.sum()), neck=int(neck.sum())),
              arm=args.arm, cuff=args.cuff, bareArms=args.bare_arms, legs=args.legs or None, neck=args.neck or None, tone=tone,
              geometry='unchanged (the body primitive split in two over the same vertex attributes)')
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('SPLIT_DONE', json.dumps(report['faces']), report['materials'])
