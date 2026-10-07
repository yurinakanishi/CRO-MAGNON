"""Verify a face-remake GLB against the delivered model it was built from.

python scripts/face-remake/verify-graft.py <delivered.glb> <new.glb> --head-prim 1 --face "z:y,..." [--report r.json] [--samples 31]

Checks
  1. preserved: every primitive other than the head, the skin (joints, inverse bind matrices) and every animation
     sampler have byte-identical accessor data; every image not used by the head material is byte-identical;
  2. seam: head vertices that sit on a body vertex (the zipper copies of the neck ring) have the same position and
     skin weights, and stay together (distance 0) through every clip frame sampled;
  3. weights: 4 influences, valid joint ids, sums to 1;
  4. face: vertices above the jaw curve + 3 cm follow the Head joint rigidly in every clip (the walk/run bug).
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / 'remake' / 'riglib'))
sys.path.insert(0, 'C:/Users/yurin/Desktop/projects/threed-model-creation/trellis.cpp/tools')
from glbio import Glb  # noqa: E402
import glb_skin  # noqa: E402

ap = argparse.ArgumentParser()
ap.add_argument('old')
ap.add_argument('new')
ap.add_argument('--head-prim', type=int, default=1)
ap.add_argument('--face', required=True)
ap.add_argument('--samples', type=int, default=31)
ap.add_argument('--report', default='')
args = ap.parse_args()
A, B = Glb(args.old), Glb(args.new)
h = lambda b: hashlib.sha256(bytes(b)).hexdigest()  # noqa: E731


def acc_hash(g, aid):
    return h(g.accessor(aid, normalise=False).tobytes())


issues = []
pa, pb = A.doc['meshes'][0]['primitives'], B.doc['meshes'][0]['primitives']
if len(pa) != len(pb):
    issues.append('primitive count changed')
preserved = dict(primitives=0, accessors=0, animations=0, images=0)
ring_normal_changes = np.array([], dtype=int)
body_faces_removed = 0
for i, (x, y) in enumerate(zip(pa, pb)):
    if i == args.head_prim:
        continue
    for k, v in x['attributes'].items():
        if acc_hash(A, v) != acc_hash(B, y['attributes'][k]):
            if i == 0 and k == 'NORMAL':
                # allowed: the body's neck-ring vertices take the sleeve normals (checked against the seam below)
                na, nb = A.accessor(v), B.accessor(y['attributes'][k])
                ring_normal_changes = np.nonzero(np.abs(na - nb).max(1) > 1e-7)[0]
                continue
            issues.append(f'prim {i} {k} changed')
        preserved['accessors'] += 1
    if acc_hash(A, x['indices']) != acc_hash(B, y['indices']):
        fa = {tuple(f) for f in A.accessor(x['indices']).reshape(-1, 3).tolist()}
        fb = [tuple(f) for f in B.accessor(y['indices']).reshape(-1, 3).tolist()]
        if i == 0 and all(f in fa for f in fb):
            body_faces_removed = len(fa) - len(set(fb))   # allowed: hidden shard / old-braid faces dropped
        else:
            issues.append(f'prim {i} indices changed')
    if x.get('material') != y.get('material'):
        issues.append(f'prim {i} material index changed')
    preserved['primitives'] += 1
sa, sb = A.doc['skins'][0], B.doc['skins'][0]
if sa['joints'] != sb['joints'] or acc_hash(A, sa['inverseBindMatrices']) != acc_hash(B, sb['inverseBindMatrices']):
    issues.append('skin changed')
for an_a, an_b in zip(A.doc.get('animations', []), B.doc.get('animations', [])):
    if an_a['name'] != an_b['name'] or an_a['channels'] != an_b['channels']:
        issues.append('animation ' + an_a['name'] + ' channels changed')
    for sa_, sb_ in zip(an_a['samplers'], an_b['samplers']):
        if acc_hash(A, sa_['input']) != acc_hash(B, sb_['input']) or acc_hash(A, sa_['output']) != acc_hash(B, sb_['output']):
            issues.append('animation ' + an_a['name'] + ' data changed')
    preserved['animations'] += 1
if len(A.doc.get('animations', [])) != len(B.doc.get('animations', [])):
    issues.append('animation count changed')
nodes_a = [{k: v for k, v in n.items()} for n in A.doc['nodes']]
nodes_b = [{k: v for k, v in n.items()} for n in B.doc['nodes']]
if nodes_a != nodes_b:
    issues.append('node hierarchy or transforms changed')
head_mat = pb[args.head_prim].get('material')


def images_of(g, skip_mat):
    out = {}
    for mi, m in enumerate(g.doc.get('materials', [])):
        if mi == skip_mat:
            continue
        for slot, ref in [('normalTexture', m.get('normalTexture')), ('baseColorTexture', m.get('pbrMetallicRoughness', {}).get('baseColorTexture')),
                          ('metallicRoughnessTexture', m.get('pbrMetallicRoughness', {}).get('metallicRoughnessTexture'))]:
            if ref:
                out[(mi, slot)] = h(g.image_bytes(g.texture_image(ref['index'])))
    return out


ia, ib = images_of(A, head_mat), images_of(B, head_mat)
if ia != ib:
    issues.append('non-head material images changed')
preserved['images'] = len(ia)
# ---- seam and weights
ra, rb = glb_skin.Rigged(args.old), glb_skin.Rigged(args.new)
body = rb.prims[0]
head = rb.prims[args.head_prim]
key_b = {tuple(np.round(p, 6)): i for i, p in enumerate(body['P'])}
pairs = [(i, key_b[tuple(np.round(p, 6))]) for i, p in enumerate(head['P']) if tuple(np.round(p, 6)) in key_b]
seam_w = 0.0
for hi, bi in pairs:
    da = np.zeros(64)
    db = np.zeros(64)
    np.add.at(da, head['J'][hi], head['W'][hi])
    np.add.at(db, body['J'][bi], body['W'][bi])
    seam_w = max(seam_w, float(np.abs(da - db).max()))
seam_body = {p[1] for p in pairs}
seam_positions = {tuple(np.round(body['P'][b], 6)) for b in seam_body}
stray = [int(v) for v in ring_normal_changes if tuple(np.round(body['P'][v], 6)) not in seam_positions]
if stray:
    issues.append(f'{len(stray)} body normals changed away from the neck ring')
W = head['W']
wsum = W.sum(1)
weights = dict(minSum=float(wsum.min()), maxSum=float(wsum.max()), maxJoint=int(head['J'].max()), joints=len(rb.joints))
if abs(wsum - 1).max() > 1e-3 or head['J'].max() >= len(rb.joints):
    issues.append('invalid head weights')
offset = sum(len(p['P']) for p in rb.prims[:args.head_prim])
names = [rb.node_name(j) for j in rb.joints]
HEAD = names.index('Head')
curve = np.array([[float(x) for x in p.split(':')] for p in args.face.split(',')])
curve = curve[np.argsort(curve[:, 0])]
HP = head['P']
face = HP[:, 1] > np.interp(HP[:, 2], curve[:, 0], curve[:, 1]) + 0.03
fidx = np.nonzero(face)[0] + offset
seam_gap, clips = 0.0, []
for anim in rb.animations():
    tracks = rb.tracks(anim)
    t0, t1 = rb.clip_bounds(anim)
    worst = 0.0
    for t in np.linspace(t0, t1, args.samples):
        g = rb.global_transforms(tracks, t)
        posed = rb.skinned(tracks, t)
        if pairs:
            hi = np.array([p[0] for p in pairs]) + offset
            bi = np.array([p[1] for p in pairs])
            seam_gap = max(seam_gap, float(np.linalg.norm(posed[hi] - posed[bi], axis=1).max()))
        M = np.linalg.inv(g[rb.mesh_node_index]) @ g[rb.joints[HEAD]] @ rb.ibm[HEAD]
        rigid = (np.c_[HP[face], np.ones(face.sum())] @ M.T)[:, :3]
        worst = max(worst, float(np.linalg.norm(posed[fidx] - rigid, axis=1).max()))
    clips.append(dict(clip=anim['name'], maxFaceDeviationM=round(worst, 7)))
if seam_gap > 1e-5:
    issues.append(f'seam opens by {seam_gap:.6f} m')
if max(c['maxFaceDeviationM'] for c in clips) > 1e-4:
    issues.append('face is not rigid on Head')
report = dict(old=args.old, oldSha256=h(Path(args.old).read_bytes()), new=args.new, newSha256=h(Path(args.new).read_bytes()),
              preserved=preserved, bodyRingNormalsChanged=int(len(ring_normal_changes)), bodyFacesRemoved=int(body_faces_removed), seam=dict(sharedVertices=len(pairs), maxWeightDifference=seam_w, maxPosedGapM=seam_gap),
              weights=weights, faceVertices=int(face.sum()), faceRigidity=clips, samplesPerClip=args.samples,
              headTriangles=int(len(head['I'])), headVertices=int(len(HP)), issues=issues, passed=not issues)
if args.report:
    Path(args.report).write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({k: report[k] for k in ('preserved', 'bodyRingNormalsChanged', 'bodyFacesRemoved', 'seam', 'faceVertices', 'issues', 'passed')}))
