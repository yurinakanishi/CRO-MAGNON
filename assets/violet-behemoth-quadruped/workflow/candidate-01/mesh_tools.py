"""Shared numpy-only mesh inspection helpers for this candidate run.

Reuses the repository's glb_metrics parser so the numbers describe the actual
exported bytes rather than a Blender scene.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
try:
    from scipy import ndimage
    from scipy.spatial import cKDTree
except ModuleNotFoundError:
    ndimage = None
    cKDTree = None

REPO = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(REPO / 'trellis.cpp' / 'tools'))

from glb_metrics import gather_geometry, parse_glb  # noqa: E402


def load_geometry(path):
    gltf, bin_data = parse_glb(str(path))
    notes = []
    P, UV, F, n_prims = gather_geometry(gltf, bin_data, notes)
    return dict(gltf=gltf, bin=bin_data, P=P, UV=UV, F=F, primitives=n_prims, notes=notes)


def weld_positions(P, F, eps=1e-6):
    """Merge exactly-coincident positions (quantised by eps) and drop degenerate faces."""
    keys = np.round(P / eps).astype(np.int64)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = np.asarray(inverse).reshape(-1)
    count = int(inverse.max()) + 1
    sums = np.zeros((count, 3), dtype=np.float64)
    hits = np.zeros(count, dtype=np.int64)
    np.add.at(sums, inverse, P)
    np.add.at(hits, inverse, 1)
    Pw = sums / hits[:, None]
    Fw = inverse[F]
    keep = (Fw[:, 0] != Fw[:, 1]) & (Fw[:, 1] != Fw[:, 2]) & (Fw[:, 0] != Fw[:, 2])
    return Pw, Fw[keep]


def triangle_areas(P, F):
    a = P[F[:, 1]] - P[F[:, 0]]
    b = P[F[:, 2]] - P[F[:, 0]]
    return 0.5 * np.linalg.norm(np.cross(a, b), axis=1)


def sample_surface(P, F, count, seed=0):
    rng = np.random.default_rng(seed)
    area = triangle_areas(P, F)
    total = area.sum()
    if total <= 0:
        return P.copy()
    probability = area / total
    picks = rng.choice(len(F), size=count, p=probability)
    u = rng.random(count)
    v = rng.random(count)
    flip = u + v > 1.0
    u[flip] = 1.0 - u[flip]
    v[flip] = 1.0 - v[flip]
    tri = P[F[picks]]
    return tri[:, 0] + u[:, None] * (tri[:, 1] - tri[:, 0]) + v[:, None] * (tri[:, 2] - tri[:, 0])


def point_to_mesh_distance(points, P, F, samples=400000, seed=1):
    """Symmetric-ready one-way distance: query points against a dense surface sampling."""
    if cKDTree is None:
        raise RuntimeError('point_to_mesh_distance requires SciPy')
    cloud = np.vstack([P, sample_surface(P, F, samples, seed=seed)])
    tree = cKDTree(cloud)
    distance, _ = tree.query(points, k=1)
    return distance


def laplacian_roughness(P, F):
    """Mean/RMS distance of each vertex from the centroid of its 1-ring, in edge-length units."""
    edges = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    edges = np.vstack([edges, edges[:, ::-1]])
    order = np.lexsort((edges[:, 1], edges[:, 0]))
    edges = edges[order]
    unique = np.ones(len(edges), dtype=bool)
    unique[1:] = np.any(edges[1:] != edges[:-1], axis=1)
    edges = edges[unique]
    sums = np.zeros_like(P)
    counts = np.zeros(len(P), dtype=np.int64)
    np.add.at(sums, edges[:, 0], P[edges[:, 1]])
    np.add.at(counts, edges[:, 0], 1)
    valid = counts > 0
    centroid = np.zeros_like(P)
    centroid[valid] = sums[valid] / counts[valid][:, None]
    delta = np.linalg.norm(P[valid] - centroid[valid], axis=1)
    edge_length = np.linalg.norm(P[edges[:, 0]] - P[edges[:, 1]], axis=1)
    mean_edge = float(edge_length.mean()) if len(edge_length) else 1.0
    return dict(
        mean_edge_length=mean_edge,
        laplacian_mean=float(delta.mean()),
        laplacian_rms=float(np.sqrt((delta ** 2).mean())),
        laplacian_p99=float(np.percentile(delta, 99)),
        laplacian_mean_ratio=float(delta.mean() / mean_edge) if mean_edge else 0.0,
    )


VIEWS = dict(
    front=(2, 1, 0, 1),
    rear=(2, -1, 0, -1),
    right=(0, 1, 2, -1),
    left=(0, -1, 2, 1),
    top=(1, 1, 0, 1),
    bottom=(1, -1, 0, -1),
)


def project_view(points, view, bounds, size):
    """Orthographic projection of world points into pixel coordinates."""
    depth_axis, depth_sign, horiz_axis, horiz_sign = VIEWS[view]
    vert_axis = 3 - depth_axis - horiz_axis
    lo, hi = bounds
    span = float(max(hi - lo))
    if span <= 0:
        span = 1.0
    span *= 1.04
    centre = (lo + hi) * 0.5
    x = (points[:, horiz_axis] - centre[horiz_axis]) * horiz_sign
    y = points[:, vert_axis] - centre[vert_axis]
    if depth_axis == 1:
        y = y * depth_sign
    u = np.clip(((x / span + 0.5) * (size - 1)).astype(np.int64), 0, size - 1)
    v = np.clip(((0.5 - y / span) * (size - 1)).astype(np.int64), 0, size - 1)
    return u, v


def silhouette_mask(points, view, bounds, size=256, close=2):
    mask = np.zeros((size, size), dtype=bool)
    u, v = project_view(points, view, bounds, size)
    mask[v, u] = True
    if close > 0:
        if ndimage is None:
            raise RuntimeError('silhouette morphology requires SciPy')
        structure = np.ones((close * 2 + 1, close * 2 + 1), dtype=bool)
        mask = ndimage.binary_closing(mask, structure=structure)
        mask = ndimage.binary_fill_holes(mask)
    return mask


def silhouette_iou(P_a, F_a, P_b, F_b, size=256, samples=1500000, seed=13):
    points_a = np.vstack([P_a, sample_surface(P_a, F_a, samples, seed=seed)])
    points_b = np.vstack([P_b, sample_surface(P_b, F_b, samples, seed=seed + 1)])
    bounds = (np.minimum(P_a.min(axis=0), P_b.min(axis=0)),
              np.maximum(P_a.max(axis=0), P_b.max(axis=0)))
    result = dict()
    for view in VIEWS:
        ma = silhouette_mask(points_a, view, bounds, size=size)
        mb = silhouette_mask(points_b, view, bounds, size=size)
        union = int(np.logical_or(ma, mb).sum())
        inter = int(np.logical_and(ma, mb).sum())
        result[view] = float(inter / union) if union else 1.0
    result['mean'] = float(np.mean([result[v] for v in VIEWS]))
    return result
