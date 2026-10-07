"""Mesh helpers for the face remake: welding, boundary loops, neck ring search, planar cut, components."""
from collections import defaultdict

import numpy as np


def weld_ids(P, tol=1e-5):
    key = np.round(P / tol).astype(np.int64)
    _, inv = np.unique(key, axis=0, return_inverse=True)
    return inv.reshape(-1)


def boundary_loops(P, F, tol=1e-5):
    """Ordered boundary loops as lists of original vertex ids (one representative per welded position)."""
    wid = weld_ids(P, tol)
    rep = np.zeros(wid.max() + 1, dtype=np.int64)
    rep[wid] = np.arange(len(P))
    Fw = wid[F]
    count = defaultdict(int)
    directed = {}
    for a, b, c in Fw:
        for u, v in ((a, b), (b, c), (c, a)):
            k = (min(u, v), max(u, v))
            count[k] += 1
            directed[(u, v)] = True
    nxt = defaultdict(list)
    for (u, v), _ in directed.items():
        if count[(min(u, v), max(u, v))] == 1:
            nxt[u].append(v)
    loops, used = [], set()
    for start in list(nxt):
        if start in used:
            continue
        loop, cur = [], start
        while cur not in used and nxt.get(cur):
            used.add(cur)
            loop.append(cur)
            cur = nxt[cur][0]
        if len(loop) >= 3 and cur == start:
            loops.append([int(rep[w]) for w in loop])
    return loops


def find_neck_ring(P, F, axis_xz, y_range, max_radius=0.12, max_offset=0.09):
    """The highest boundary loop of a body surface that winds once around its own centre near the neck axis."""
    best = None
    for loop in boundary_loops(P, F):
        Q = P[loop]
        if len(loop) < 8 or not (y_range[0] <= Q[:, 1].mean() <= y_range[1]):
            continue
        centre = Q[:, [0, 2]].mean(0)
        if np.linalg.norm(centre - np.asarray(axis_xz)) > max_offset:
            continue
        d = Q[:, [0, 2]] - centre
        if np.linalg.norm(d, axis=1).max() > max_radius:
            continue
        ang = np.arctan2(d[:, 1], d[:, 0])
        winding = abs(np.angle(np.exp(1j * (np.roll(ang, -1) - ang))).sum()) / (2 * np.pi)
        if winding < 0.8:
            continue
        if best is None or Q[:, 1].mean() > P[best][:, 1].mean():
            best = loop
    return best


def fit_plane(Q):
    c = Q.mean(0)
    _, _, vt = np.linalg.svd(Q - c)
    n = vt[2]
    if n[1] < 0:
        n = -n
    return c, n


def components(F, n_vertices, P=None, tol=1e-5):
    """Triangle connected components (through welded positions when P is given)."""
    ids = weld_ids(P, tol) if P is not None else np.arange(n_vertices)
    parent = np.arange(ids.max() + 1)

    def find(x):
        root = x
        while parent[root] != root:
            root = parent[root]
        while parent[x] != root:
            parent[x], x = root, parent[x]
        return root

    for a, b, c in ids[F]:
        ra, rb, rc = find(a), find(b), find(c)
        parent[rb] = ra
        parent[find(rc)] = ra
    roots = np.array([find(ids[f[0]]) for f in F])
    return roots


