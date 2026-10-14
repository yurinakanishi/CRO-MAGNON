"""Chart-based UV unwrap of a reduced (positions-only) GLB with xatlas, packed for a given atlas size.

Smart UV on noisy reduced fur/foliage meshes splinters into thousands of 3-4 triangle islands that fill only a
small part of the atlas; xatlas grows charts over the whole surface and packs them tightly (the same unwrapper
TRELLIS uses). remake_process.py --low <this> --rebake --keep-low-uv then bakes albedo/normal onto these charts.

output/asset-remake/.venv-xatlas/Scripts/python.exe scripts/remake/xatlas_unwrap.py <in.glb> <out.glb> [--resolution 2048] [--padding 4]
(xatlas 0.0.11 wheel from PyPI, sha256 81431d19c3a11dc3fbae95460cd6b16239636b21fa7c30bd5796976a03844ede)
"""
import argparse
import json
import struct
import time
from pathlib import Path

import numpy as np
import xatlas

ap = argparse.ArgumentParser()
ap.add_argument('src')
ap.add_argument('dst')
ap.add_argument('--resolution', type=int, default=2048)
ap.add_argument('--padding', type=int, default=4)
ap.add_argument('--max-cost', type=float, default=2.0, help='xatlas ChartOptions.max_cost (larger = bigger charts)')
ap.add_argument('--boost', default='', help='AXIS:CUT:FACTOR, e.g. y:0.273:2 - faces whose centroid lies at or above CUT on AXIS '
                'are unwrapped as a separate part scaled by FACTOR, so their charts get FACTOR x the texel density (a face '
                'and head on a full-body character); output positions are unchanged, the cut becomes a UV seam')
ap.add_argument('--boost-box', default='', help='X0:X1:Y0:Y1:Z0:Z1:FACTOR - like --boost, for the faces whose centroid lies in this '
                'box (source units): a chibi face, whose painted eyes need more texels than the hair around them')
ap.add_argument('--select', default='', help='AXIS:CUT:above|below, e.g. y:0.273:above - unwrap only the faces whose centroid lies '
                'above (>=) or below (<) CUT on AXIS (a head and a body baked into separate atlases, joined later by merge_head.py)')
args = ap.parse_args()

data = Path(args.src).read_bytes()
jlen = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + jlen])
bin_off = 20 + jlen + 8


def read(index):
    a = doc['accessors'][index]
    v = doc['bufferViews'][a['bufferView']]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3}[a['type']]
    dt = {5126: np.float32, 5125: np.uint32, 5123: np.uint16}[a['componentType']]
    off = bin_off + v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return np.frombuffer(data, dtype=dt, count=a['count'] * comps, offset=off).reshape(-1, comps) if comps > 1 else \
        np.frombuffer(data, dtype=dt, count=a['count'], offset=off)


prim = doc['meshes'][0]['primitives'][0]
P = read(prim['attributes']['POSITION']).astype(np.float32)
F = read(prim['indices']).astype(np.uint32).reshape(-1, 3)
if args.select:
    axis, cut, side = args.select.split(':')
    centre = P[F].mean(axis=1)[:, 'xyz'.index(axis)]
    F = F[centre >= float(cut)] if side == 'above' else F[centre < float(cut)]
    used, local = np.unique(F, return_inverse=True)
    P, F = P[used], local.reshape(-1, 3).astype(np.uint32)
t0 = time.time()
atlas = xatlas.Atlas()
if args.boost or args.boost_box:
    if args.boost_box:
        values = [float(x) for x in args.boost_box.split(':')]
        lo_b, hi_b, factor = np.array(values[0:6:2]), np.array(values[1:6:2]), values[6]
        centroid = P[F].mean(axis=1)
        boosted = np.all((centroid >= lo_b) & (centroid <= hi_b), axis=1)
    else:
        axis, cut, factor = args.boost.split(':')
        column, cut, factor = 'xyz'.index(axis), float(cut), float(factor)
        boosted = P[F].mean(axis=1)[:, column] >= cut
    parts = [F[~boosted], F[boosted]]
    for k, part in enumerate(parts):
        used, local = np.unique(part, return_inverse=True)
        atlas.add_mesh(P[used] * (factor if k else 1.0), local.reshape(-1, 3).astype(np.uint32))
        parts[k] = used
