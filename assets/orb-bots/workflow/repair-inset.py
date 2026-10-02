"""Repair a mistaken inset using the surrounding reconstructed surface.

No sphere/primitive is fitted or substituted. A local polynomial interpolates
the unchanged neighbourhood around the painted reference eyes; the existing
mesh topology is relaxed inside that small mask and its depth is corrected.
"""
import bpy
import numpy as np

def repair(obj, reference, base):
    original = base.positions_of(obj.data)
    height = float(np.ptp(original[:, 2]))
    centre = (original.min(0) + original.max(0)) * .5
    p = (original - centre) / height
    image = bpy.data.images.load(str(reference), check_existing=True)
    w, h = image.size
    pixels = np.empty(w * h * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    yy, xx = np.nonzero(pixels[:, :, 3] > .9)
    bounds = [xx.min(), xx.max(), yy.min(), yy.max()]
    dark = (pixels[:, :, :3].max(2) < .2) & (pixels[:, :, 3] > .9)
    boxes = []
    for left in [True, False]:
        side = np.arange(w)[None, :] < (bounds[0] + bounds[1]) * .5
        y, x = np.nonzero(dark & (side if left else ~side))
        boxes.append([float((x.min()-bounds[0])/(bounds[1]-bounds[0])-.5),
                      float((x.max()-bounds[0])/(bounds[1]-bounds[0])-.5),
                      float((y.min()-bounds[2])/(bounds[3]-bounds[2])-.5),
                      float((y.max()-bounds[2])/(bounds[3]-bounds[2])-.5)])
    weight = np.zeros(len(p))
    for x0, x1, z0, z1 in boxes:
        dx = np.maximum.reduce([x0-p[:, 0], p[:, 0]-x1, np.zeros(len(p))])
        dz = np.maximum.reduce([z0-p[:, 2], p[:, 2]-z1, np.zeros(len(p))])
        d = np.maximum(dx, dz)
        t = np.clip((d-.018)/.060, 0, 1)
        weight = np.maximum(weight, 1-t*t*(3-2*t))
    weight[p[:, 1] > -.2] = 0
    assert np.count_nonzero(weight) < len(p) * .18, 'Keep the repair local to the two eyes'
    powers = [(i, j) for degree in range(5) for i in range(degree+1) for j in [degree-i]]
    def design(points):
        return np.column_stack([points[:, 0]**i * points[:, 2]**j for i, j in powers])
    surround = (weight < .001) & (p[:, 1] < -.22) & (np.abs(p[:, 0]) < .42) & (np.abs(p[:, 2]) < .27)
    assert surround.sum() > 1000
    matrix = design(p[surround])
    values = p[surround, 1]
    coefficients = np.linalg.lstsq(matrix, values, rcond=None)[0]
    # Reject unrelated surface noise from the interpolation neighbourhood.
    for _ in range(3):
        residual = matrix @ coefficients - values
        keep = np.abs(residual) < max(.0015, float(np.quantile(np.abs(residual), .94)))
        coefficients = np.linalg.lstsq(matrix[keep], values[keep], rcond=None)[0]
    src, dst, counts = base.neighbour_arrays(obj.data)
    q = p.copy()
    for _ in range(30):
        q += .35 * weight[:, None] * base.laplacian(q, src, dst, counts)
    target_y = design(q) @ coefficients
    q[:, 1] += weight * (target_y - q[:, 1])
    changed = np.linalg.norm(q-p, axis=1) * height
    assert np.max(changed) < height * .075, 'Do not reshape the whole bot'
    result = q * height + centre
    result[weight == 0] = original[weight == 0]
    obj.data.vertices.foreach_set('co', result.astype(np.float32).ravel())
    obj.data.update()
    return dict(method='Local depth repair interpolated from the unchanged TRELLIS neighbourhood; existing topology relaxed inside reference-eye masks',
                boxesNormalized=boxes, affectedVertices=int(np.count_nonzero(changed > 1e-8)),
                totalVertices=len(p), maxDisplacementAt28cm=float(changed.max()/height*.28),
                unchangedOutsideMask=bool(np.array_equal(result[weight == 0], original[weight == 0])),
                fittedPrimitive=False)
