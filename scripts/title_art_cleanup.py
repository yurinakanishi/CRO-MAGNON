"""Local speck cleanup for the supplied title illustration, at source resolution."""

import numpy as np
from PIL import Image, ImageFilter


def components(mask):
    height, width = mask.shape
    seen = np.zeros(mask.shape, dtype=bool)
    for y, x in zip(*np.nonzero(mask)):
        if seen[y, x]:
            continue
        pending = [(int(y), int(x))]
        seen[y, x] = True
        points = []
        while pending:
            py, px = pending.pop()
            points.append((py, px))
            for ny, nx in ((py - 1, px), (py + 1, px), (py, px - 1), (py, px + 1)):
                if (0 <= ny < height and 0 <= nx < width
                        and mask[ny, nx] and not seen[ny, nx]):
                    seen[ny, nx] = True
                    pending.append((ny, nx))
        yield np.array(points)


def clean_specks(rgba):
    result = rgba.copy()
    rgb = rgba[:, :, :3]
    height, width = rgba.shape[:2]
    bright = (rgb.min(2) > 205) & (rgb.max(2).astype(int) - rgb.min(2) < 60)
    protected_faces = np.zeros((height, width), dtype=bool)
    for x0, y0, x1, y1 in ((735, 155, 810, 230), (425, 355, 515, 445),
                            (905, 270, 985, 345), (1035, 335, 1135, 420),
                            (95, 440, 220, 560), (1210, 270, 1330, 375)):
        protected_faces[y0:y1, x0:x1] = True
    cleaned = 0
    for points in components(bright):
        if len(points) > 70:
            continue
        ys, xs = points.T
        y0, y1, x0, x1 = ys.min(), ys.max(), xs.min(), xs.max()
        if y1 >= 690 or y1 - y0 > 16 or x1 - x0 > 16:
            continue
        if protected_faces[ys, xs].any() or np.mean(rgba[ys, xs, 3] > 240) < .9:
            continue
        yy0, yy1 = max(0, y0 - 3), min(height, y1 + 4)
        xx0, xx1 = max(0, x0 - 3), min(width, x1 + 4)
        local = rgb[yy0:yy1, xx0:xx1]
        opaque = rgba[yy0:yy1, xx0:xx1, 3]
        samples = local[(~bright[yy0:yy1, xx0:xx1]) & (opaque > 250)]
        if len(samples) < 12:
            continue
        color = np.median(samples, axis=0)
        if color.min() > 190:
            continue
        # Blend the antialiased rim too, avoiding white rings around each repair.
        patch_mask = np.zeros(local.shape[:2], dtype=np.uint8)
        patch_mask[ys - yy0, xs - xx0] = 255
        patch = Image.fromarray(patch_mask)
        grow1 = np.asarray(patch.filter(ImageFilter.MaxFilter(3))) > 0
        grow2 = np.asarray(patch.filter(ImageFilter.MaxFilter(5))) > 0
        blend = np.maximum(grow1 * .85, grow2 * .35)
        blend[patch_mask > 0] = 1
        blend *= ((local.mean(2) > color.mean() + 12) & (opaque > 240)
                  & ~protected_faces[yy0:yy1, xx0:xx1])
        target = result[yy0:yy1, xx0:xx1, :3]
        target[:] = np.rint(target * (1 - blend[:, :, None])
                           + color * blend[:, :, None]).astype(np.uint8)
        cleaned += 1
    detached = 0
    removed = 0
    for points in components(result[:, :, 3] > 8):
        if len(points) <= 28:
            ys, xs = points.T
            result[ys, xs, 3] = 0
            detached += 1
            removed += len(points)
    changed = np.any(result[:, :, :3] != rgb, axis=2)
    assert changed.mean() < .03
    assert not changed[690:].any()
    assert not changed[protected_faces].any()
    assert np.all(result[:, :, 3] <= rgba[:, :, 3])
    return result, {
        'retouchedBrightComponents': cleaned,
        'retouchedRgbPixels': int(changed.sum()),
        'originalRgbUnchangedFraction': float(1 - changed.mean()),
        'detachedComponentsRemoved': detached,
        'alphaPixelsRemoved': removed,
        'facesAndLetteringRgbPreserved': True,
    }
