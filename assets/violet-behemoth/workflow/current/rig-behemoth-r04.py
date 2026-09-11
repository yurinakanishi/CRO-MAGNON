"""Body-specific rig of the retained TRELLIS surface. No visible geometry added.

Revision 04: the tail is a damped chain (tail_whip.py). It undulates and lags in
Walk/Run/Charge and coils, lags and cracks through the TailSpin. Surface, skin
weights and the other five clips are unchanged from revision 03."""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy,numpy as np
from mathutils import Vector,Quaternion,Matrix
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M=ROOT/'output/model-generation/models/violet-behemoth'
sys.path.insert(0,str(M/'workflow/candidate-01'))
import blender_rig as base,skin_weights as sw,graph_tools as gt
sys.path.insert(0,str(M/'workflow/current'))
import tail_whip
ap=argparse.ArgumentParser();ap.add_argument('--revision',default='01');args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
out=M/f'work/rig/revision-{args.revision}';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists()
source=M/'work/low-poly/revision-05/candidate.glb'
obj=base.import_mesh(source);topology=base.weld_and_shade(obj,angle_degrees=50)
obj.name='VioletBehemothSurface';P=base.positions(obj.data);F=base.mesh_triangles(obj.data)
H=float(np.ptp(P[:,2]));base.H=H
lo,hi=P.min(0),P.max(0);W=float(np.ptp(P[:,0]));L=float(np.ptp(P[:,1]))
assert abs(L-6)<.01,(lo,hi)
# Coordinates measured as proportions of the accepted 4 m aligned surface.
# The tiny hind bones follow the abdomen; they are not a walking leg chain.
def p(x,y,z):return [x*W,y*4,z*H]
plan=[('Root',[0,0,0],[0,0,.1],None,False),
 ('Hips',p(0,.035,.28),p(0,-.08,.40),'Root',False),
 ('Chest',p(0,-.08,.40),p(0,-.23,.62),'Hips',False),
 ('Head',p(0,-.23,.62),p(0,-.34,.86),'Chest',False),
 ('Jaw',p(0,-.28,.56),p(0,-.40,.51),'Head',False)]
for side,s in [('L',1),('R',-1)]:
    shoulder=p(s*.255,-.19,.62);elbow=p(s*.35,-.255,.34);wrist=p(s*.38,-.345,.105);tip=p(s*.38,-.435,.065)
    plan += [('UpperArm.'+side,shoulder,elbow,'Chest',False),('LowerArm.'+side,elbow,wrist,'UpperArm.'+side,True),('Hand.'+side,wrist,tip,'LowerArm.'+side,True),
      ('Hind.'+side,p(s*.17,.125,.14),p(s*.24,.15,.035),'Hips',False)]
for i in range(7):
    a=.08+i*(.92/7);b=a+.92/7
    plan.append((f'Tail{i+1}',p(0,a,max(.02,.26-i*.034)),p(0,b,max(.015,.26-(i+1)*.034)),'Hips' if i==0 else f'Tail{i}',False))
rig=base.build_armature(plan);rig.data.name='VestigialHindForearmTailRig'
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig;bpy.ops.object.parent_set(type='ARMATURE_NAME')
for g in list(obj.vertex_groups):obj.vertex_groups.remove(g)
segments=[(b.name,np.asarray(b.head_local),np.asarray(b.tail_local)) for b in rig.data.bones if b.name!='Root'];names=[s[0] for s in segments]
weights,report=sw.solve(P,F,segments,radius=.18,power=1.6,smooth_iterations=80,bridge_radius=.003)
def ramp(a,b,x):return np.clip((x-a)/(b-a),0,1)
def blend(target,amount):
    global weights
    weights=weights*(1-amount[:,None])+target*amount[:,None]
# Tail weights follow longitudinal position so the thick tail bends continuously.
t=np.clip((P[:,1]-.32)/(3.68/7),0,6);target=np.zeros_like(weights)
for i in range(7):target[:,names.index(f'Tail{i+1}')]=np.maximum(0,1-abs(t-i))
target/=np.maximum(target.sum(1)[:,None],1e-9);blend(target,ramp(.35,.85,P[:,1]))
head=ramp(.56*H,.78*H,P[:,2])*(1-ramp(.18*W,.30*W,abs(P[:,0])))
target=np.zeros_like(weights);target[:,names.index('Head')]=1;blend(target,head)
edges=gt.unique_edges(F);starts,neighbours=gt.adjacency(len(P),edges)
weights=sw.laplacian_smooth(weights,starts,neighbours,260,.45)
cutoff=np.sort(weights,axis=1)[:,-5];weights=np.maximum(weights-cutoff[:,None],0);weights/=weights.sum(1)[:,None]
for col,name in enumerate(names):
    group=obj.vertex_groups.new(name=name)
    for idx in np.nonzero(weights[:,col]>1e-8)[0]:group.add([int(idx)],float(weights[idx,col]),'REPLACE')
