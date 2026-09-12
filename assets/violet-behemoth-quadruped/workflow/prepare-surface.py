"""Measured source-preserving reduction and rigid alignment of the new quadruped.

Only weld, floater removal, bounded speckle smoothing, QEM reduction, one rigid
yaw and one uniform metre scale touch the TRELLIS surface. Forward is Blender -Y
(glTF +Z), matching the other enemies.
"""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy, numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
p = argparse.ArgumentParser(); p.add_argument('--revision', default='01'); p.add_argument('--flip', action='store_true'); p.add_argument('--yaw', type=float)
args = p.parse_args(sys.argv[sys.argv.index('--')+1:])
model = ROOT/'output/model-generation/models/violet-behemoth-quadruped'
spec = json.loads((model/'request-spec.json').read_text(encoding='utf-8'))
sys.path.insert(0, str(model/'workflow/candidate-01'))
import blender_reduce as base
import blender_rig as rig
selected = json.loads((model/'work/trellis/selected-dense.json').read_text(encoding='utf-8')); dense = model/selected['path']
out = model/f'work/low-poly/revision-{args.revision}'; out.mkdir(parents=True, exist_ok=True); assert not (out/'candidate.glb').exists()
source = base.import_dense(dense); weld = base.weld(source); islands = base.drop_small_components(source, .02); base.triangulate(source)
P = base.positions_of(source.data); F = base.face_array(source.data); height = float(np.ptp(P[:, 2]))

# 1. Long body axis from the horizontal footprint (PCA), then mirror-symmetry refinement.
xy = P[:, :2] - P[:, :2].mean(0)
w, v = np.linalg.eigh(np.cov(xy.T)); major = v[:, np.argmax(w)]
pca = float(np.degrees(np.arctan2(major[0], major[1])))  # rotate major axis onto +Y
def rotate(q, angle_deg, offset=0.0):
    a = np.deg2rad(angle_deg); c, s = np.cos(a), np.sin(a); r = q.copy()
    r[:, 0] = q[:, 0]*c - q[:, 1]*s - offset; r[:, 1] = q[:, 0]*s + q[:, 1]*c; return r
centre = np.array([*P[:, :2].mean(0), 0.0])
Q = rotate(P - centre, pca)
cloud = Q[(Q[:, 2] > P[:, 2].min() + .25*height) & (Q[:, 2] < P[:, 2].min() + .85*height)]
rng = np.random.default_rng(901); cloud = cloud[rng.choice(len(cloud), min(len(cloud), 12000), replace=False)]
def score(angle, offset):
    q = rotate(cloud, angle, offset); vox = .012*height; k = np.floor(q/vox).astype(np.int64); o = k.copy(); o[:, 0] = np.floor(-q[:, 0]/vox).astype(np.int64)
    pack = lambda x: np.unique((x[:, 0]+4000)*100000000 + (x[:, 1]+4000)*10000 + x[:, 2]+4000)
    a, b = pack(k), pack(o); return len(np.intersect1d(a, b))/len(np.union1d(a, b))
# The reconstructed pose is asymmetric (staggered legs, head slightly turned), so a
# mirror fit is unreliable; align the spine line instead: centroids of the upper
# body in the two end slabs (excluding head and tail extremes).
upper = Q[Q[:, 2] > P[:, 2].min() + .5*height]
span = float(np.ptp(Q[:, 1])); y0 = Q[:, 1].min()
a = upper[(upper[:, 1] > y0 + .18*span) & (upper[:, 1] < y0 + .38*span)][:, :2].mean(0)
b = upper[(upper[:, 1] > y0 + .62*span) & (upper[:, 1] < y0 + .82*span)][:, :2].mean(0)
spine = float(np.degrees(np.arctan2(b[0]-a[0], b[1]-a[1])))
best = (score(spine, 0.0), spine, 0.0)
Q = rotate(Q, best[1], best[2])

# 2. Head end: the head/fang slab spans far more height than the stubby tail slab.
L = float(np.ptp(Q[:, 1])); ymin, ymax = Q[:, 1].min(), Q[:, 1].max()
slab = lambda lo, hi: Q[(Q[:, 1] >= lo) & (Q[:, 1] <= hi)]
lowEnd, highEnd = slab(ymin, ymin + .14*L), slab(ymax - .14*L, ymax)
spanLow, spanHigh = float(np.ptp(lowEnd[:, 2])), float(np.ptp(highEnd[:, 2]))
headAtHighY = spanHigh > spanLow
yaw = pca + best[1] + (180.0 if headAtHighY else 0.0) + (180.0 if args.flip else 0.0)
if args.yaw is not None: yaw = args.yaw

