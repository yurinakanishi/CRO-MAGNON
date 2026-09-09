"""Shared rigid alignment + 1.80 m normalisation used by measurement and rigging.

The transform is: metre scale -> subtract the fitted body centre -> yaw about Z ->
lateral offset -> ground the soles -> put the origin midway between the feet.
Only rigid motion and one uniform scale are applied, so every vertex stays a
TRELLIS-derived vertex.
"""
import json
import math
from pathlib import Path

import numpy as np

TARGET_HEIGHT = 1.72


def load_alignment(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))


def positions(mesh):
    P = np.empty((len(mesh.vertices), 3), dtype=np.float64)
    mesh.vertices.foreach_get('co', P.reshape(-1))
    return P


def apply_alignment(mesh, alignment):
    """Scale, de-yaw and ground the mesh in place; return the applied parameters."""
    P, report = align_positions(positions(mesh), alignment)
    mesh.vertices.foreach_set('co', P.reshape(-1))
    mesh.update()
    return report


def align_positions(P, alignment):
    """Pure-numpy form of the same rigid transform, for out-of-Blender checks."""
    height_units = float(P[:, 2].max() - P[:, 2].min())
    scale = TARGET_HEIGHT / height_units
    P = P * scale
    P = P - np.array([0.0, 0.0, P[:, 2].min()])
    centre = np.array(alignment['body_centre_offset_metres'], dtype=np.float64)
    P = P - centre

    yaw = math.radians(alignment['correction']['yaw_degrees'])
    offset = float(alignment['correction']['x_offset_metres'])
    c = math.cos(-yaw)
    s = math.sin(-yaw)
    x = P[:, 0] * c - P[:, 1] * s - offset
    y = P[:, 0] * s + P[:, 1] * c
    P = np.stack([x, y, P[:, 2]], axis=1)

    # Ground the soles and place the origin midway between the two feet.
    zmin = float(P[:, 2].min())
    P[:, 2] -= zmin
    sole = P[P[:, 2] < 0.045 * TARGET_HEIGHT]
    left = sole[sole[:, 0] > 0.0]
    right = sole[sole[:, 0] < 0.0]
    fx = 0.5 * (0.5 * (left[:, 0].min() + left[:, 0].max())
                + 0.5 * (right[:, 0].min() + right[:, 0].max()))
    fy = 0.5 * (0.5 * (left[:, 1].min() + left[:, 1].max())
                + 0.5 * (right[:, 1].min() + right[:, 1].max()))
    P[:, 0] -= fx
    P[:, 1] -= fy

    return P, dict(
        target_height_m=TARGET_HEIGHT,
        source_height_units=height_units,
        uniform_scale=scale,
        yaw_correction_degrees=alignment['correction']['yaw_degrees'],
        lateral_offset_metres=offset,
        body_centre_offset_metres=[float(v) for v in centre],
        ground_shift_metres=-zmin,
        foot_midpoint_shift_metres=[float(-fx), float(-fy)],
        pivot='ground level, midway between the two sole centres, on the fitted symmetry plane',
        symmetry_iou=alignment['fitted']['iou'],
    )
