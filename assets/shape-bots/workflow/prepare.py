"""Measured reduction and squash/hop rig of the actual TRELLIS surface.

No visible geometry is built from primitives. UV/albedo repairs are explicit.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector, Quaternion

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0, str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base

p = argparse.ArgumentParser()
p.add_argument('colour', choices=['beret', 'frog', 'triangle', 'heart'])
p.add_argument('--attempt', default='01')
p.add_argument('--revision', default='01')
p.add_argument('--resolution', type=int, default=512)
a = p.parse_args(sys.argv[sys.argv.index('--')+1:])
M = ROOT / ('output/model-generation/models/orb-bot-' + a.colour)
dense = M/f'work/trellis/dense-attempt-{a.attempt}-res{a.resolution}-seed0042.glb'
generation = json.loads(dense.with_suffix('.json').read_text())
assert generation['status'] == 'dense-generated; visual-review-and-rig-required', 'Wait for the generator to finish'
assert hashlib.sha256(dense.read_bytes()).hexdigest() == generation['sha256'], 'Incomplete or changed dense source'
out = M/f'work/rig/revision-{a.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Keep previous revisions'
H = .28
obj = base.import_dense(dense)
weld = base.weld(obj)
base.triangulate(obj)
surface_repair=None
P = base.positions_of(obj.data)
F = base.face_array(obj.data)
height = float(np.ptp(P,axis=0).max())
tree = base.bvh_from_arrays(P,F)
samples = base.sample_surface(P,F,14000,42)
denoise = base.feature_weighted_taubin(obj, 5, .5, -.53, .14, .0012, height)
trials = []
chosen = None
p95_tolerance=H*(.00035 if a.colour in ['triangle','heart'] else .0009)
max_tolerance=H*(.0014 if a.colour in ['triangle','heart'] else .0035)
def metric(points, target):
    result = base.deviation(points,target,height)
    return {key:result[key+'_units'] * H / height for key in ['rms','p95','max']}
for ratio in [.012,.02,.035,.06,.1,.17,.3,.5,.8,1.0]:
    trial = obj.copy(); trial.data = obj.data.copy()
    bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT')
    trial.select_set(True); bpy.context.view_layer.objects.active=trial
    if ratio < 1:
        mod=trial.modifiers.new('SourceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    base.triangulate(trial)
    Q=base.positions_of(trial.data); G=base.face_array(trial.data)
    forward=metric(samples,base.bvh_from_arrays(Q,G))
    reverse=metric(base.sample_surface(Q,G,14000,43),tree)
    passed=max(forward['p95'],reverse['p95'])<p95_tolerance and max(forward['max'],reverse['max'])<max_tolerance
    trials.append(dict(ratio=ratio,triangles=len(G),forward=forward,reverse=reverse,passed=passed))
    print(json.dumps(trials[-1]),flush=True)
    if passed: chosen=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert chosen is not None
bpy.data.objects.remove(obj,do_unlink=True)
obj=chosen; obj.name='OrbSurface';base.weld(obj)
P=base.positions_of(obj.data)
scale=H/float(np.ptp(P,axis=0).max());P*=scale
origin=(P.min(0)+P.max(0))*.5;origin[2]=P[:,2].min();P-=origin
obj.data.vertices.foreach_set('co',P.astype(np.float32).ravel());obj.data.update()
for poly in obj.data.polygons:poly.use_smooth=True
if 'custom_normal' in obj.data.attributes:
    obj.data.attributes.remove(obj.data.attributes['custom_normal'])
obj.data.update()
for mat in obj.data.materials:
    if not mat or not mat.use_nodes:continue
    bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    for link in list(mat.node_tree.links):
        if link.to_socket in [bsdf.inputs['Metallic'],bsdf.inputs['Roughness']]:mat.node_tree.links.remove(link)
    bsdf.inputs['Metallic'].default_value=0;bsdf.inputs['Roughness'].default_value=.82
import importlib.util
spec=importlib.util.spec_from_file_location('calibrate_material',Path(__file__).with_name('calibrate-material.py'))
calibration=importlib.util.module_from_spec(spec);spec.loader.exec_module(calibration)
material_repair=calibration.calibrate(obj,ROOT/f'assets/shape-bots/source/{a.colour}-reference-v1.png',a.colour,out)
if a.colour=='triangle':
    spec=importlib.util.spec_from_file_location('repair_triangle_albedo',Path(__file__).with_name('repair-triangle-albedo.py'))
    repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)
    material_repair['faceRetouch']=repair.repair(obj,out,base)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str(out/'surface.glb'),export_format='GLB',use_selection=True,export_animations=False)

arm=bpy.data.armatures.new('OrbRig');rig=bpy.data.objects.new('OrbRig',arm);bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig;obj.select_set(False);rig.select_set(True)
bpy.ops.object.mode_set(mode='EDIT')
root=arm.edit_bones.new('Root');root.head=(0,0,0);root.tail=(0,0,.04)
body_height=float(np.ptp(P[:,2]))
body=arm.edit_bones.new('Body');body.head=(0,0,body_height/2);body.tail=(0,0,body_height/2+.04);body.parent=root
bpy.ops.object.mode_set(mode='OBJECT')
group=obj.vertex_groups.new(name='Body');group.add(list(range(len(obj.data.vertices))),1,'REPLACE')
mod=obj.modifiers.new('OrbSkin','ARMATURE');mod.object=rig;obj.parent=rig
pb=rig.pose.bones['Body'];pb.rotation_mode='QUATERNION'
FPS=60;bpy.context.scene.render.fps=FPS
clips=[('Idle_Loop',2.4,True),('Walk_Loop',.6,True),('Run_Loop',.4,True),('Held_Loop',1.2,True),('Thrown_Loop',.9,True),('Land',.42,False),('Catch',.3,False)]
personality={'beret':.75,'frog':1.15,'triangle':.65,'heart':.95}[a.colour]
checks=[]
rig.animation_data_create()
for name,duration,loop in clips:
    action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
    n=round(duration*FPS);minimum=math.inf;maximum=-math.inf
    for frame in range(n+1):
        u=0 if loop and frame==n else frame/n
        phase=u*2*math.pi;bounce=0;sz=1;tilt=0;yaw=0
        if name=='Idle_Loop':
            sz=1+.018*personality*math.sin(phase);tilt=.035*personality*math.sin(phase)
        elif name in ['Walk_Loop','Run_Loop']:
            hop=math.sin(math.pi*u)**2
            bounce=(.055 if name=='Walk_Loop' else .1)*hop
            sz=1+(.10 if name=='Walk_Loop' else .16)*math.sin(phase)
            tilt=.10*personality*math.sin(phase)
        elif name=='Held_Loop':
            sz=1+.018*math.sin(phase);tilt=.075*personality*math.sin(phase)
        elif name=='Thrown_Loop':
            sz=1.075;tilt=.18*math.sin(phase);yaw=.13*math.sin(phase)
        elif name=='Land':
            sz=1-.18*math.sin(math.pi*u)*math.exp(-u*2);bounce=.022*math.sin(math.pi*u)**2
        elif name=='Catch':
            sz=1-.1*math.sin(math.pi*u);bounce=.06*math.sin(math.pi*u)**2
        sx=1/math.sqrt(sz)
        pb.scale=(sx,sz,sx) # bone-local Y is Blender vertical Z
        pb.rotation_quaternion=Quaternion((0,1,0),yaw)@Quaternion((0,0,1),tilt)
        pb.location=(0,0,0)
        bpy.context.view_layer.update()
        deps=bpy.context.evaluated_depsgraph_get();evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
        q=base.positions_of(mesh);evaluated.to_mesh_clear()
        if name not in ['Held_Loop','Thrown_Loop']:
            pb.location.y=bounce-float(q[:,2].min())+.0005
        bpy.context.view_layer.update()
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();q=base.positions_of(mesh);evaluated.to_mesh_clear()
        minimum=min(minimum,float(q[:,2].min()));maximum=max(maximum,float(q[:,2].max()))
        for bone in rig.pose.bones:
            bone.keyframe_insert('location',frame=frame);bone.keyframe_insert('rotation_quaternion',frame=frame);bone.keyframe_insert('scale',frame=frame)
    if hasattr(action,'fcurves'):curves=action.fcurves
    else:curves=[c for layer in action.layers for strip in layer.strips for bag in strip.channelbags for c in bag.fcurves]
    for curve in curves:
        for key in curve.keyframe_points:key.interpolation='LINEAR'
    action.use_frame_range=True;action.frame_start=0;action.frame_end=n
    checks.append(dict(name=name,seconds=duration,loop=loop,fps=FPS,minimumY=minimum,maximumY=maximum,rootMotion='in-place'))
    rig.animation_data.action=None
pb.location=(0,0,0);pb.scale=(1,1,1);pb.rotation_quaternion=Quaternion()
bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='SELECT')
options=dict(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=True,export_yup=True,
    export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,
    export_anim_single_armature=True,export_skins=True,export_def_bones=False,export_optimize_animation_size=False)
supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k:v for k,v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
# Derive the distant surface from the same mesh, UVs and live rig. Use measured
# error rather than a fixed triangle count; the close delivery is already saved.
near_triangles=len(obj.data.polygons)
Q=base.positions_of(obj.data);G=base.face_array(obj.data);near_tree=base.bvh_from_arrays(Q,G)
near_samples=base.sample_surface(Q,G,10000,77)
lod_trials=[];lod=None
for ratio in [.03,.05,.08,.12,.2,.35,.5,.65,.8,1.0]:
    trial=obj.copy();trial.data=obj.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    mod=trial.modifiers.new('DistantSourceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
    while trial.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name);base.triangulate(trial)
    if 'custom_normal' in trial.data.attributes:
        trial.data.attributes.remove(trial.data.attributes['custom_normal'])
    for poly in trial.data.polygons:poly.use_smooth=True
    trial.data.update()
    L=base.positions_of(trial.data);T=base.face_array(trial.data)
    forward=base.deviation(near_samples,base.bvh_from_arrays(L,T),H)
    reverse=base.deviation(base.sample_surface(L,T,10000,78),near_tree,H)
    passed=max(forward['p95_units'],reverse['p95_units'])<H*.0025 and max(forward['max_units'],reverse['max_units'])<H*.015
    lod_trials.append(dict(ratio=ratio,triangles=len(T),forward=forward,reverse=reverse,passed=passed))
    print(json.dumps(dict(lodTrial=lod_trials[-1])),flush=True)
    if passed:lod=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert lod is not None,'No acceptable distant surface'
bpy.data.objects.remove(obj,do_unlink=True);lod.name='OrbSurface'
for i,original in enumerate(lod.data.materials):
    material=bpy.data.materials.new('LODGeometrySlot_'+original.name);material.diffuse_color=(.5,.5,.5,1)
    lod.data.materials[i]=material
bpy.ops.object.select_all(action='SELECT')
bpy.ops.export_scene.gltf(filepath=str(out/'lod.glb'),export_format='GLB',export_animations=False,export_yup=True,export_skins=True,export_def_bones=False)
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
record=dict(candidate=1,revision=a.revision,colour=a.colour,source=str(dense),sourceSha256=sha(dense),
    sha256=sha(out/'candidate.glb'),bytes=(out/'candidate.glb').stat().st_size,
    heightMetres=body_height,maxDimensionMetres=H,widthMetres=float(np.ptp(P[:,0])),lengthMetres=float(np.ptp(P[:,1])),
    denseTriangles=len(F),triangles=near_triangles,weld=weld,denoise=denoise,trials=trials,
    reductionToleranceMetres=dict(p95=p95_tolerance,maximum=max_tolerance),
    lod=dict(sha256=sha(out/'lod.glb'),triangles=len(lod.data.polygons),trials=lod_trials,distanceMetres=9,originalRig=True),
    alignment=dict(scale=scale,origin=origin.tolist(),yawDegrees=0),
    bones=['Root','Body'],weights=dict(maxInfluences=1,unassigned=0,sum=1),clips=checks,
    sourceUvAndAlbedoPreserved=False,sourceUvPreserved=True,sourceAlbedoPreserved=False,materialRepair=material_repair,surfaceRepair=surface_repair,visualReviewRequired=True)
(out/'rig.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(record),flush=True)
