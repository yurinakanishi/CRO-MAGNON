"""Moves a standing character so that its feet, not its bounding box, are centred on the origin.

remake_process.py places a model ground-centred by its bounding box. A chibi whose hood, bob or tail reaches far
behind it (the chibi cast, 2026-10-13: 10-18 cm) then stands in front of its origin, which the game turns it about
and collides with. This moves every vertex by the horizontal centre of the soles (the vertices below --sole of the
height), before rigging (rig_human_c2.py puts the Root at the origin).

  python scripts/remake/centre_on_feet.py IN.glb OUT.glb [--sole 0.04]

Positions only (normals, UVs, materials and textures unchanged). Writes OUT.glb and OUT.json.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'face-remake'))
from glbio import Builder, Glb  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('glb')
ap.add_argument('out')
ap.add_argument('--sole', type=float, default=0.04, help='fraction of the height whose vertices are the soles')
args = ap.parse_args()

g = Glb(args.glb)
positions = {}
for mesh in g.doc['meshes']:
    for prim in mesh['primitives']:
        index = prim['attributes']['POSITION']
        positions[index] = g.accessor(index).astype(np.float64)
P = np.concatenate(list(positions.values()))
lo, hi = P[:, 1].min(), P[:, 1].max()
soles = P[P[:, 1] < lo + args.sole * (hi - lo)]
shift = np.array([-0.5 * (soles[:, 0].min() + soles[:, 0].max()), 0.0, -0.5 * (soles[:, 2].min() + soles[:, 2].max())])
replaced = {}
for index, points in positions.items():
    accessor = g.doc['accessors'][index]
    assert accessor['componentType'] == 5126 and not accessor.get('byteOffset'), 'a tightly packed float POSITION view'
    view = accessor['bufferView']
    assert view not in replaced, 'one view per POSITION accessor'
    moved = (points + shift).astype(np.float32)
    replaced[view] = moved.tobytes()
    accessor['min'] = moved.min(0).tolist()
    accessor['max'] = moved.max(0).tolist()
b = Builder(g.doc)
for i, vdef in enumerate(g.doc['bufferViews']):
    data = replaced.get(i, g.view_bytes(i))
    assert len(data) == len(g.view_bytes(i))
    b.add_view(data, vdef.get('target'))
    if 'byteStride' in vdef:
        b.doc['bufferViews'][-1]['byteStride'] = vdef['byteStride']
b.write(args.out)
sha = lambda p: hashlib.sha256(Path(p).read_bytes()).hexdigest()  # noqa: E731
report = dict(script='scripts/remake/centre_on_feet.py', source=args.glb, sourceSha256=sha(args.glb), output=args.out,
              outputSha256=sha(args.out), soleFraction=args.sole, soleVertices=int(len(soles)),
              shiftMetres=shift.round(5).tolist())
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print('CENTRED', json.dumps(report['shiftMetres']), int(len(soles)))
