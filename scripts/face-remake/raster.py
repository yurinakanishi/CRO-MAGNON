"""Small numba triangle rasterisers for the face remake (screen depth and UV-space barycentrics)."""
import numpy as np
from numba import njit


@njit(cache=True)
def depth_buffer(xy, z, faces, width, height):
    """Orthographic front view: largest z wins (camera on +Z looking toward -Z). Returns depth and triangle id."""
    depth = np.full((height, width), -1e9, dtype=np.float64)
    tri = np.full((height, width), -1, dtype=np.int64)
    for f in range(faces.shape[0]):
        a, b, c = faces[f, 0], faces[f, 1], faces[f, 2]
        x0, y0, x1, y1, x2, y2 = xy[a, 0], xy[a, 1], xy[b, 0], xy[b, 1], xy[c, 0], xy[c, 1]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-12:
            continue
        lo_x = max(int(np.floor(min(x0, x1, x2))), 0)
        hi_x = min(int(np.ceil(max(x0, x1, x2))), width - 1)
        lo_y = max(int(np.floor(min(y0, y1, y2))), 0)
        hi_y = min(int(np.ceil(max(y0, y1, y2))), height - 1)
        for py in range(lo_y, hi_y + 1):
            for px in range(lo_x, hi_x + 1):
                sx, sy = px + 0.5, py + 0.5
                w0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / den
                w1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / den
                w2 = 1.0 - w0 - w1
                if w0 < -1e-6 or w1 < -1e-6 or w2 < -1e-6:
                    continue
                d = w0 * z[a] + w1 * z[b] + w2 * z[c]
                if d > depth[py, px]:
                    depth[py, px] = d
                    tri[py, px] = f
    return depth, tri


@njit(cache=True)
def uv_raster(uvpix, faces, width, height):
    """Per-texel triangle id and barycentrics in UV space (first triangle wins; atlases do not overlap)."""
    tri = np.full((height, width), -1, dtype=np.int64)
    bary = np.zeros((height, width, 3), dtype=np.float64)
    for f in range(faces.shape[0]):
        a, b, c = faces[f, 0], faces[f, 1], faces[f, 2]
        x0, y0, x1, y1, x2, y2 = uvpix[a, 0], uvpix[a, 1], uvpix[b, 0], uvpix[b, 1], uvpix[c, 0], uvpix[c, 1]
        den = (y1 - y2) * (x0 - x2) + (x2 - x1) * (y0 - y2)
        if abs(den) < 1e-14:
            continue
        lo_x = max(int(np.floor(min(x0, x1, x2))) - 1, 0)
        hi_x = min(int(np.ceil(max(x0, x1, x2))) + 1, width - 1)
        lo_y = max(int(np.floor(min(y0, y1, y2))) - 1, 0)
        hi_y = min(int(np.ceil(max(y0, y1, y2))) + 1, height - 1)
        for py in range(lo_y, hi_y + 1):
            for px in range(lo_x, hi_x + 1):
                sx, sy = px + 0.5, py + 0.5
                w0 = ((y1 - y2) * (sx - x2) + (x2 - x1) * (sy - y2)) / den
                w1 = ((y2 - y0) * (sx - x2) + (x0 - x2) * (sy - y2)) / den
                w2 = 1.0 - w0 - w1
                if w0 < -1e-4 or w1 < -1e-4 or w2 < -1e-4:
                    continue
                if tri[py, px] < 0:
                    tri[py, px] = f
                    bary[py, px, 0] = w0
                    bary[py, px, 1] = w1
                    bary[py, px, 2] = w2
    return tri, bary


def dilate(image, valid, rounds):
    """Push valid texel colours outward into empty texels (seam padding)."""
    image = image.copy()
    valid = valid.copy()
    for _ in range(rounds):
        acc = np.zeros_like(image)
        cnt = np.zeros(valid.shape)
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1), (1, 1), (-1, -1), (1, -1), (-1, 1)):
            shifted_v = np.roll(np.roll(valid, dy, 0), dx, 1)
            shifted_i = np.roll(np.roll(image, dy, 0), dx, 1)
            acc += shifted_i * shifted_v[..., None]
            cnt += shifted_v
        grow = (~valid) & (cnt > 0)
        if not grow.any():
            break
        image[grow] = acc[grow] / cnt[grow][:, None]
        valid = valid | grow
    return image, valid
