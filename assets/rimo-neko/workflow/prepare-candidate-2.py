"""Source-preserving C2 reduction, measured in both directions; no new body mesh."""
import hashlib,json,math,sys
from pathlib import Path
import bpy,numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_reduce as reduce,blender_rig as rig
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'
dense=M/'work/trellis/dense-res1024-seed0042.glb'
out=M/'work/low-poly/revision-01'; out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists(),'Preserve completed revisions'
obj=reduce.import_dense(dense); weld=reduce.weld(obj)
islands=reduce.drop_small_components(obj,.0001); reduce.triangulate(obj)
P=reduce.positions_of(obj.data); F=reduce.face_array(obj.data)
H=float(np.ptp(P[:,2])); floor=float(P[:,2].min()); scale=.52/H
low=P[P[:,2]<floor+H*.055]
centres=[low[0,:2]]
for _ in range(3):
    d=np.min(np.stack([np.linalg.norm(low[:,:2]-c,axis=1) for c in centres]),axis=0)
    centres.append(low[np.argmax(d),:2])
centres=np.asarray(centres)
for _ in range(40):
    labels=np.argmin(np.linalg.norm(low[:,None,:2]-centres[None,:,:],axis=2),axis=1)
    centres=np.asarray([low[labels==i,:2].mean(0) for i in range(4)])
order=np.argsort(centres[:,1]); front=centres[order[:2]].mean(0); back=centres[order[2:]].mean(0)
axis=front-back; yaw=math.atan2(axis[0],axis[1])+math.pi; pivot=centres.mean(0)
denoise=reduce.feature_weighted_taubin(obj,3,.55,-.56,.16,.0005,H)
P=reduce.positions_of(obj.data); tree=reduce.bvh_from_arrays(P,F)
samples=reduce.sample_surface(P,F,18000,42)
trials=[]; chosen=None
def metric(points,tree):
    d=reduce.deviation(points,tree,H)
    return {k:d[k+'_units']*scale for k in ['p95','rms','max']}
for target in [90000,140000,200000,300000,len(F)]:
    ratio=min(1,target/len(F)); trial=obj.copy(); trial.data=obj.data.copy()
    bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT'); trial.select_set(True)
    bpy.context.view_layer.objects.active=trial
    if ratio<1:
        mod=trial.modifiers.new('SourceSurfaceQEM','DECIMATE')
        mod.ratio=ratio; mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    reduce.triangulate(trial); trial.data.update()
    Q=reduce.positions_of(trial.data); G=reduce.face_array(trial.data)
    forward=metric(samples,reduce.bvh_from_arrays(Q,G))
    reverse=metric(reduce.sample_surface(Q,G,18000,43),tree)
    passed=max(forward['p95'],reverse['p95'])<=.52*.0012 and max(forward['max'],reverse['max'])<=.52*.006
    trials.append(dict(ratio=ratio,triangles=len(G),denseToReduced=forward,reducedToDense=reverse,passed=passed))
    print('REDUCTION',json.dumps(trials[-1]),flush=True)
    if passed: chosen=trial; break
    mesh=trial.data; bpy.data.objects.remove(trial,do_unlink=True); bpy.data.meshes.remove(mesh)
assert chosen is not None
mesh=obj.data; bpy.data.objects.remove(obj,do_unlink=True); bpy.data.meshes.remove(mesh)
topology=rig.weld_and_shade(chosen,angle_degrees=65)
Q=reduce.positions_of(chosen.data); Q[:,:2]-=pivot
c,s=math.cos(yaw),math.sin(yaw); Q[:,:2]=Q[:,:2]@np.array([[c,s],[-s,c]])
Q[:,2]-=floor; Q*=scale
chosen.data.vertices.foreach_set('co',Q.astype(np.float32).ravel()); chosen.data.update()
chosen.name=chosen.data.name='RimoNekoSurface'
for mat in chosen.data.materials:
    if mat and mat.use_nodes:
        bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        for link in list(mat.node_tree.links):
            if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]: mat.node_tree.links.remove(link)
        bsdf.inputs['Metallic'].default_value=0; bsdf.inputs['Roughness'].default_value=.82
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_apply=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
report=dict(candidate=2,revision=1,source=str(dense),sourceSha256=hashlib.sha256(dense.read_bytes()).hexdigest(),sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),triangles=len(reduce.face_array(chosen.data)),weld=weld,islands=islands,topology=topology,denoise=denoise,trials=trials,
    alignment=dict(pawCentres=centres.tolist(),yawDegrees=math.degrees(yaw),pivot=pivot.tolist(),floor=floor,uniformScale=scale),boundsBlender=dict(min=Q.min(0).tolist(),max=Q.max(0).tolist()),heightMetres=float(np.ptp(Q[:,2])),forward='-Y (glTF +Z)')
np.savez_compressed(out/'surface.npz',positions=Q,faces=reduce.face_array(chosen.data))
(out/'process.json').write_text(json.dumps(report,indent=2)+'\n')
print('PREPARE_DONE',json.dumps(report['boundsBlender']),flush=True)
