"""Reduce only the reconstructed surface; preserve its UVs and original albedo."""
import hashlib,json,sys
from pathlib import Path
import bpy,numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base
M=ROOT/'output/model-generation/models/kohaku'
source=M/'work/trellis/dense-attempt-04-res512-seed0042.glb'
out=M/'work/surface/revision-05';out.mkdir(parents=True,exist_ok=True)
assert not (out/'surface.glb').exists(),'Preserve previous output'
H=json.loads((ROOT/'public/models/rimo-neko/asset.json').read_text(encoding='utf8'))['heightMetres']
obj=base.import_dense(source);weld=base.weld(obj);base.triangulate(obj)
P=base.positions_of(obj.data);F=base.face_array(obj.data);height=float(np.ptp(P[:,2]))
tree=base.bvh_from_arrays(P,F);samples=base.sample_surface(P,F,18000,42)
denoise=base.feature_weighted_taubin(obj,4,.5,-.53,.14,.0008,height)
trials=[];chosen=None
def metric(points,target):
    r=base.deviation(points,target,height)
    return {key:r[key+'_units']*H/height for key in ['rms','p95','max']}
for ratio in [.035,.06,.1,.17,.3,.5,.8,1.0]:
    trial=obj.copy();trial.data=obj.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    if ratio<1:
        mod=trial.modifiers.new('SourceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial);Q=base.positions_of(trial.data);G=base.face_array(trial.data)
    forward=metric(samples,base.bvh_from_arrays(Q,G));reverse=metric(base.sample_surface(Q,G,18000,43),tree)
    passed=max(forward['p95'],reverse['p95'])<H*.001 and max(forward['max'],reverse['max'])<H*.004
    trials.append(dict(ratio=ratio,triangles=len(G),forward=forward,reverse=reverse,passed=passed))
    print(json.dumps(trials[-1]),flush=True)
    if passed:chosen=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert chosen is not None
bpy.data.objects.remove(obj,do_unlink=True);obj=chosen;obj.name='KohakuSurface';base.weld(obj)
P=base.positions_of(obj.data);scale=H/float(np.ptp(P[:,2]));P*=scale
P[:,2]-=P[:,2].min()
# Centre the feet rather than the asymmetric tail silhouette.
feet=P[P[:,2]<H*.05];origin=np.array([(feet[:,0].min()+feet[:,0].max())*.5,(feet[:,1].min()+feet[:,1].max())*.5,0.])
P-=origin;obj.data.vertices.foreach_set('co',P.astype(np.float32).ravel());obj.data.update()
for poly in obj.data.polygons:poly.use_smooth=True
if 'custom_normal' in obj.data.attributes:obj.data.attributes.remove(obj.data.attributes['custom_normal'])
for mat in obj.data.materials:
    if not mat or not mat.use_nodes:continue
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for link in list(mat.node_tree.links):
        if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]:mat.node_tree.links.remove(link)
    bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.78
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'surface.glb'),export_format='GLB',use_selection=True,export_animations=False)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'surface.blend'))
bands=[]
for f in [.03,.10,.16,.22,.27,.32,.36,.40,.44,.48,.52,.56,.60,.68,.78,.90]:
    q=P[abs(P[:,2]/H-f)<.009]
    bands.append(dict(heightFraction=f,count=len(q),min=q.min(0).tolist(),max=q.max(0).tolist()))
record=dict(heightMetres=H,widthMetres=float(np.ptp(P[:,0])),lengthMetres=float(np.ptp(P[:,1])),scale=scale,origin=origin.tolist(),
            sha256=hashlib.sha256((out/'surface.glb').read_bytes()).hexdigest(),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            denseTriangles=len(F),triangles=len(obj.data.polygons),weld=weld,denoise=denoise,trials=trials,bands=bands)
(out/'surface.json').write_text(json.dumps(record,indent=2)+'\n');np.savez_compressed(out/'surface.npz',positions=P,faces=base.face_array(obj.data))
print(json.dumps(record),flush=True)
