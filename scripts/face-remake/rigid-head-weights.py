"""Bind a humanoid's face and skull rigidly to the Head bone (2026-10-07 face remake, walk/run face distortion fix).

python scripts/face-remake/rigid-head-weights.py <in.glb> <out.glb> --prim 1 --jaw "z:y,z:y,..." [--blend .03] [--report r.json]

The jaw line is a piecewise-linear curve y_b(z) in the character's bind (rest) space, glTF axes (+Y up, +Z forward),
traced under the chin/beard at the front, under the jaw at the neck centre and along the nape at the back.
Head weight h = smoothstep((y - y_b(z)) / blend) is 1 above the curve, 0 below it. New skin weights are
(1 - h) * original + h * [Head], clamped to the four largest influences and renormalised, so:
  * every vertex at or above the curve follows the Head bone exactly (the face can no longer shear when the
    Neck or Chest rotate differently in Walk_Loop / Run_Loop),
  * the neck seam keeps its original weights, so it still matches the body primitive it is welded to.
Only the JOINTS_0 / WEIGHTS_0 bytes of the chosen primitive are rewritten in place; every other byte of the file,
including positions, normals, UVs, textures, the skeleton, inverse bind matrices and all clips, is unchanged.
"""
import argparse
import hashlib
import json
import struct
from pathlib import Path

import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--prim', type=int, default=1)
ap.add_argument('--jaw', required=True)
ap.add_argument('--blend', type=float, default=.03)
ap.add_argument('--bone', default='Head')
ap.add_argument('--report', default='')
args = ap.parse_args()

raw = bytearray(Path(args.src).read_bytes())
json_len = struct.unpack_from('<I', raw, 12)[0]
doc = json.loads(raw[20:20 + json_len])
bin_start = 20 + json_len + 8
COMP = {5121: ('u1', 1), 5123: ('<u2', 2), 5125: ('<u4', 4), 5126: ('<f4', 4)}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def view_of(accessor_id):
    a = doc['accessors'][accessor_id]
    v = doc['bufferViews'][a['bufferView']]
    dtype, size = COMP[a['componentType']]
    width = WIDTH[a['type']]
    stride = v.get('byteStride', size * width)
    start = bin_start + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return a, dtype, size, width, stride, start


def read(accessor_id):
    a, dtype, size, width, stride, start = view_of(accessor_id)
    out = np.empty((a['count'], width), dtype=np.float64)
    for i in range(a['count']):
        out[i] = np.frombuffer(raw, dtype=dtype, count=width, offset=start + i * stride)
    if a.get('normalized'):
        out /= {5121: 255.0, 5123: 65535.0}[a['componentType']]
    return out


def write(accessor_id, values):
    a, dtype, size, width, stride, start = view_of(accessor_id)
    values = np.asarray(values)
    if a.get('normalized'):
        scale = {5121: 255.0, 5123: 65535.0}[a['componentType']]
        values = np.round(values * scale)
    values = values.astype(np.dtype(dtype))
    for i in range(a['count']):
        raw[start + i * stride:start + i * stride + size * width] = values[i].tobytes()


mesh_node = next(n for n in doc['nodes'] if 'mesh' in n and 'skin' in n)
skin = doc['skins'][mesh_node['skin']]
names = [doc['nodes'][j].get('name', '') for j in skin['joints']]
head = names.index(args.bone)
prim = doc['meshes'][mesh_node['mesh']]['primitives'][args.prim]
attrs = prim['attributes']
P = read(attrs['POSITION'])
J = read(attrs['JOINTS_0']).astype(np.int64)
W = read(attrs['WEIGHTS_0'])
curve = np.array([[float(x) for x in pair.split(':')] for pair in args.jaw.split(',')])
curve = curve[np.argsort(curve[:, 0])]
yb = np.interp(P[:, 2], curve[:, 0], curve[:, 1])
t = np.clip((P[:, 1] - yb) / args.blend, 0.0, 1.0)
h = t * t * (3 - 2 * t)
dense = np.zeros((len(P), len(names)))
np.add.at(dense, (np.repeat(np.arange(len(P)), J.shape[1]), J.ravel()), W.ravel())
before_head = dense[:, head].copy()
dense *= (1.0 - h)[:, None]
dense[:, head] += h
order = np.argsort(-dense, axis=1)[:, :4]
picked = np.take_along_axis(dense, order, axis=1)
picked[picked < 1e-4] = 0.0
picked /= picked.sum(axis=1, keepdims=True)
order[picked == 0.0] = 0
# 8-bit or 16-bit normalized weights must still sum to exactly one after quantisation.
wa = doc['accessors'][attrs['WEIGHTS_0']]
if wa.get('normalized'):
    scale = {5121: 255, 5123: 65535}[wa['componentType']]
    q = np.round(picked * scale)
    q[np.arange(len(q)), 0] += scale - q.sum(axis=1)
    picked = q / scale
write(attrs['JOINTS_0'], order)
write(attrs['WEIGHTS_0'], picked)
Path(args.dst).write_bytes(bytes(raw))
after = np.zeros((len(P), len(names)))
np.add.at(after, (np.repeat(np.arange(len(P)), 4), order.ravel()), picked.ravel())
report = dict(
    source=args.src, output=args.dst, prim=args.prim, bone=args.bone, jaw=curve.tolist(), blend=args.blend,
    vertices=int(len(P)), rigid=int((h >= 1).sum()), blended=int(((h > 0) & (h < 1)).sum()), unchanged=int((h <= 0).sum()),
    headWeightMeanBefore=round(float(before_head.mean()), 4), headWeightMeanAfter=round(float(after[:, head].mean()), 4),
    sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw))
if args.report:
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report))