report.update(base.normalise_weights(obj,rig))
bpy.context.scene.render.fps=30
rest={b.name:{} for b in rig.pose.bones}
durations={'Idle_Loop':3,'Walk_Loop':1.2,'Run_Loop':.8,'Alert':.7,'Charge':2.4,'Attack':1,'TailSpin':1.5,'Hit':.3,'Death':1.6}
actions=[];floor=[]
# Tail secondary motion: authored gait waves passed through the damped chain and
# reduced to exact sinusoids (loop seam closes); the spin is a simulated one-shot.
TAIL_GAIT={'walk':tail_whip.gait_yaw(1.2,2.0,0.9,0.5)[0],'run':tail_whip.gait_yaw(.4,1.2,.45,.8)[0]}
TAIL_SPIN=tail_whip.spin_profile()[0]
TAIL_PITCH={'walk':(.5,.25,.6),'run':(.8,.35,.7)}
def solve_forearm(side,phase,speed,cycle,duty):
    upper=rig.pose.bones['UpperArm.'+side];lower=rig.pose.bones['LowerArm.'+side];hand=rig.pose.bones['Hand.'+side]
    start=upper.head.copy();l1=rig.data.bones[upper.name].length;l2=rig.data.bones[lower.name].length
    stride=speed*cycle*duty;stance=phase<duty
    if stance:along=-stride*.5+speed*cycle*phase;lift=0
    else:
        u=(phase-duty)/(1-duty);along=stride*.5-stride*(u*u*(3-2*u));lift=.22*H*math.sin(math.pi*u)
    sign=1 if side=='L' else -1
    goal=Vector((sign*W*(.37+(.045*math.sin(math.pi*(phase-duty)/(1-duty)) if not stance else 0)),start.y+along,.105*H+lift))
    axis=goal-start;d=axis.length;axis.normalize();reach=l1+l2-.002
    if d>reach:goal=start+axis*reach;d=reach
    d=max(abs(l1-l2)+.002,d)
    along_elbow=(l1*l1-l2*l2+d*d)/(2*d);height=math.sqrt(max(0,l1*l1-along_elbow*along_elbow))
    pole=Vector((sign*.7,.8,.25));pole-=axis*pole.dot(axis);pole.normalize();elbow=start+axis*along_elbow+pole*height
    for bone,a,b in [(upper,start,elbow),(lower,elbow,goal)]:
        restbone=rig.data.bones[bone.name];q=(restbone.tail_local-restbone.head_local).rotation_difference(b-a)@restbone.matrix_local.to_quaternion()
        bone.matrix=Matrix.Translation(a)@q.to_matrix().to_4x4();bpy.context.view_layer.update()
    q=rig.data.bones[hand.name].matrix_local.to_quaternion()
    hand.matrix=Matrix.Translation(goal)@q.to_matrix().to_4x4();bpy.context.view_layer.update()
