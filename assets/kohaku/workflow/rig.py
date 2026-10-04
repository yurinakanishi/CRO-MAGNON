"""Kohaku's miniature biped rig and pose-sheet gestures on the TRELLIS surface."""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as reduce,blender_rig as base,skin_weights as sw,graph_tools as gt,clips_data as cd
ap=argparse.ArgumentParser();ap.add_argument('--revision',default='01');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
M=ROOT/'output/model-generation/models/kohaku';surface=M/'work/surface/revision-05'
record=json.loads((surface/'surface.json').read_text());H=record['heightMetres'];base.H=H
out=M/f'work/rig/revision-{a.revision}';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists(),'Keep every revision'
obj=base.import_mesh(surface/'surface.glb');reduce.weld(obj);reduce.triangulate(obj)
obj.name='KohakuSurface';P=reduce.positions_of(obj.data);F=reduce.face_array(obj.data)
def smooth(v):
    v=np.clip(v,0,1);return v*v*(3-2*v)
def centre(z,xlimit=.115):
    q=P[(abs(P[:,2]/H-z)<.012)&(abs(P[:,0]/H)<xlimit)]
    return float((np.quantile(q[:,1],.08)+np.quantile(q[:,1],.92))*.5) if len(q) else 0.
def pos(x,y,z):return [x*H,y*H,z*H]
marks={name:[0,centre(z),z*H] for name,z in [('pelvis',.34),('spine',.425),('chest',.49),('neck',.555),('head',.64),('head_tip',.90)]}
for side,sign in [('L',1),('R',-1)]:
    for name,x,z in [('hip',.058,.29),('knee',.063,.177),('ankle',.066,.059),('foot',.066,.027),('toe',.066,.022)]:
        q=P[(sign*P[:,0]>.015*H)&(abs(P[:,0])<.15*H)&(abs(P[:,2]/H-z)<.012)]
        y=float((np.quantile(q[:,1],.12)+np.quantile(q[:,1],.88))*.5) if len(q) else centre(.29)
        if name=='knee':y-=.012*H
        if name=='foot':y-=.032*H
        if name=='toe':y-=.052*H
        marks[name+'_'+side]=[sign*x*H,y,z*H]
    marks['shoulder_in_'+side]=[sign*.04*H,centre(.49),.50*H]
    for name,x,z in [('shoulder',.12,.500),('elbow',.235,.482),('wrist',.312,.473),('hand',.378,.464)]:
        q=P[(abs(P[:,0]/H-sign*x)<.04)&(abs(P[:,2]/H-z)<.014)&(P[:,1]<.06*H)]
        y=float((np.quantile(q[:,1],.1)+np.quantile(q[:,1],.9))*.5) if len(q) else -.012*H
        marks[name+'_'+side]=[sign*x*H,y,z*H]
plan=base.bone_plan(marks)
# Petting reaches the central hair crown, below the cat-ear tips.
q=P[(abs(P[:,0])<.022*H)&(P[:,1]<centre(.80))]
contact=q[np.argmax(q[:,2])].copy()
plan.append(('PetContact',contact,contact+np.array([0,0,.02*H]),'Head',False))
for side,sign in [('L',1),('R',-1)]:
    plan.append(('Ear.'+side,[sign*.19*H,centre(.86),.865*H],[sign*.255*H,centre(.9),.987*H],'Head',False))
    plan.append(('Hair.'+side,[sign*.275*H,centre(.72),.72*H],[sign*.25*H,centre(.56),.555*H],'Head',False))
    for region,depth in [('Front',-.075),('Back',.07)]:
        plan.append(('Skirt'+region+'.'+side,pos(sign*.065,depth,.405),pos(sign*.15,depth,.275),'Hips',False))
low=P[P[:,2]<.40*H]
tail_sign=1 if low[:,0].max()>-low[:,0].min() else -1
tail_points=[pos(0,.12,.415),pos(tail_sign*.10,.20,.29),pos(tail_sign*.24,.28,.18),pos(tail_sign*.34,.30,.18),pos(tail_sign*.405,.30,.255),pos(tail_sign*.370,.28,.36)]
for i in range(5):
    plan.append((f'Tail{i+1}',tail_points[i],tail_points[i+1],'Hips' if i==0 else f'Tail{i}',False))
rig=base.build_armature(plan);rig.name='KohakuRig';rig.data.name='KohakuSkeleton'
segments=[(b.name,np.array(b.head_local),np.array(b.tail_local)) for b in rig.data.bones if b.name not in ['Root','PetContact']]
names=[s[0] for s in segments]
W,weight_report=sw.solve(P,F,segments,radius=.032,smooth_iterations=18,core_floor=.003,bridge_radius=.0012,side_keep_full=.008,side_fade_to=.02)
def target(name):
    result=np.zeros_like(W);result[:,names.index(name)]=1;return result
