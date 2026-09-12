"""Reanimate the retained r08 TRELLIS skin, with planted forearms and a soft tail.

No mesh/material/weight edits. Authored motion (not mocap), 60 Hz IK baked keys.
The torso, supporting hands and tail have separate floor constraints: a drooping
tail can never translate the whole skeleton off the floor again.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector, Matrix

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M = ROOT/'output/model-generation/models/violet-behemoth'
sys.path.insert(0, str(M/'workflow/candidate-01'))
import blender_rig as base

ap = argparse.ArgumentParser()
ap.add_argument('--revision', default='09')
args = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
out = M/f'work/rig/revision-{args.revision}'
out.mkdir(parents=True, exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Keep every finished revision'
bpy.ops.wm.open_mainfile(filepath=str(M/'work/rig/revision-08/source.blend'))
rig = next(o for o in bpy.data.objects if o.type == 'ARMATURE')
obj = next(o for o in bpy.data.objects if o.type == 'MESH')
rig.animation_data_clear()
base.rest_pose(rig)
bpy.context.view_layer.update()
P = base.positions(obj.data)
W, L, H = np.ptp(P, axis=0)
base.H = H
base.FPS = 60
bpy.context.scene.render.fps = 60
FPS = 60
durations = {'Roar':1.2, 'Gape':.6, 'Tremble':.9, 'Charge':2.4,
             'TailSpin':1.5, 'SpitWindup':1.3, 'Spit':.9}
# Retime retained actions without changing the motion's duration.
for a in list(bpy.data.actions):
    if a.name in durations:
        bpy.data.actions.remove(a)
        continue
    for f in base.action_fcurves(a):
        for k in f.keyframe_points:
            k.co.x *= 2
            k.handle_left.x *= 2
            k.handle_right.x *= 2
    if a.use_frame_range:
        a.frame_end *= 2
        a.frame_start *= 2

smooth = lambda t: (lambda v:v*v*(3-2*v))(max(0., min(1., t)))
envelope = lambda u: smooth(u/.28)*(1-smooth((u-.7)/.3))
hips_inv = rig.data.bones['Hips'].matrix_local.to_3x3().inverted()
hands = {s:rig.data.bones['Hand.'+s].head_local.copy() for s in ['L','R']}
hand_masks = {s:(P[:,0]*(1 if s=='L' else -1)>.14*W)&(P[:,1]<-1.12)&(P[:,2]<.24*H) for s in hands}
tail_mask = P[:,1]>.9
body_mask = ~(tail_mask | hand_masks['L'] | hand_masks['R'])

def solve_hand(side, goal, yaw=0):
    """Two-bone IK; neither bone lengths nor the palm orientation are scaled."""
    upper, lower, hand = [rig.pose.bones[k+side] for k in ['UpperArm.','LowerArm.','Hand.']]
    start = upper.head.copy()
    l1, l2 = upper.bone.length, lower.bone.length
    axis = goal-start
    d = axis.length
    # The massive shoulder blade slides over the chest as the palm takes weight.
    if d >= l1+l2-.008 and d < l1+l2+.22:
        start += axis.normalized()*(d-(l1+l2-.008))
        axis = goal-start
        d = axis.length
    if not abs(l1-l2)+.001 < d < l1+l2-.001:
        raise ValueError(f'Unreachable planted hand {side}: {d}, reach {l1+l2}')
    axis.normalize()
    a = (l1*l1-l2*l2+d*d)/(2*d)
    rot = Matrix.Rotation(math.radians(yaw), 4, 'Z')
    pole = rot.to_3x3()@Vector(((1 if side=='L' else -1)*.7,.8,.25))
    pole -= axis*pole.dot(axis)
    pole.normalize()
    elbow = start+axis*a+pole*math.sqrt(max(0,l1*l1-a*a))
    for bone, p, q in [(upper,start,elbow),(lower,elbow,goal)]:
        rest = bone.bone
        # Solve bend in the rotating torso frame, then rotate the entire chain.
        # World-space shortest-arc IK otherwise flips the elbow's twist at 180°.
        local_direction = rot.to_3x3().inverted()@(q-p)
        orientation = rot.to_quaternion()@(rest.tail_local-rest.head_local).rotation_difference(local_direction)@rest.matrix_local.to_quaternion()
        bone.matrix = Matrix.Translation(p)@orientation.to_matrix().to_4x4()
        bpy.context.view_layer.update()
    hand.matrix = Matrix.Translation(goal)@rot@hand.bone.matrix_local.to_quaternion().to_matrix().to_4x4()
    bpy.context.view_layer.update()

def spin_yaw(t):
    # Ease angular acceleration over 120 ms; keep the existing 0.45–1.30 s sweep.
    v = max(0., min(1., (t-.33)/.97))
    return 360*smooth(v)

def pose_at(name, t, duration):
    u = t/duration
    pose = {b.name:{} for b in rig.pose.bones}
    yaw, lower, back = 0., 0., 0.
    if name == 'Roar':
        k = envelope(u)
        # Hands brace while the chest exhales, then leans LOW into the charge.
        pose['Chest'] = {'pitch':7*k, 'yaw':1.8*math.sin(u*math.pi*2)*k}
        pose['Head'] = {'pitch':-9*k+15*smooth((u-.42)/.3)*(1-smooth((u-.84)/.16))}
        pose['Jaw'] = {'pitch':23*math.sin(math.pi*min(1,u/.72))}
        back = .055*k
        for i in range(7):
            pose[f'Tail{i+1}'] = {'pitch':(3.5 if i==0 else .8)*k,
                                     'yaw':(1.4+.6*i)*math.sin(t*7-i*.55)*k}
    elif name == 'Tremble':
        k = envelope(u)
        pose['Hips'] = {'yaw':-9*k}
        pose['Chest'] = {'yaw':-9*k, 'pitch':4*k}
        pose['Head'] = {'yaw':12*k, 'pitch':3*k}
        back = .025*k
        for i in range(7):
            # Raised, curved tail and an opposite-direction coil, no shudder.
            delayed = envelope(max(0,u-i*.022))*(1-smooth((u-.88)/.12))
            pose[f'Tail{i+1}'] = {'pitch':(10 if i==0 else 1.1)*k,
                                     'yaw':-(3.4+i*.55)*delayed}
    elif name == 'Gape':
        k = envelope(u)
        pose['Chest'] = {'pitch':2*k}
        pose['Head'] = {'pitch':-12*k}
        pose['Jaw'] = {'pitch':28*k}
        back = .04*k
    elif name in ['SpitWindup','Spit']:
        # Continuous joint pose across windup -> release; discharge is at 0.18s.
        k = smooth(u/.7) if name=='SpitWindup' else 1-smooth(t/.38)
        recoil = 0 if name=='SpitWindup' else math.sin(math.pi*min(1,t/.5))
        pose['Chest'] = {'pitch':-3*k+5*recoil}
        pose['Head'] = {'pitch':-19*k+13*recoil}
        pose['Jaw'] = {'pitch':34*k+25*recoil}
        back = .1*k-.04*recoil
        for i in range(7):
            pose[f'Tail{i+1}'] = {'pitch':(2 if i==0 else .3)*k,
                                     'yaw':(1+i*.25)*math.sin(t*4-i*.5)*math.sin(math.pi*u)}
    elif name=='Charge':
        # Start slowly; an accelerating travelling wave follows chest -> tip.
        strength = .55+.45*smooth(t/.65)
        phase = 2*math.pi*(1.15*t+.38*(t-.32*(1-math.exp(-t/.32))))
        pose['Chest'] = {'yaw':2.8*strength*math.sin(phase), 'pitch':3*math.sin(math.pi*u)}
        pose['Hips'] = {'yaw':1.3*strength*math.sin(phase-.35)}
        for i in range(7):
            pose[f'Tail{i+1}'] = {'yaw':(4+1.1*i)*strength*math.sin(phase-.7-i*.48),
                                     'pitch':(3.5 if i==0 else .45)*strength}
    elif name=='TailSpin':
        yaw = spin_yaw(t)
        pose['Hips'] = {'yaw':yaw}
        pose['Chest'] = {'yaw':-3*math.sin(math.pi*u), 'pitch':2*math.sin(math.pi*u)}
        for i in range(7):
            # Each segment follows the preceding segment 26 ms later. The tip
            # catches up and overshoots after the body stops (damped settling).
            parent_delay = i*.026
            lag = spin_yaw(t-(i+1)*.026)-spin_yaw(t-parent_delay)
            release = max(0,t-1.05-i*.026)
            settle = (2+i*.25)*math.sin(release*18)*math.exp(-release*9) if release else 0
            pose[f'Tail{i+1}'] = {'yaw':lag+settle, 'pitch':(8 if i==0 else .65)*math.sin(math.pi*u)}
    pose['Hips']['loc'] = tuple(hips_inv@Vector((0,back,lower)))
    return pose, yaw

records=[]
for name,duration in durations.items():
    n=round(duration*FPS)
    action,_=base.make_action(rig, {'name':name, 'poses':[(0,{b.name:{} for b in rig.pose.bones}), (n,{})], 'interpolation':'LINEAR'})
    rig.animation_data.action=action
    rig.animation_data.action_slot=action.slots[0]
    mins=[]; supports=[]; hip_heights=[]; mouth=None
    for f in range(n+1):
        t=f/FPS
        bpy.context.scene.frame_set(f)
        pose,yaw=pose_at(name,t,duration)
        base.apply_pose(rig,pose)
        bpy.context.view_layer.update()
        # Keep the belly above the plane; tail/arms NEVER lift the torso.
        q=base.evaluated_positions(obj)
        dz=max(0,.003-float(q[body_mask,2].min()))
        rig.pose.bones['Hips'].location+=hips_inv@Vector((0,0,dz))
        bpy.context.view_layer.update()
        # Lift only the tail when it droops below the plane.
        for _ in range(50):
            q=base.evaluated_positions(obj)
            if q[tail_mask,2].min()>=.002: break
            pose['Tail1']['pitch']=pose['Tail1'].get('pitch',0)+.75
            rig.pose.bones['Tail1'].rotation_quaternion=base.world_axis_rotation(rig.pose.bones['Tail1'],**pose['Tail1'])
            bpy.context.view_layer.update()
        rot=Matrix.Rotation(math.radians(yaw),4,'Z')
        for side,offset in [('L',0),('R',.5)]:
            pivot=rig.data.bones['Hips'].head_local
            goal=pivot+rot.to_3x3()@(hands[side]-pivot)
            lift=0
            if name=='Charge':
                phase=(t/.65+offset)%1
                duty=.64
                stride=.42
                if phase<duty: goal.y+=stride*(phase/duty-.5)
                else:
                    v=(phase-duty)/(1-duty)
                    goal.y+=stride*(.5-smooth(v));lift=.095*math.sin(math.pi*v)
            elif name=='TailSpin':
                phase=(t/.3+offset)%1
                lift=.065*math.sin(math.pi*(phase-.64)/.36) if phase>.64 else 0
            goal.z+=lift
            # Solve against the actual palm's skinned surface, not the wrist.
            for _ in range(5):
                solve_hand(side,goal,yaw)
                q=base.evaluated_positions(obj)
                error=.003+lift-float(q[hand_masks[side],2].min())
                if abs(error)<.0005:break
                goal.z+=error
        q=base.evaluated_positions(obj)
        mins.append(float(q[:,2].min()))
        supports.append(min(float(q[mask,2].min()) for mask in hand_masks.values()))
        hip_heights.append(float(rig.pose.bones['Hips'].head.z))
        if name=='Spit' and f==round(.18*FPS):
            # Mouth aperture on the original surface in the Head rest frame.
            aperture=Vector((0,-1.78,.64*H))
            head=rig.pose.bones['Head']
            mouth=head.matrix@head.bone.matrix_local.inverted()@aperture
            mouth=[float(mouth.x),float(mouth.z),float(-mouth.y)]
        for bone in rig.pose.bones:
            bone.keyframe_insert(data_path='rotation_quaternion',frame=f)
            bone.keyframe_insert(data_path='location',frame=f)
    base.set_interpolation(action,'LINEAR')
    records.append({'clip':name,'minimum':min(mins),'maximumSupportHeight':max(supports),
                    'hipsHeightRange':[min(hip_heights),max(hip_heights)],'mouthAtRelease':mouth})
    rig.animation_data.action=None
    base.rest_pose(rig)
    print('CLIP_READY',json.dumps(records[-1]),flush=True)
base.rest_pose(rig)
bpy.context.view_layer.update()
actions=list(bpy.data.actions)
base.export(out/'candidate.glb',actions)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
old=json.loads((M/'work/rig/revision-08/process.json').read_text())
all_durations={c['name']:c['seconds'] for c in old['clips']}
all_durations.update(durations)
result={**old,'revision':args.revision,'source':'work/rig/revision-08/source.blend',
 'sha256':hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
 'bytes':(out/'candidate.glb').stat().st_size,'fps':FPS,'groundLock':records,
 'clips':[{'name':a.name,'seconds':all_durations[a.name],'loop':a.name.endswith('_Loop'),'rootMotion':'in-place'} for a in actions],
 'motionNotes':'Separate torso/palm/tail constraints; fixed palms on all telegraphs; travelling charge wave and 26 ms per-link spin delay; no telegraph flight.',
 'visualReviewRequired':True}
(out/'process.json').write_text(json.dumps(result,indent=2)+'\n')
print('RIG_DONE',result['sha256'],flush=True)