for name,duration in durations.items():
    poses=[];n=round(duration*30)
    for frame in range(n+1):
        sec=frame/30;u=frame/n;pose={b:{} for b in rest}
        amp=math.sin(math.pi*u)
        if name=='Idle_Loop':
            pose['Chest']={'pitch':.6*math.sin(u*2*math.pi)}
            for i in range(7):pose[f'Tail{i+1}']={'yaw':1.2*math.sin(u*2*math.pi-i*.4)}
        elif name in ['Walk_Loop','Run_Loop','Charge']:
            run=name!='Walk_Loop';cycle=.4 if run else 1.2;t=sec/cycle*2*math.pi
            pose['Chest']={'yaw':2*math.sin(t),'pitch':1.5*math.cos(2*t)}
            for side,s in [('L',1),('R',-1)]:
                phase=t+(0 if s==1 else math.pi)
                # Strong swimming-like forearm strokes, alternating planted pushes.
                pose['UpperArm.'+side]={'pitch':(26 if run else 18)*math.sin(phase),'roll':s*(7 if run else 3)*(1-math.cos(phase)),'yaw':s*5*math.sin(phase)}
                pose['LowerArm.'+side]={'pitch':-(22 if run else 12)*max(0,math.sin(phase))}
                pose['Hand.'+side]={'pitch':-(18 if run else 12)*math.sin(phase)}
                pose['Hind.'+side]={'yaw':s*2*math.sin(t-.4)}
            gait='run' if run else 'walk';bob,bobGrowth,bobLag=TAIL_PITCH[gait]
            for i in range(7):pose[f'Tail{i+1}']={'yaw':TAIL_GAIT[gait](sec/cycle,i),'pitch':(bob+bobGrowth*i)*math.sin(2*t-bobLag*i)}
        elif name=='Alert':
            pose['Chest']={'pitch':-3*amp};pose['Head']={'pitch':-3*amp}
            for i in range(7):pose[f'Tail{i+1}']={'yaw':13*math.sin(u*4*math.pi-i*.5)*amp}
        elif name=='Attack':
            strike=math.sin(math.pi*min(1,u/.5)) if u<.5 else math.sin(math.pi*(u-.5)/.5)
            pose['Chest']={'pitch':-9*math.sin(math.pi*u)}
            pose['Head']={'pitch':-15*math.sin(math.pi*u)}
            pose['Jaw']={'pitch':-22*max(0,math.sin(math.pi*min(1,u/.5)))}
        elif name=='TailSpin':
            # Internal body yaw, not world translation; full 360 degrees is sampled.
            # The body leads by 0.12 s so the lagging tail tip follows the server sweep.
            pose['Hips']={'yaw':tail_whip.hips_yaw(sec)}
            for i in range(7):pose[f'Tail{i+1}']={'yaw':float(TAIL_SPIN[frame,i]),'pitch':1.5*amp}
            for side,s in [('L',1),('R',-1)]:pose['UpperArm.'+side]={'roll':s*8*amp}
        elif name=='Hit':pose['Chest']={'pitch':5*amp};pose['Head']={'pitch':8*amp}
        elif name=='Death':
            k=min(1,u/.8);k=k*k*(3-2*k)
            pose['Hips']={'roll':float(100*k)};pose['Head']={'pitch':float(12*k)}
            for side,s in [('L',1),('R',-1)]:pose['UpperArm.'+side]={'roll':float(-s*10*k),'pitch':float(0*k)}
        poses.append((frame,pose))
    action,_=base.make_action(rig,{'name':name,'poses':poses,'interpolation':'LINEAR'})
    actions.append(action)
    # Ground the exact deformed mesh by the Hips translation, without horizontal root motion.
    rig.animation_data.action=action
    if hasattr(rig.animation_data,'action_slot'):rig.animation_data.action_slot=action.slots[0]
    inverse=rig.data.bones['Hips'].matrix_local.to_3x3().inverted();mins=[]
    for frame in range(n+1):
        bpy.context.scene.frame_set(frame);bpy.context.view_layer.update()
        if name in ['Walk_Loop','Run_Loop','Charge']:
            run=name!='Walk_Loop';cycle=.4 if run else 1.2;speed=5.15 if name=='Charge' else 4.9 if run else 1.35;duty=.48 if run else .62
            for side,offset in [('L',0),('R',.5)]:
                solve_forearm(side,(frame/30/cycle+offset)%1,speed,cycle,duty)
                for prefix in ['UpperArm.','LowerArm.','Hand.']:
                    bone=rig.pose.bones[prefix+side];bone.keyframe_insert(data_path='rotation_quaternion',frame=frame);bone.keyframe_insert(data_path='location',frame=frame)
        q=base.evaluated_positions(obj);minimum=float(q[:,2].min());mins.append(minimum)
        bone=rig.pose.bones['Hips'];bone.location+=inverse@Vector((0,0,-minimum+.002));bone.keyframe_insert(data_path='location',frame=frame)
    base.set_interpolation(action,'LINEAR');floor.append({'clip':name,'originalMinimum':min(mins),'originalMaximumMinimum':max(mins)})
    rig.animation_data.action=None;base.rest_pose(rig)
    print('CLIP_READY',name,flush=True)
base.rest_pose(rig);bpy.context.view_layer.update();base.export(out/'candidate.glb',actions)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
result={'candidate':1,'revision':args.revision,'source':str(source.relative_to(M)),'sha256':hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
 'bytes':(out/'candidate.glb').stat().st_size,'heightMetres':H,'lengthMetres':L,'widthMetres':W,'boundsBlender':{'min':lo.tolist(),'max':hi.tolist()},
 'upAxis':'Y','forwardAxis':'+Z','triangles':len(F),'topology':topology,'weights':report,'bones':[b[0] for b in plan],'bonePlan':plan,'groundLock':floor,
 'clips':[{'name':n,'loop':n.endswith('_Loop'),'seconds':s,'rootMotion':'in-place'} for n,s in durations.items()],
 'locomotion':{'Walk_Loop':{'metresPerSecond':1.35,'cycleSeconds':1.2,'dutyFactor':.62},'Run_Loop':{'metresPerSecond':4.9,'cycleSeconds':.4,'dutyFactor':.48}},
 'geometryOrigin':'Original TRELLIS surface only; vestigial rear appendages have no power gait.','visualReviewRequired':True}
(out/'process.json').write_text(json.dumps(result,indent=2)+'\n');print('RIG_DONE',result['sha256'],flush=True)