# 3. Bounded speckle removal, then the smallest QEM ratio inside the surface tolerances.
denoise = base.feature_weighted_taubin(source, 4, .55, -.56, .16, .0007, height)
P = base.positions_of(source.data); tree = base.bvh_from_arrays(P, F)
samples = base.sample_surface(P, F, 18000, 17); metres = spec['lengthMetres']/float(np.ptp(rotate(P-centre, yaw)[:, 1])); Hm = height*metres
trials = []; chosen = None
def metric(points, t):
    d = base.deviation(points, t, height); return {n: d[n+'_units']*metres for n in ['p95', 'rms', 'max']}
for ratio in [.06, .1, .16, .25, .4, .6, 1.0]:
    trial = source.copy(); trial.data = source.data.copy(); bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT'); trial.select_set(True); bpy.context.view_layer.objects.active = trial
    if ratio < 1:
        mod = trial.modifiers.new('SourceSurfaceQEM', 'DECIMATE'); mod.ratio = ratio; mod.use_collapse_triangulate = True; bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial); trial.data.validate(clean_customdata=False); trial.data.update()
    Qm = base.positions_of(trial.data); G = base.face_array(trial.data); qtree = base.bvh_from_arrays(Qm, G)
    forward = metric(samples, qtree); reverse = metric(base.sample_surface(Qm, G, 18000, 20), tree)
    passed = max(forward['p95'], reverse['p95']) <= Hm*.0012 and max(forward['max'], reverse['max']) <= Hm*.006
    trials.append(dict(ratio=ratio, triangles=len(G), denseToReduced=forward, reducedToDense=reverse, passed=passed)); print(json.dumps(trials[-1]), flush=True)
    if passed: chosen = trial; break
    mesh = trial.data; bpy.data.objects.remove(trial, do_unlink=True); bpy.data.meshes.remove(mesh)
assert chosen is not None
mesh = source.data; bpy.data.objects.remove(source, do_unlink=True); bpy.data.meshes.remove(mesh)
topology = rig.weld_and_shade(chosen, angle_degrees=50)

# 4. Apply the rigid yaw and uniform scale: length = spec, grounded, centred footprint.
P = base.positions_of(chosen.data); P = rotate(P - centre, yaw); P *= metres
P[:, 2] -= P[:, 2].min()
feet = P[P[:, 2] < .025*Hm]
offset = (feet[:, :2].min(0)+feet[:, :2].max(0))/2
P[:, :2] -= offset
chosen.data.vertices.foreach_set('co', P.astype(np.float32).ravel()); chosen.data.update()
chosen.name = 'HornedQuadrupedSurface'; chosen.data.name = 'HornedQuadrupedSurface'
for material in chosen.data.materials:
    if not material or not material.use_nodes: continue
    bsdf = next((n for n in material.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if bsdf:
        for link in list(material.node_tree.links):
            if link.to_socket in [bsdf.inputs['Metallic'], bsdf.inputs['Roughness']]: material.node_tree.links.remove(link)
        bsdf.inputs['Metallic'].default_value = 0; bsdf.inputs['Roughness'].default_value = .78
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'), export_format='GLB', use_selection=True, export_animations=False, export_yup=True, export_apply=False)
report = dict(candidate=1, revision=args.revision, source=selected, sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
    denseTriangles=len(F), triangles=len(base.face_array(chosen.data)), weld=weld, islands=islands, topology=topology, denoise=denoise,
    tolerances={'surfaceP95': Hm*.0012, 'surfaceMax': Hm*.006}, trials=trials,
    alignment={'pcaYawDegrees': pca, 'spineYawDegrees': float(best[1]), 'symmetryScore': float(best[0]), 'headSlabSpan': [spanLow, spanHigh],
               'headAtHighYBeforeTurn': bool(headAtHighY), 'manualFlip': args.flip, 'totalYawDegrees': yaw, 'metresPerUnit': metres, 'footprintOffset': offset.tolist()},
    heightMetres=float(np.ptp(P[:, 2])), lengthMetres=float(np.ptp(P[:, 1])), widthMetres=float(np.ptp(P[:, 0])),
    boundsBlender={'min': P.min(0).tolist(), 'max': P.max(0).tolist()}, forward='-Y (glTF +Z)', visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(report, indent=2)+'\n'); print('PREPARE_DONE', json.dumps({k: report[k] for k in ['triangles', 'heightMetres', 'lengthMetres', 'widthMetres']}), flush=True)