def clip_above_plane(P, attrs, F, c, n):
    """Keep the part of a triangle mesh where (p - c) . n >= 0, splitting crossing triangles exactly.
    attrs: list of per-vertex arrays interpolated linearly (normals renormalised by the caller)."""
    s = (P - c) @ n
    P = list(P)
    A = [list(a) for a in attrs]
    cache = {}

    def cut(i, j):
        key = (min(i, j), max(i, j))
        if key in cache:
            return cache[key]
        t = s[i] / (s[i] - s[j])
        P.append(P[i] + (P[j] - P[i]) * t)
        for a in A:
            a.append(a[i] + (a[j] - a[i]) * t)
        cache[key] = len(P) - 1
        return cache[key]

    out = []
    for tri in F:
        inside = s[tri] >= 0
        if inside.all():
            out.append(tri)
            continue
        if not inside.any():
            continue
        poly = []
        for k in range(3):
            i, j = tri[k], tri[(k + 1) % 3]
            if s[i] >= 0:
                poly.append(i)
            if (s[i] >= 0) != (s[j] >= 0):
                poly.append(cut(i, j))
        for k in range(1, len(poly) - 1):
            out.append([poly[0], poly[k], poly[k + 1]])
    P = np.array(P)
    A = [np.array(a) for a in A]
    used = np.unique(np.array(out).ravel())
    remap = -np.ones(len(P), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return P[used], [a[used] for a in A], remap[np.array(out)]


def visible_faces(P, F, directions=48, resolution=1536, eps_frac=0.006):
    """Faces seen from outside in at least one of `directions` orthographic views (front-most at their centroid and
    facing the view). Hidden inner shells (TRELLIS sometimes builds thin double walls) are never seen."""
    from raster import depth_buffer
    k = np.arange(directions) + 0.5
    phi = np.arccos(1 - 2 * k / directions)
    theta = np.pi * (1 + 5 ** 0.5) * k
    dirs = np.stack([np.cos(theta) * np.sin(phi), np.sin(theta) * np.sin(phi), np.cos(phi)], 1)
    centre = P.mean(0)
    radius = np.linalg.norm(P - centre, axis=1).max() * 1.01
    fn = np.cross(P[F[:, 1]] - P[F[:, 0]], P[F[:, 2]] - P[F[:, 0]])
    fn /= np.linalg.norm(fn, axis=1, keepdims=True) + 1e-12
    fc = P[F].mean(1)
    seen = np.zeros(len(F), bool)
    eps = eps_frac * radius
    for d in dirs:
        u = np.cross(d, [0, 1, 0] if abs(d[1]) < 0.9 else [1, 0, 0])
        u /= np.linalg.norm(u)
        v = np.cross(d, u)
        scale = resolution / (2 * radius)
        xy = np.stack([((P - centre) @ u + radius) * scale, ((P - centre) @ v + radius) * scale], 1)
        z = (P - centre) @ d
        depth, _ = depth_buffer(xy, z, F, resolution, resolution)
        cx = np.clip((((fc - centre) @ u + radius) * scale).astype(int), 0, resolution - 1)
        cy = np.clip((((fc - centre) @ v + radius) * scale).astype(int), 0, resolution - 1)
        front = ((fc - centre) @ d) >= depth[cy, cx] - eps
        # two-sided test: a face counts if either side looks at the camera (TRELLIS winding is not always consistent)
        seen |= front & (np.abs(fn @ d) > 0.05)
    return seen


def clip_by_values(P, attrs, F, s):
    """Keep where the per-vertex scalar s >= 0, splitting crossing triangles at the linear zero crossing.
    Returns positions, attributes, faces and a mask of vertices lying on the cut (new split vertices and s == 0)."""
    P = list(P)
    A = [list(a) for a in attrs]
    on = [bool(v == 0.0) for v in s]
    s = list(s)
    cache = {}

    def cut(i, j):
        key = (min(i, j), max(i, j))
        if key in cache:
            return cache[key]
        t = s[i] / (s[i] - s[j])
        P.append(P[i] + (P[j] - P[i]) * t)
        for a in A:
            a.append(a[i] + (a[j] - a[i]) * t)
        s.append(0.0)
        on.append(True)
        cache[key] = len(P) - 1
        return cache[key]

    out = []
    for tri in F:
        inside = [s[k] >= 0 for k in tri]
        if all(inside):
            out.append(list(tri))
            continue
        if not any(inside):
            continue
        poly = []
        for k in range(3):
            i, j = tri[k], tri[(k + 1) % 3]
            if s[i] >= 0:
                poly.append(i)
            if (s[i] >= 0) != (s[j] >= 0):
                poly.append(cut(i, j))
        for k in range(1, len(poly) - 1):
            out.append([poly[0], poly[k], poly[k + 1]])
    P = np.array(P)
    A = [np.array(a) for a in A]
    on = np.array(on)
    used = np.unique(np.array(out).ravel())
    remap = -np.ones(len(P), dtype=np.int64)
    remap[used] = np.arange(len(used))
    return P[used], [a[used] for a in A], remap[np.array(out)], on[used]
