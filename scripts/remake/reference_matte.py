"""The subject matte of the original reference, from the BiRefNet cutout of a TRELLIS preparation (made from a
blank-face copy of it): the cutout composited on the reference background is matched to the reference by normalised
cross-correlation and its alpha moved onto the reference pixels.

  python scripts/remake/reference_matte.py REFERENCE.png PREPARED_DIR   (writes PREPARED_DIR/reference-mask.png)
"""
import json
import sys

import cv2
import numpy as np
from PIL import Image

reference, prepared = sys.argv[1:3]
ref = np.asarray(Image.open(reference).convert('RGB')).astype(np.float32)
cut = np.asarray(Image.open(f'{prepared}/birefnet_cutout.png').convert('RGBA')).astype(np.float32)
rgb, a = cut[..., :3], cut[..., 3] / 255
bg = np.median(np.concatenate([ref[:8].reshape(-1, 3), ref[-8:].reshape(-1, 3)]), 0)
comp = rgb * a[..., None] + bg * (1 - a[..., None])
H, W = ref.shape[:2]
grey = lambda im: cv2.cvtColor(im, cv2.COLOR_RGB2GRAY)  # noqa: E731
if comp.shape[0] >= H and comp.shape[1] >= W:
    _, best, _, (ox, oy) = cv2.minMaxLoc(cv2.matchTemplate(grey(comp), grey(ref), cv2.TM_CCOEFF_NORMED))
    mask = (a[oy:oy + H, ox:ox + W] > 0.5).astype(np.uint8) * 255
else:
    _, best, _, (ox, oy) = cv2.minMaxLoc(cv2.matchTemplate(grey(ref), grey(comp), cv2.TM_CCOEFF_NORMED))
    mask = np.zeros((H, W), np.uint8)
    mask[oy:oy + cut.shape[0], ox:ox + cut.shape[1]] = (a > 0.5) * 255
Image.fromarray(mask).save(f'{prepared}/reference-mask.png')
ys, xs = np.nonzero(mask)
print(json.dumps({'offset': [int(ox), int(oy)], 'ncc': round(float(best), 4),
                  'bbox': [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]}))
