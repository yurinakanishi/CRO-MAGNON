"""Source-preserving reduction; choose density by measured surface error."""
import argparse, hashlib, json, sys
from pathlib import Path
import bpy, bmesh, numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base

p = argparse.ArgumentParser()
p.add_argument('--attempt', default='03')
p.add_argument('--revision', default='01')
args = p.parse_args(sys.argv[sys.argv.index('--')+1:])
M = ROOT/'output/model-generation/models/maruimo-octopus'
dense = M/f'work/trellis/dense-attempt-{args.attempt}-res1024-seed0042.glb'
out = M/f'work/low-poly/revision-{args.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Keep completed revisions'
H = 1.55
source = base.import_dense(dense)
weld = base.weld(source)
base.triangulate(source)
P = base.positions_of(source.data)
F = base.face_array(source.data)
height = float(np.ptp(P[:, 2]))
metres = H / height
tree = base.bvh_from_arrays(P, F)
samples = base.sample_surface(P, F, 18000, 17)
centres = P[F].mean(1)
detail = base.sample_surface(P, F[centres[:,2] > P[:,2].min()+.70*height], 6000, 18)
tentacles = base.sample_surface(P, F[centres[:,2] < P[:,2].min()+.48*height], 6000, 19)
denoise = base.feature_weighted_taubin(source, 4, .55, -.56, .16, .0006, height)
trials = []
chosen = None

def metric(points, target):
    data = base.deviation(points, target, height)
    return {name: data[name+'_units']*metres for name in ['p95','rms','max']}

for ratio in [.08,.14,.23,.36,.55,.8,1.0]:
    trial = source.copy()
    trial.data = source.data.copy()
    bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT')
    trial.select_set(True)
    bpy.context.view_layer.objects.active = trial
    if ratio < 1:
        mod = trial.modifiers.new('MeasuredSourceQEM','DECIMATE')
        mod.ratio = ratio
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial)
    Q = base.positions_of(trial.data)
    G = base.face_array(trial.data)
    qtree = base.bvh_from_arrays(Q,G)
    forward = metric(samples, qtree)
    reverse = metric(base.sample_surface(Q,G,18000,20),tree)
    head = metric(detail,qtree)
    suckers = metric(tentacles,qtree)
    passed = max(forward['p95'],reverse['p95'],suckers['p95'])<=H*.00085 and head['p95']<=H*.00065 and max(forward['max'],reverse['max'])<=H*.0045
    trials.append(dict(ratio=ratio,triangles=len(G),denseToReduced=forward,reducedToDense=reverse,head=head,tentacles=suckers,passed=passed))
    print(json.dumps(trials[-1]),flush=True)
    if passed:
        chosen = trial
        break
    mesh = trial.data
    bpy.data.objects.remove(trial,do_unlink=True)
    bpy.data.meshes.remove(mesh)
assert chosen is not None
bpy.data.objects.remove(source,do_unlink=True)
base.weld(chosen)
for polygon in chosen.data.polygons:
    polygon.use_smooth = True
P = base.positions_of(chosen.data)
scale = H / np.ptp(P[:,2])
P *= scale
P[:,2] -= P[:,2].min()
# The head is above the asymmetric arm silhouette and defines the body axis.
head_axis = P[(P[:,2]>.80*H)&(P[:,2]<.90*H)]
origin = np.array([np.median(head_axis[:,0]),np.median(head_axis[:,1]),0])
P -= origin
chosen.data.vertices.foreach_set('co',P.astype(np.float32).ravel())
chosen.data.update()
chosen.name = chosen.data.name = 'MaruimoSurface'
for material in chosen.data.materials:
    if not material or not material.use_nodes: continue
    bsdf = next((n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
    if bsdf:
        for link in list(material.node_tree.links):
            if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]: material.node_tree.links.remove(link)
        bsdf.inputs['Metallic'].default_value = 0
        bsdf.inputs['Roughness'].default_value = .68
bpy.ops.object.select_all(action='DESELECT')
chosen.select_set(True)
bpy.context.view_layer.objects.active = chosen
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_apply=False)
np.savez_compressed(out/'surface.npz', positions=P, faces=base.face_array(chosen.data))
record = dict(candidate=1,revision=args.revision,source=str(dense),sourceSha256=hashlib.sha256(dense.read_bytes()).hexdigest(),sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),heightMetres=H,denseTriangles=len(F),triangles=len(base.face_array(chosen.data)),weld=weld,denoise=denoise,trials=trials,alignment=dict(scale=float(scale),origin=origin.tolist(),yawDegrees=0),boundsBlender=dict(min=P.min(0).tolist(),max=P.max(0).tolist()),sourceUvAndAlbedoPreserved=True,visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