def blend(field,factor):
    global W
    W=W*(1-factor[:,None])+field*factor[:,None]
# The face and eyes remain rigid. Head details may only follow their own small
# secondary chains; the tiny sleeves never borrow the head's movement.
blend(target('Head'),smooth((P[:,2]/H-.547)/.025))
arm_distance=np.full(len(P),np.inf)
for side in ['L','R']:
    for first,last in [('shoulder','elbow'),('elbow','wrist'),('wrist','hand')]:
        start=np.array(marks[first+'_'+side]);axis=np.array(marks[last+'_'+side])-start
        t=np.clip(((P-start)@axis)/(axis@axis),0,1)
        arm_distance=np.minimum(arm_distance,np.linalg.norm(P-(start+t[:,None]*axis),axis=1))
z=P[:,2]/H
def arm_field(side,sign):
    along=sign*P[:,0]/H
    elbow=smooth((along-.215)/.04);wrist=smooth((along-.296)/.032)
    return target('UpperArm.'+side)*(1-elbow)[:,None]+target('LowerArm.'+side)*(elbow*(1-wrist))[:,None]+target('Hand.'+side)*(elbow*wrist)[:,None]

def arm_gate(sign):
    return smooth((sign*P[:,0]/H-.115)/.055)*smooth((z-.409)/.03)*(1-smooth((z-.523)/.032))*(1-smooth((arm_distance/H-.05)/.025))

for side,sign in [('L',1),('R',-1)]:
    ear=smooth((z-.87)/.085)*smooth((sign*P[:,0]/H-.145)/.075)
    blend(target('Ear.'+side),ear*.8)
    hair=smooth((sign*P[:,0]/H-.22)/.065)*smooth((z-.53)/.035)*(1-smooth((z-.67)/.06))
    blend(target('Hair.'+side),hair*.65)
    blend(arm_field(side,sign),arm_gate(sign))
# A continuous skirt field lets the hem sway without welding the two legs to
# each other. Geometry, UV coordinates and painted lace remain unchanged.
tail_columns=[names.index(f'Tail{i+1}') for i in range(5)]
tail_weight=W[:,tail_columns].sum(1)
skirt=smooth((z-.245)/.035)*(1-smooth((z-.405)/.035))*smooth((arm_distance/H-.045)/.035)*(1-tail_weight)
left=smooth(.5+P[:,0]/(.055*H));front=smooth(.5-(P[:,1]-centre(.30))/(.10*H))
field=np.zeros_like(W)
for side,factor in [('L',left),('R',1-left)]:
    for region,depth in [('Front',front),('Back',1-front)]:field[:,names.index('Skirt'+region+'.'+side)]=factor*depth
lower=smooth((.415-z)/.14)
blend(field*lower[:,None]+target('Hips')*(1-lower[:,None]),skirt)
for side,sign in [('L',1),('R',-1)]:
    knee=smooth((z-.14)/.075);ankle=1-smooth((z-.042)/.047)
    field=target('UpperLeg.'+side)*knee[:,None]+target('LowerLeg.'+side)*((1-knee)*(1-ankle))[:,None]+target('Foot.'+side)*((1-knee)*ankle)[:,None]
    gate=(sign*P[:,0]>0)*(1-smooth((z-.21)/.035))*(1-smooth((abs(P[:,0])/H-.13)/.035))*(1-tail_weight)
    blend(field,gate)
edges=gt.unique_edges(F);starts,neighbours=gt.adjacency(len(P),edges)
W=sw.laplacian_smooth(W,starts,neighbours,10,.3)
# The new reconstruction leaves clear air between cuffs and skirt. Restore the
# distal arm field after smoothing, without cutting or capping visible surfaces.
for side,sign in [('L',1),('R',-1)]:
    blend(arm_field(side,sign),arm_gate(sign))
keep=np.argsort(-W,axis=1)[:,:4];clipped=np.zeros_like(W);rows=np.arange(len(P))[:,None]
clipped[rows,keep]=W[rows,keep];W=clipped;W[W<1e-5]=0;W/=W.sum(1)[:,None]
for col,name in enumerate(names):
    group=obj.vertex_groups.new(name=name)
    for index in np.flatnonzero(W[:,col]>0):group.add([int(index)],float(W[index,col]),'REPLACE')
