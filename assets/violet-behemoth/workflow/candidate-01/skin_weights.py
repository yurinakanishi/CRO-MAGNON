"""Geodesic surface skinning for this candidate.

Blender's automatic weights fell back to distance envelopes for the small hand
bones in attempt-03.  In the reference A-pose the hands hang about 0.3 m from the
thighs through open air, so those envelopes reached across the gap and gave knee
and thigh vertices up to 0.44 Hand.L / Hand.R weight.  Every clip that moved an
arm then dragged ribbons of leg skin with it.

This solver never uses straight-line falloff.  A bone only reaches vertices that
are close to it *along the mesh surface*, so an air gap is an absolute barrier.

    1. weld positions and build the surface graph, bridging any detached shell;
    2. fit one capsule radius per bone so a short central bone such as Hips still
       owns the thick pelvis instead of losing it to the two thigh bones;
    3. keep the confidently-near part of each bone's region as its core;
    4. Dijkstra from every core over the surface graph;
    5. compact quadratic falloff on (geodesic - nearest geodesic);
    6. smooth opposite-side limb suppression;
    7. surface Laplacian smoothing so no edge carries a weight cliff;
    8. top-four clamp and normalisation to one.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))
import graph_tools as gt  # noqa: E402

LIMB_STEMS = ('Shoulder.', 'UpperArm.', 'LowerArm.', 'Hand.',
              'UpperLeg.', 'LowerLeg.', 'Foot.', 'Toe.')


def segment_distances(P, segments):
    """N x B Euclidean distance from every vertex to every bone segment."""
    out = np.empty((len(P), len(segments)), dtype=np.float64)
    for index, (_, head, tail) in enumerate(segments):
        ab = tail - head
        length2 = float(ab @ ab)
        if length2 < 1e-12:
            out[:, index] = np.linalg.norm(P - head, axis=1)
            continue
        t = np.clip((P - head) @ ab / length2, 0.0, 1.0)
        closest = head[None, :] + t[:, None] * ab[None, :]
        out[:, index] = np.linalg.norm(P - closest, axis=1)
    return out


def fit_radii(D, samples=300, cap=0.14, minimum=0.006):
    """Per-bone capsule radius: the median distance of its closest `samples` vertices.

    This measures the local body thickness around each bone without letting the
    bones compete, so it stays stable. Without it the thin vertical Hips bone
    loses the deep front of the pelvis and the tunic between the legs to
    UpperLeg.L/UpperLeg.R, which splits that band down the middle and tears it
    open as soon as the legs separate.
    """
    k = int(min(max(samples, 30), D.shape[0]))
    radii = np.empty(D.shape[1], dtype=np.float64)
    for index in range(D.shape[1]):
        nearest = np.partition(D[:, index], k - 1)[:k]
        radii[index] = float(np.clip(np.median(nearest), minimum, cap))
    return radii


def build_cores(Dm, core_fraction, core_floor):
    """Vertices that unambiguously belong to each bone, used as geodesic sources."""
    nearest = np.argmin(Dm, axis=1)
    cores = []
    stats = []
    for index in range(Dm.shape[1]):
        owned = np.nonzero(nearest == index)[0]
        if not len(owned):
            cores.append(np.array([int(np.argmin(Dm[:, index]))], dtype=np.int64))
            stats.append(dict(owned=0, core=1, core_limit_m=0.0))
            continue
        distances = Dm[owned, index]
        limit = max(core_floor, float(np.quantile(distances, core_fraction)))
        core = owned[distances <= limit]
        if not len(core):
            core = owned[np.argsort(distances)[:1]]
        cores.append(core.astype(np.int64))
        stats.append(dict(owned=int(len(owned)), core=int(len(core)),
                          core_limit_m=round(float(limit), 5)))
    return cores, nearest, stats


def opposite_side_gate(P, names, keep_full, fade_to):
    """Smooth 1 -> 0 ramp that suppresses a limb bone on the wrong side of the body."""
    gate = np.ones((len(P), len(names)), dtype=np.float64)
    x = P[:, 0]
    ramp = np.clip((np.abs(x) - keep_full) / max(fade_to - keep_full, 1e-9), 0.0, 1.0)
    for index, name in enumerate(names):
        if not name.startswith(LIMB_STEMS):
            continue
        wrong = (x < 0.0) if name.endswith('.L') else (x > 0.0)
        gate[wrong, index] = 1.0 - ramp[wrong]
    return gate


def laplacian_smooth(W, starts, neighbours, iterations, factor):
    """Umbrella smoothing of the weight field over the surface graph only."""
    if iterations <= 0:
        return W
    degree = np.diff(starts).astype(np.float64)
    degree[degree == 0.0] = 1.0
    rows = np.repeat(np.arange(len(W)), np.diff(starts))
    for _ in range(iterations):
        acc = np.zeros_like(W)
        np.add.at(acc, rows, W[neighbours])
        W = (1.0 - factor) * W + factor * (acc / degree[:, None])
        W = W / np.maximum(W.sum(axis=1, keepdims=True), 1e-12)
    return W


def solve(P, F, segments, radius=0.085, power=2.0, core_fraction=0.5,
          core_floor=0.010, bridge_radius=0.004, max_influences=4,
          side_keep_full=0.018, side_fade_to=0.06,
          smooth_iterations=10, smooth_factor=0.55):
    """Return (N x B weights, report) for the given welded mesh and bone segments."""
    names = [name for name, _, _ in segments]
    edges = gt.unique_edges(F)
    edges, bridge_report = gt.bridge_components(P, edges, bridge_radius)
    starts, neighbours = gt.adjacency(len(P), edges)

    D = segment_distances(P, segments)
    radii = fit_radii(D)
    Dm = D - radii[None, :]
    cores, nearest, core_stats = build_cores(Dm, core_fraction, core_floor)

    all_sources = np.concatenate(cores)
    all_labels = np.concatenate([np.full(len(core), index, dtype=np.int64)
                                 for index, core in enumerate(cores)])
    g_min, hard_label = gt.multi_source_dijkstra(P, starts, neighbours,
                                                 all_sources, all_labels)
    reach = float(np.max(g_min[np.isfinite(g_min)])) if np.isfinite(g_min).any() else 0.0
    cap = reach + radius * 1.05

    G = np.full((len(P), len(segments)), np.inf)
    for index, core in enumerate(cores):
        distance, _ = gt.multi_source_dijkstra(
            P, starts, neighbours, core, np.zeros(len(core), dtype=np.int64))
        distance[distance > cap] = np.inf
        G[:, index] = distance

    excess = G - g_min[:, None]
    W = np.clip(1.0 - excess / radius, 0.0, 1.0) ** power
    W[~np.isfinite(G)] = 0.0

    gate = opposite_side_gate(P, names, side_keep_full, side_fade_to)
    W = W * gate

    empty = W.sum(axis=1) <= 1e-12
    if empty.any():
        W[empty, hard_label[empty]] = 1.0
    W = W / W.sum(axis=1, keepdims=True)

    W = laplacian_smooth(W, starts, neighbours, smooth_iterations, smooth_factor)
    W = W * gate
    W = W / np.maximum(W.sum(axis=1, keepdims=True), 1e-12)

    dropped = int(((W > 1e-4).sum(axis=1) > max_influences).sum())
    if W.shape[1] > max_influences:
        keep = np.argsort(-W, axis=1)[:, :max_influences]
        clipped = np.zeros_like(W)
        rows = np.arange(len(W))[:, None]
        clipped[rows, keep] = W[rows, keep]
        W = clipped
    W[W < 1e-4] = 0.0
    W = W / W.sum(axis=1, keepdims=True)

    counts = (W > 0.0).sum(axis=1)
    report = dict(
        method=('geodesic surface skinning: fitted per-bone capsule radii, '
                'Euclidean-nearest cores, Dijkstra distance over the welded '
                'surface graph, compact quadratic falloff, smooth opposite-side '
                'limb gate and surface Laplacian weight smoothing'),
        falloff_radius_m=radius, falloff_power=power,
        core_quantile=core_fraction, core_floor_m=core_floor,
        smoothing=dict(iterations=smooth_iterations, factor=smooth_factor,
                       domain='mesh surface graph only'),
        surface_graph=dict(vertices=int(len(P)), edges=int(len(edges)), **bridge_report),
        geodesic_cap_m=round(cap, 5),
        max_distance_to_any_core_m=round(reach, 5),
        opposite_side_gate=dict(full_influence_below_m=side_keep_full,
                                zero_influence_above_m=side_fade_to),
        max_influences=max_influences,
        vertices_clipped_to_max=dropped,
        influence_histogram=dict((str(int(k)), int(v)) for k, v in
                                 zip(*np.unique(counts, return_counts=True))),
        weight_sum_min=round(float(W.sum(axis=1).min()), 9),
        weight_sum_max=round(float(W.sum(axis=1).max()), 9),
        bones=[dict(bone=names[i], capsule_radius_m=round(float(radii[i]), 5),
                    **core_stats[i]) for i in range(len(names))])
    return W, report


def weight_discontinuity(P, F, W, names, top=10):
    """Largest per-edge weight jump, the direct predictor of stretched skin."""
    edges = gt.unique_edges(F)
    delta = np.abs(W[edges[:, 0]] - W[edges[:, 1]]).sum(axis=1) * 0.5
    length = np.linalg.norm(P[edges[:, 0]] - P[edges[:, 1]], axis=1)
    order = np.argsort(-delta)[:top]

    def describe(v):
        return [[names[b], round(float(W[v, b]), 3)]
                for b in np.argsort(-W[v])[:4] if W[v, b] > 1e-3]

    return dict(max_edge_weight_jump=round(float(delta.max()), 5),
                p999_edge_weight_jump=round(float(np.percentile(delta, 99.9)), 5),
                p99_edge_weight_jump=round(float(np.percentile(delta, 99)), 5),
                mean_edge_weight_jump=round(float(delta.mean()), 6),
                edges_over_0p35=int((delta > 0.35).sum()),
                worst_edges=[dict(vertices=[int(edges[i, 0]), int(edges[i, 1])],
                                  jump=round(float(delta[i]), 4),
                                  length_m=round(float(length[i]), 5),
                                  midpoint=[round(float(c), 4) for c in
                                            (P[edges[i, 0]] + P[edges[i, 1]]) * 0.5],
                                  a=describe(int(edges[i, 0])),
                                  b=describe(int(edges[i, 1])))
                             for i in order])