else:
    atlas.add_mesh(P, F)
co = xatlas.ChartOptions()
co.max_cost = args.max_cost
po = xatlas.PackOptions()
po.resolution = args.resolution
po.padding = args.padding
po.bilinear = True
po.rotate_charts = True
po.bruteForce = False
atlas.generate(co, po)
seconds = time.time() - t0
if args.boost or args.boost_box:
    # each part's vertex map indexes its own (unscaled) vertex subset
    pieces = [atlas[k] for k in range(2)]
    P2 = np.concatenate([P[parts[k][vm]] for k, (vm, _, _) in enumerate(pieces)]).astype(np.float32)
    uv = np.concatenate([u for _, _, u in pieces]).astype(np.float32)
    offset = len(pieces[0][0])
    idx = np.concatenate([pieces[0][1].ravel(), pieces[1][1].ravel() + offset]).astype(np.uint32)
else:
    vmap, idx, uv = atlas[0]
    P2 = P[vmap].astype(np.float32)
    uv = uv.astype(np.float32)
    idx = idx.astype(np.uint32).ravel()
# UV coverage (triangle area sum in [0,1]^2)
tri = uv[idx.reshape(-1, 3)]
e1, e2 = tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]
tri_area = np.abs(e1[:, 0] * e2[:, 1] - e1[:, 1] * e2[:, 0]) / 2
area = float(tri_area.sum())
pos_b, uv_b, idx_b = P2.tobytes(), uv.tobytes(), idx.tobytes()
out = {
    'asset': {'version': '2.0', 'generator': 'scripts/remake/xatlas_unwrap.py'},
    'scene': 0, 'scenes': [{'nodes': [0]}], 'nodes': [{'mesh': 0, 'name': 'Reduced'}],
    'meshes': [{'primitives': [{'attributes': {'POSITION': 0, 'TEXCOORD_0': 1}, 'indices': 2}]}],
    'buffers': [{'byteLength': len(pos_b) + len(uv_b) + len(idx_b)}],
    'bufferViews': [
        {'buffer': 0, 'byteOffset': 0, 'byteLength': len(pos_b), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos_b), 'byteLength': len(uv_b), 'target': 34962},
        {'buffer': 0, 'byteOffset': len(pos_b) + len(uv_b), 'byteLength': len(idx_b), 'target': 34963},
    ],
    'accessors': [
        {'bufferView': 0, 'componentType': 5126, 'count': len(P2), 'type': 'VEC3',
         'min': P2.min(0).tolist(), 'max': P2.max(0).tolist()},
        {'bufferView': 1, 'componentType': 5126, 'count': len(uv), 'type': 'VEC2'},
        {'bufferView': 2, 'componentType': 5125, 'count': len(idx), 'type': 'SCALAR'},
    ],
}
js = json.dumps(out, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
binary = pos_b + uv_b + idx_b
binary += b'\0' * (-len(binary) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(binary)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
    + struct.pack('<II', len(binary), 0x004E4942) + binary
Path(args.dst).write_bytes(glb)
report = {'source': args.src, 'triangles': int(len(F)), 'vertices_in': int(len(P)), 'vertices_out': int(len(P2)),
          'charts': int(atlas.chart_count), 'atlas': [int(atlas.width), int(atlas.height)], 'utilization': float(atlas.utilization) if hasattr(atlas, 'utilization') else None,
          'uv_area_coverage': area, 'resolution': args.resolution, 'padding': args.padding, 'max_cost': args.max_cost, 'seconds': round(seconds, 1),
          'select': args.select or None, 'boost': ({'spec': args.boost or None, 'box': args.boost_box or None, 'boosted_triangles': int(boosted.sum()),
                     'boosted_uv_share': float(tri_area[pieces[0][1].size // 3:].sum() / area)} if args.boost or args.boost_box else None)}
Path(args.dst).with_suffix('.json').write_text(json.dumps(report, indent=2), newline='\n')
print('XATLAS_DONE', json.dumps(report))