modifier=obj.modifiers.new('KohakuSkin','ARMATURE');modifier.object=rig;obj.parent=rig
np.savez_compressed(out/'rig-surface.npz',positions=P,faces=F,weights=W,bones=np.array(names))
solvers={side:cd.LegSolver(marks['hip_'+side],marks['knee_'+side],marks['ankle_'+side]) for side in ['L','R']}
walk=cd.walk_gait(min(s.rest_reach for s in solvers.values()));run=cd.run_gait(min(s.rest_reach for s in solvers.values()))
FPS=60;ARM_REST=36;bpy.context.scene.render.fps=FPS;rig.animation_data_create()
clips=[('Idle_Loop',3.,True),('Walk_Loop',.72,True),('Run_Loop',.40,True),('Pet',1.4,False),('Happy',1.4,False),('Hit',.65,False),('Wave',1.8,False),('Bow',1.6,False)]
clip_records=[];sole=(P[:,2]<.08*H)&(abs(P[:,0])<.14*H)
for name,duration,loop in clips:
    action=bpy.data.actions.new(name);action.use_fake_user=True;rig.animation_data.action=action
    count=round(duration*FPS)
    for frame in range(count+1):
        u=0 if loop and frame==count else frame/count;p=u*math.tau;e=math.sin(math.pi*u)**2
        pose={'Spine':{'pitch':0},'Head':{'roll':1.1*math.sin(p)},'Hips':{}}
        for side,sign in [('L',1),('R',-1)]:
            pose['UpperArm.'+side]={'roll':sign*ARM_REST}
            pose['LowerArm.'+side]={'pitch':-4}
            pose['Ear.'+side]={'roll':sign*2*math.sin(p-.5)}
            pose['Hair.'+side]={'roll':sign*1.1*math.sin(p-.7)}
            for region in ['Front','Back']:pose['Skirt'+region+'.'+side]={'roll':sign*1.2*math.sin(p-.4)}
        for i in range(5):pose[f'Tail{i+1}']={'yaw':2.5*math.sin(p-i*.42),'pitch':1.4*math.sin(p-i*.35)}
        hop=0.
        if name in ['Walk_Loop','Run_Loop']:
            gait=walk if name=='Walk_Loop' else run
            for side,offset in [('L',0),('R',.5)]:
                phase=(u+offset)%1;forward,drop=gait.target(phase);angles=solvers[side].solve(forward,drop)
                foot=gait.foot_pitch(phase,angles['upper'],angles['lower'])
                for stem,value in [('UpperLeg',angles['upper']),('LowerLeg',angles['lower']),('Foot',foot),('Toe',gait.toe_pitch(phase,angles['upper'],angles['lower'],foot))]:pose[stem+'.'+side]={'pitch':value}
                pose['UpperArm.'+side]={'pitch':(17 if name=='Walk_Loop' else 29)*math.sin(phase*math.tau),'roll':(1 if side=='L' else -1)*ARM_REST}
                pose['LowerArm.'+side]={'pitch':-14 if name=='Walk_Loop' else -35}
                for region in ['Front','Back']:pose['Skirt'+region+'.'+side]={'pitch':angles['upper']*.20}
            pose['Chest']={'yaw':2.5*math.sin(p),'pitch':4 if name=='Run_Loop' else 1}
            pose['Head']={'yaw':-1.5*math.sin(p),'pitch':-2 if name=='Run_Loop' else 0}
            if name=='Run_Loop':hop=.009*math.sin(p)**2
        elif name=='Pet':
            pose['Head']={'roll':-8*e,'pitch':3*e};pose['Chest']={'pitch':4*e}
            for side,sign in [('L',1),('R',-1)]:pose['UpperArm.'+side]={'roll':sign*(ARM_REST+3*e),'pitch':-12*e}
        elif name=='Happy':
            hop=.025*math.sin(p)**2*math.sin(math.pi*u);pose['Head']={'roll':7*math.sin(p)*e}
            for side,sign in [('L',1),('R',-1)]:
                pose['UpperArm.'+side]={'roll':sign*(ARM_REST-42*e),'pitch':-15*e};pose['LowerArm.'+side]={'pitch':-35*e}
                pose['Ear.'+side]={'roll':-sign*7*e}
        elif name=='Hit':
            pose['Chest']={'pitch':-8*e};pose['Head']={'pitch':-7*e};hop=.008*e
            for side,sign in [('L',1),('R',-1)]:pose['UpperArm.'+side]={'pitch':-28*e,'roll':sign*(ARM_REST-12*e)}
        elif name=='Wave':
            pose['UpperArm.R']={'roll':-ARM_REST+(ARM_REST+15)*e,'pitch':-18*e};pose['LowerArm.R']={'pitch':-55*e,'roll':12*math.sin(p*3)*e}
            pose['Hand.R']={'roll':15*math.sin(p*3)*e};pose['Head']={'roll':4*e}
        elif name=='Bow':
            pose['Chest']={'pitch':19*e};pose['Head']={'pitch':10*e}
            for side,sign in [('L',1),('R',-1)]:pose['UpperArm.'+side]={'roll':sign*(ARM_REST+5*e),'pitch':-17*e};pose['LowerArm.'+side]={'pitch':-24*e}
        base.apply_pose(rig,pose);bpy.context.view_layer.update()
        evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get());mesh=evaluated.to_mesh();q=reduce.positions_of(mesh);evaluated.to_mesh_clear()
        lift=hop+.001-float(q[sole,2].min())
        rig.pose.bones['Hips'].location=rig.pose.bones['Hips'].bone.matrix_local.to_3x3().inverted()@Vector((0,0,lift))
        for bone in rig.pose.bones:
            bone.keyframe_insert('location',frame=frame);bone.keyframe_insert('rotation_quaternion',frame=frame)
    base.set_interpolation(action,'LINEAR');action.use_frame_range=True;action.frame_start=0;action.frame_end=count
    rig.animation_data.action=None;clip_records.append(dict(name=name,seconds=count/FPS,loop=loop,fps=FPS,rootMotion='in-place'))
    print('AUTHORED',name,flush=True)
