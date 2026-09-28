"""NumPy-only surface-graph helpers: union-find, components, proximity bridging
and multi-source Dijkstra used by the geodesic skin-weight solver.
"""
from __future__ import annotations

import heapq

import numpy as np


def unique_edges(F):
    edges = np.vstack([F[:, [0, 1]], F[:, [1, 2]], F[:, [2, 0]]])
    edges = np.sort(edges, axis=1)
    edges = edges[edges[:, 0] != edges[:, 1]]
    return np.unique(edges, axis=0)


class UnionFind:
    def __init__(self, count):
        self.parent = np.arange(count, dtype=np.int64)

    def find(self, index):
        parent = self.parent
        root = index
        while parent[root] != root:
            root = parent[root]
        while parent[index] != root:
            parent[index], index = root, parent[index]
        return root

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra == rb:
            return False
        self.parent[rb] = ra
        return True


def components(count, edges):
    uf = UnionFind(count)
    for a, b in edges:
        uf.union(int(a), int(b))
    roots = np.array([uf.find(i) for i in range(count)], dtype=np.int64)
    _, labels = np.unique(roots, return_inverse=True)
    labels = np.asarray(labels).reshape(-1)
    return (int(labels.max()) + 1 if count else 0), labels


def proximity_pairs(P, radius):
    """All vertex pairs closer than radius, found with a uniform spatial hash."""
    keys = np.floor(P / radius).astype(np.int64)
    table = dict()
    for index, key in enumerate(map(tuple, keys)):
        table.setdefault(key, []).append(index)
    offsets = [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1)]
    pairs = set()
    radius2 = radius * radius
    for key, bucket in table.items():
        near = []
        for offset in offsets:
            other = (key[0] + offset[0], key[1] + offset[1], key[2] + offset[2])
            if other in table:
                near.extend(table[other])
        block = np.asarray(bucket, dtype=np.int64)
        near = np.asarray(near, dtype=np.int64)
        delta = P[block][:, None, :] - P[near][None, :, :]
        distance2 = np.einsum('ijk,ijk->ij', delta, delta)
        rows, cols = np.nonzero(distance2 <= radius2)
        for r, c in zip(rows, cols):
            a, b = int(block[r]), int(near[c])
            if a < b:
                pairs.add((a, b))
    return np.asarray(sorted(pairs), dtype=np.int64).reshape(-1, 2)


def bridge_components(P, edges, radius):
    """Add the shortest links needed to make the surface graph one component.

    Small detached shells left by reduction must stay reachable, or geodesic
    weighting cannot reach them at all.
    """
    count, labels = components(len(P), edges)
    if count <= 1:
        return edges, dict(components_before=count, bridges=0, forced_bridges=0,
                           max_bridge_m=0.0)
    before = count
    added = []
    for pair in proximity_pairs(P, radius):
        a, b = int(pair[0]), int(pair[1])
        if labels[a] != labels[b]:
            added.append((a, b))
    if added:
        edges = np.vstack([edges, np.asarray(added, dtype=np.int64)])
        count, labels = components(len(P), edges)
    forced = []
    while count > 1:
        sizes = np.bincount(labels)
        target = int(np.argmax(sizes))
        main = np.nonzero(labels == target)[0]
        best = None
        for other in range(count):
            if other == target:
                continue
            group = np.nonzero(labels == other)[0]
            sample = group if len(group) <= 300 else group[::max(1, len(group) // 300)]
            for v in sample:
                delta = P[main] - P[v]
                distance = np.einsum('ij,ij->i', delta, delta)
                index = int(distance.argmin())
                value = float(distance[index])
                if best is None or value < best[0]:
                    best = (value, int(v), int(main[index]))
        forced.append((best[1], best[2], float(np.sqrt(best[0]))))
        edges = np.vstack([edges, np.asarray([[best[1], best[2]]], dtype=np.int64)])
        count, labels = components(len(P), edges)
    lengths = [float(np.linalg.norm(P[a] - P[b])) for a, b in added]
    lengths.extend(item[2] for item in forced)
    return edges, dict(components_before=before, bridges=len(added) + len(forced),
                       forced_bridges=len(forced),
                       max_bridge_m=round(max(lengths), 5) if lengths else 0.0)


def adjacency(count, edges):
    both = np.vstack([edges, edges[:, ::-1]])
    order = np.argsort(both[:, 0], kind='stable')
    both = both[order]
    starts = np.searchsorted(both[:, 0], np.arange(count + 1))
    return starts, np.ascontiguousarray(both[:, 1])


def multi_source_dijkstra(P, starts, neighbours, sources, source_labels):
    """Geodesic distance and nearest-source label for every vertex."""
    count = len(P)
    distance = np.full(count, np.inf)
    label = np.full(count, -1, dtype=np.int64)
    heap = []
    for vertex, tag in zip(sources, source_labels):
        vertex = int(vertex)
        if distance[vertex] > 0.0:
            distance[vertex] = 0.0
            label[vertex] = int(tag)
            heap.append((0.0, vertex))
    heapq.heapify(heap)
    while heap:
        d, v = heapq.heappop(heap)
        if d > distance[v]:
            continue
        base = P[v]
        for index in range(starts[v], starts[v + 1]):
            u = int(neighbours[index])
            step = d + float(np.linalg.norm(base - P[u]))
            if step < distance[u]:
                distance[u] = step
                label[u] = label[v]
                heapq.heappush(heap, (step, u))
    return distance, label
