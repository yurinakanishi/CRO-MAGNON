"""Measured TRELLIS surface reduction and a continuous, two-region pouch skin.

Every visible vertex comes from the dense reconstruction. Blender only reduces,
normalizes, skins and animates that surface. No proxy geometry is created.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Quaternion

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base
p = argparse.ArgumentParser()
p.add_argument('--attempt', default='02')
p.add_argument('--revision', default='01')
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
M = ROOT/'output/model-generation/models/mae'
dense = M/f'work/trellis/dense-attempt-{a.attempt}-res512-seed0042.glb'
generation = json.loads(dense.with_suffix('.json').read_text())
sha = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
assert generation['status'] == 'dense-generated; visual-review-and-rig-required'
assert sha(dense) == generation['sha256']
out = M/f'work/rig/revision-{a.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Keep all previous revisions'
H = .38
obj = base.import_dense(dense)
weld = base.weld(obj)
base.triangulate(obj)
P = base.positions_of(obj.data); F = base.face_array(obj.data)
height = float(np.ptp(P[:,2]))
tree = base.bvh_from_arrays(P,F)
samples = base.sample_surface(P,F,18000,42)
denoise = base.feature_weighted_taubin(obj, 5, .5, -.53, .14, .0012, height)
p95_tolerance, max_tolerance = H*.0009, H*.0035
trials=[]; chosen=None
def metric(points, target):
    result=base.deviation(points,target,height)
    return {key:result[key+'_units']*H/height for key in ['rms','p95','max']}
for ratio in [.012,.02,.035,.06,.1,.17,.3,.5,.8,1.0]:
    trial=obj.copy();trial.data=obj.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    if ratio<1:
        mod=trial.modifiers.new('SourceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial)
    Q=base.positions_of(trial.data);G=base.face_array(trial.data)
    forward=metric(samples,base.bvh_from_arrays(Q,G))
    reverse=metric(base.sample_surface(Q,G,18000,43),tree)
    passed=max(forward['p95'],reverse['p95'])<p95_tolerance and max(forward['max'],reverse['max'])<max_tolerance
    trials.append(dict(ratio=ratio,triangles=len(G),forward=forward,reverse=reverse,passed=passed))
    print(json.dumps(trials[-1]),flush=True)
    if passed:chosen=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert chosen is not None
bpy.data.objects.remove(obj,do_unlink=True);obj=chosen;obj.name='MaeSurface';base.weld(obj)
P=base.positions_of(obj.data);scale=H/float(np.ptp(P[:,2]));P*=scale
origin=(P.min(0)+P.max(0))*.5;origin[2]=P[:,2].min();P-=origin
obj.data.vertices.foreach_set('co',P.astype(np.float32).ravel());obj.data.update()
for poly in obj.data.polygons:poly.use_smooth=True
if 'custom_normal' in obj.data.attributes:obj.data.attributes.remove(obj.data.attributes['custom_normal'])
obj.data.update()
for mat in obj.data.materials:
    if not mat or not mat.use_nodes:continue
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for link in list(mat.node_tree.links):
        if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]:mat.node_tree.links.remove(link)
    bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.82
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'surface.glb'),export_format='GLB',use_selection=True,export_animations=False)

arm=bpy.data.armatures.new('MaeRig');rig=bpy.data.objects.new('MaeRig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;obj.select_set(False);rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root=arm.edit_bones.new('Root');root.head=(0,0,0);root.tail=(0,0,.04)
body=arm.edit_bones.new('Body');body.head=(0,0,H*.45);body.tail=(0,0,H*.65);body.parent=root
top=arm.edit_bones.new('Top');top.head=(0,0,H*.56);top.tail=(0,0,H*.93);top.parent=body
# Socket lies on the actual crown, not at a guessed bounding-box corner.
crown=P[(np.abs(P[:,0])<.045)&(P[:,1]<0)]
contact=crown[np.argmax(crown[:,2])].copy()
socket=arm.edit_bones.new('PetContact');socket.head=contact;socket.tail=contact+np.array([0,0,.025]);socket.parent=top
bpy.ops.object.mode_set(mode='OBJECT')
lower=obj.vertex_groups.new(name='Body');upper=obj.vertex_groups.new(name='Top')
for i,xyz in enumerate(P):
    blend=float(np.clip((xyz[2]/H-.32)/.39,0,1));blend=blend*blend*(3-2*blend)
    if blend<1:lower.add([i],1-blend,'REPLACE')
    if blend>0:upper.add([i],blend,'REPLACE')
mod=obj.modifiers.new('MaeSkin','ARMATURE');mod.object=rig;obj.parent=rig
for bone in rig.pose.bones:bone.rotation_mode='QUATERNION'
pb=rig.pose.bones['Body'];pt=rig.pose.bones['Top']
FPS=60;bpy.context.scene.render.fps=FPS
clips=[('Idle_Loop',3.,True),('Walk_Loop',.8,True),('Run_Loop',.5,True),('Pet',1.4,False),('Happy',1.4,False),('Hit',.65,False)]
checks=[];rig.animation_data_create()
def evaluated_positions():
    bpy.context.view_layer.update()
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh()
    q=base.positions_of(mesh);evaluated.to_mesh_clear();return q
for name,duration,loop in clips:
    action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
    n=round(duration*FPS);minimum=math.inf;maximum=-math.inf
    for frame in range(n+1):
        u=0 if loop and frame==n else frame/n
        phase=u*math.tau;envelope=math.sin(math.pi*u)**2
        bounce=0;sz=1;roll=0;pitch=0;top_roll=0;top_pitch=0
        if name=='Idle_Loop':
            sz=1+.009*math.sin(phase);top_roll=.016*math.sin(phase)
        elif name=='Walk_Loop':
            roll=.075*math.sin(phase);top_roll=-.035*math.sin(phase)
            sz=1-.018*(1-math.cos(phase*2));bounce=.009*math.sin(phase)**2
        elif name=='Run_Loop':
            bounce=.055*envelope;sz=1+.095*math.sin(phase)
            pitch=.055*math.sin(phase);top_pitch=-.04*math.sin(phase)
        elif name=='Pet':
            sz=1-.06*envelope;top_roll=.10*envelope
            top_pitch=.024*math.sin(phase*2)*envelope
        elif name=='Happy':
            bounce=.05*math.sin(phase)**2*math.sin(math.pi*u)
            sz=1+.075*math.sin(phase*2)*math.sin(math.pi*u)
            roll=.11*math.sin(phase)*envelope;top_roll=.055*math.sin(phase)*envelope
        elif name=='Hit':
            pitch=-.20*math.sin(math.pi*u)*math.exp(-u*1.2)
            top_pitch=-.06*envelope;sz=1-.10*envelope;bounce=.018*envelope
        sx=1/math.sqrt(sz)
        pb.scale=(sx,sz,sx)
        pb.rotation_quaternion=Quaternion((1,0,0),pitch)@Quaternion((0,0,1),roll)
        pt.rotation_quaternion=Quaternion((1,0,0),top_pitch)@Quaternion((0,0,1),top_roll)
        pb.location=(0,0,0)
        q=evaluated_positions();pb.location.y=bounce-float(q[:,2].min())+.001
        q=evaluated_positions();minimum=min(minimum,float(q[:,2].min()));maximum=max(maximum,float(q[:,2].max()))
        for bone in rig.pose.bones:
            bone.keyframe_insert('location',frame=frame);bone.keyframe_insert('rotation_quaternion',frame=frame);bone.keyframe_insert('scale',frame=frame)
    curves=action.fcurves if hasattr(action,'fcurves') else [c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]
    for curve in curves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    action.use_frame_range=True;action.frame_start=0;action.frame_end=n
    checks.append(dict(name=name,seconds=duration,loop=loop,fps=FPS,minimumY=minimum,maximumY=maximum,rootMotion='in-place'))
    rig.animation_data.action=None
for bone in rig.pose.bones:
    bone.location=(0,0,0);bone.scale=(1,1,1);bone.rotation_quaternion=Quaternion()
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='SELECT')
options=dict(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=True,export_yup=True,
    export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,
    export_anim_single_armature=True,export_skins=True,export_def_bones=False,export_optimize_animation_size=False)
supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k:v for k,v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
near_triangles=len(obj.data.polygons)
Q=base.positions_of(obj.data);G=base.face_array(obj.data);near_tree=base.bvh_from_arrays(Q,G)
near_samples=base.sample_surface(Q,G,14000,77);lod_trials=[];lod=None
for ratio in [.03,.05,.08,.12,.2,.35,.5,.65,.8,1.0]:
    trial=obj.copy();trial.data=obj.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    mod=trial.modifiers.new('DistantSourceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
    while trial.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name);base.triangulate(trial)
    if 'custom_normal' in trial.data.attributes:trial.data.attributes.remove(trial.data.attributes['custom_normal'])
    for poly in trial.data.polygons:poly.use_smooth=True
    trial.data.update();L=base.positions_of(trial.data);T=base.face_array(trial.data)
    forward=base.deviation(near_samples,base.bvh_from_arrays(L,T),H)
    reverse=base.deviation(base.sample_surface(L,T,14000,78),near_tree,H)
    passed=max(forward['p95_units'],reverse['p95_units'])<H*.0025 and max(forward['max_units'],reverse['max_units'])<H*.012
    lod_trials.append(dict(ratio=ratio,triangles=len(T),forward=forward,reverse=reverse,passed=passed))
    print(json.dumps(dict(lodTrial=lod_trials[-1])),flush=True)
    if passed:lod=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert lod is not None
bpy.data.objects.remove(obj,do_unlink=True);lod.name='MaeSurface'
for i,original in enumerate(lod.data.materials):
    material=bpy.data.materials.new('LODGeometrySlot_'+original.name);material.diffuse_color=(.5,.5,.5,1)
    lod.data.materials[i]=material
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'lod.glb'),export_format='GLB',export_animations=False,export_yup=True,export_skins=True,export_def_bones=False)
record=dict(candidate=1,revision=a.revision,modelKey='mae',source=str(dense.relative_to(ROOT)),sourceSha256=sha(dense),
    sha256=sha(out/'candidate.glb'),bytes=(out/'candidate.glb').stat().st_size,
    heightMetres=H,widthMetres=float(np.ptp(P[:,0])),lengthMetres=float(np.ptp(P[:,1])),
    denseTriangles=len(F),triangles=near_triangles,weld=weld,denoise=denoise,trials=trials,
    reductionToleranceMetres=dict(p95=p95_tolerance,maximum=max_tolerance),
    lod=dict(sha256=sha(out/'lod.glb'),triangles=len(lod.data.polygons),trials=lod_trials,distanceMetres=9,originalRig=True),
    alignment=dict(scale=scale,origin=origin.tolist(),yawDegrees=0),
    petContactBlender=contact.tolist(),bones=['Root','Body','Top','PetContact'],weights=dict(maxInfluences=2,unassigned=0,sum=1),clips=checks,
    locomotion={'Walk_Loop':dict(metresPerSecond=.6,cycleSeconds=.8,style='alternating grounded pouch rocking'),
                'Run_Loop':dict(metresPerSecond=1.8,cycleSeconds=.5,style='soft compress-launch-land hop')},
    sourceUvAndAlbedoPreserved=True,visualReviewRequired=True)
(out/'rig.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