base.apply_pose(rig,{});bpy.context.scene.frame_set(0)
bpy.ops.object.select_all(action='DESELECT');rig.select_set(True);obj.select_set(True);bpy.context.view_layer.objects.active=rig
options=dict(filepath=str(out/'candidate.glb'),export_format='GLB',use_selection=True,export_animations=True,export_yup=True,export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,export_anim_single_armature=True,export_skins=True,export_def_bones=False,export_optimize_animation_size=False)
supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys());bpy.ops.export_scene.gltf(**{k:v for k,v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
near_tree=reduce.bvh_from_arrays(P,F);near_samples=reduce.sample_surface(P,F,14000,77);trials=[];lod=None
for ratio in [.08,.15,.25,.4,.6,.8,1.0]:
    trial=obj.copy();trial.data=obj.data.copy();bpy.context.collection.objects.link(trial)
    bpy.ops.object.select_all(action='DESELECT');trial.select_set(True);bpy.context.view_layer.objects.active=trial
    mod=trial.modifiers.new('SourceLOD','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
    while trial.modifiers.find(mod.name)>0:bpy.ops.object.modifier_move_up(modifier=mod.name)
    bpy.ops.object.modifier_apply(modifier=mod.name);trial.data.validate(clean_customdata=False);reduce.triangulate(trial)
    L=reduce.positions_of(trial.data);T=reduce.face_array(trial.data)
    forward=reduce.deviation(near_samples,reduce.bvh_from_arrays(L,T),H);reverse=reduce.deviation(reduce.sample_surface(L,T,14000,78),near_tree,H)
    passed=max(forward['p95_units'],reverse['p95_units'])<H*.0025 and max(forward['max_units'],reverse['max_units'])<H*.012
    trials.append(dict(ratio=ratio,triangles=len(T),forward=forward,reverse=reverse,passed=passed))
    if passed:lod=trial;break
    mesh=trial.data;bpy.data.objects.remove(trial,do_unlink=True);bpy.data.meshes.remove(mesh)
assert lod is not None
bpy.data.objects.remove(obj,do_unlink=True);lod.name='KohakuSurface'
for index,material in enumerate(lod.data.materials):lod.data.materials[index]=bpy.data.materials.new('LODGeometrySlot_'+material.name)
bpy.ops.object.select_all(action='DESELECT');lod.select_set(True);rig.select_set(True)
bpy.ops.export_scene.gltf(filepath=str(out/'lod.glb'),export_format='GLB',use_selection=True,export_animations=False,export_yup=True,export_skins=True,export_def_bones=False)
sha=lambda f:hashlib.sha256(f.read_bytes()).hexdigest()
record.update(candidate=1,revision=a.revision,modelKey='kohaku',sha256=sha(out/'candidate.glb'),bytes=(out/'candidate.glb').stat().st_size,bones=[b[0] for b in plan],landmarks=marks,tailSign=tail_sign,tailPoints=tail_points,petContactBlender=contact.tolist(),weights=weight_report,clips=clip_records,lod=dict(sha256=sha(out/'lod.glb'),triangles=len(lod.data.polygons),trials=trials,distanceMetres=8,originalRig=True),locomotion={'Walk_Loop':dict(metresPerSecond=walk.stride()/.72,cycleSeconds=.72),'Run_Loop':dict(metresPerSecond=run.stride()/.40,cycleSeconds=.40)},testsRun=False,browserValidationRun=False)
(out/'rig.json').write_text(json.dumps(record,indent=2)+'\n');print(json.dumps(dict(path=str(out),triangles=len(F),bones=len(plan),clips=len(clips))),flush=True)
