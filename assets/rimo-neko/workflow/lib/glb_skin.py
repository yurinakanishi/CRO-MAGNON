"""Read the exact exported GLB bytes and evaluate its skinned animation.

Everything here comes out of the shipped file: hierarchy, inverse bind matrices,
per-vertex joints and weights, and the sampled clip playback used for contact,
loop-closure and deformation checks.
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parents[6]
sys.path.insert(0, str(REPO / 'trellis.cpp' / 'tools'))

from glb_metrics import parse_glb, read_accessor  # noqa: E402


def quaternion_matrix(q):
    x, y, z, w = q
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w), 0.0],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w), 0.0],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y), 0.0],
        [0.0, 0.0, 0.0, 1.0]])


def trs_matrix(translation, rotation, scale):
    matrix = quaternion_matrix(rotation)
    matrix[:3, :3] = matrix[:3, :3] * np.asarray(scale).reshape(1, 3)
    matrix[:3, 3] = translation
    return matrix


def node_local(node):
    if 'matrix' in node:
        return np.asarray(node['matrix'], dtype=np.float64).reshape(4, 4).T
    return trs_matrix(np.asarray(node.get('translation', [0.0, 0.0, 0.0]), dtype=np.float64),
                      np.asarray(node.get('rotation', [0.0, 0.0, 0.0, 1.0]), dtype=np.float64),
                      np.asarray(node.get('scale', [1.0, 1.0, 1.0]), dtype=np.float64))


def slerp(a, b, t):
    dot = float(np.dot(a, b))
    if dot < 0.0:
        b = -b
        dot = -dot
    if dot > 0.9995:
        result = a + t * (b - a)
        return result / np.linalg.norm(result)
    theta = np.arccos(np.clip(dot, -1.0, 1.0))
    return (np.sin((1 - t) * theta) * a + np.sin(t * theta) * b) / np.sin(theta)


class Sampler:
    def __init__(self, times, values, interpolation, path):
        self.times = times
        self.values = values
        self.interpolation = interpolation
        self.path = path

    def pick(self, index):
        if self.interpolation == 'CUBICSPLINE':
            return self.values[index * 3 + 1]
        return self.values[index]

    def evaluate(self, time):
        times = self.times
        if time <= times[0]:
            return self.pick(0)
        if time >= times[-1]:
            return self.pick(len(times) - 1)
        index = int(np.searchsorted(times, time) - 1)
        span = times[index + 1] - times[index]
        t = 0.0 if span <= 0 else (time - times[index]) / span
        if self.interpolation == 'STEP':
            return self.pick(index)
        a = self.pick(index)
        b = self.pick(index + 1)
        if self.path == 'rotation':
            return slerp(a, b, t)
        return a + (b - a) * t


class Rigged:
    """Skinned playback of one exported GLB."""

    def __init__(self, path):
        self.path = Path(path)
        self.raw = self.path.read_bytes()
        self.gltf, self.bin = parse_glb(str(path))
        self.mesh_node_index, self.mesh_node = self._skinned_node()
        self.skin_index = self.mesh_node['skin']
        self.skin = self.gltf['skins'][self.skin_index]
        self.joints = self.skin['joints']
        ibm = read_accessor(self.gltf, self.bin,
                            self.skin['inverseBindMatrices']).reshape(-1, 4, 4)
        self.ibm = np.transpose(ibm, (0, 2, 1))
        self.prims = self._primitives(self.mesh_node['mesh'])
        self.rest = self.skinned(None, 0.0)

    def _skinned_node(self):
        for index, node in enumerate(self.gltf['nodes']):
            if 'mesh' in node and 'skin' in node:
                return index, node
        raise SystemExit('no skinned mesh node found in ' + str(self.path))

    def _read(self, accessor):
        return read_accessor(self.gltf, self.bin, accessor)

    def _primitives(self, mesh_index):
        prims = []
        for prim in self.gltf['meshes'][mesh_index]['primitives']:
            attrs = prim['attributes']
            entry = dict(
                P=self._read(attrs['POSITION'])[:, :3].astype(np.float64),
                I=self._read(prim['indices']).reshape(-1, 3).astype(np.int64),
                J=self._read(attrs['JOINTS_0']).astype(np.int64),
                W=self._read(attrs['WEIGHTS_0']).astype(np.float64),
                material=prim.get('material'))
            entry['N'] = (self._read(attrs['NORMAL'])[:, :3].astype(np.float64)
                          if 'NORMAL' in attrs else None)
            entry['UV'] = (self._read(attrs['TEXCOORD_0'])[:, :2].astype(np.float64)
                           if 'TEXCOORD_0' in attrs else None)
            prims.append(entry)
        return prims

    def tracks(self, animation):
        found = dict()
        for channel in animation['channels']:
            target = channel['target']
            node = target.get('node')
            if node is None:
                continue
            sampler = animation['samplers'][channel['sampler']]
            times = self._read(sampler['input']).reshape(-1).astype(np.float64)
            values = self._read(sampler['output']).astype(np.float64)
            path = target['path']
            if path == 'rotation':
                values = values.reshape(-1, 4)
            elif path in ('translation', 'scale'):
                values = values.reshape(-1, 3)
            else:
                values = values.reshape(len(times), -1)
            found.setdefault(node, dict())[path] = Sampler(
                times, values, sampler.get('interpolation', 'LINEAR'), path)
        return found

    def global_transforms(self, tracks, time):
        nodes = self.gltf['nodes']
        children_of = dict()
        is_child = set()
        for index, node in enumerate(nodes):
            kids = node.get('children', [])
            children_of[index] = kids
            is_child.update(kids)
        roots = [i for i in range(len(nodes)) if i not in is_child]
        out = [None] * len(nodes)

        def local(index):
            node = nodes[index]
            track = tracks.get(index) if tracks else None
            if not track:
                return node_local(node)
            translation = np.asarray(node.get('translation', [0.0, 0.0, 0.0]), dtype=np.float64)
            rotation = np.asarray(node.get('rotation', [0.0, 0.0, 0.0, 1.0]), dtype=np.float64)
            scale = np.asarray(node.get('scale', [1.0, 1.0, 1.0]), dtype=np.float64)
            if 'translation' in track:
                translation = track['translation'].evaluate(time)
            if 'rotation' in track:
                rotation = track['rotation'].evaluate(time)
            if 'scale' in track:
                scale = track['scale'].evaluate(time)
            return trs_matrix(translation, rotation, scale)

        stack = [(root, np.eye(4)) for root in roots]
        while stack:
            index, parent = stack.pop()
            matrix = parent @ local(index)
            out[index] = matrix
            for child in children_of[index]:
                stack.append((child, matrix))
        return out

    def skinned(self, tracks, time):
        globals_ = self.global_transforms(tracks, time)
        inverse = np.linalg.inv(globals_[self.mesh_node_index])
        matrices = np.stack([inverse @ globals_[j] @ self.ibm[i]
                             for i, j in enumerate(self.joints)])
        parts = []
        for prim in self.prims:
            P = prim['P']
            homogeneous = np.concatenate([P, np.ones((len(P), 1))], axis=1)
            out = np.zeros((len(P), 3), dtype=np.float64)
            for slot in range(prim['J'].shape[1]):
                transformed = np.einsum('nij,nj->ni', matrices[prim['J'][:, slot]],
                                        homogeneous)[:, :3]
                out = out + transformed * prim['W'][:, slot][:, None]
            parts.append(out)
        return np.vstack(parts)

    def animations(self):
        return self.gltf.get('animations', [])

    def clip_bounds(self, animation):
        times = [self._read(s['input']).reshape(-1) for s in animation['samplers']]
        return float(min(t.min() for t in times)), float(max(t.max() for t in times))

    def merged_faces(self):
        offset = 0
        parts = []
        for prim in self.prims:
            parts.append(prim['I'] + offset)
            offset += len(prim['P'])
        return np.vstack(parts)

    def merged_positions(self):
        return np.vstack([prim['P'] for prim in self.prims])

    def node_name(self, index):
        return self.gltf['nodes'][index].get('name', '')
