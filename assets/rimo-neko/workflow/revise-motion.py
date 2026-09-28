"""Revise only Hiss/Run on the retained Candidate 1 rig, without remeshing.

Sources and the distinction between observed motion and authored timing are in
../motion-research-2026-09-28.md. Other five Blender actions stay untouched.
"""
import argparse, copy, hashlib, json, math, struct, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0, str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base
ap = argparse.ArgumentParser()
ap.add_argument('--revision', default='04')
args = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
M = ROOT/'output/model-generation/models/rimo-neko'
source = M/'work/rig/revision-03'
out = M/f'work/rig/revision-{args.revision}'
assert not (out/'candidate.glb').exists(), 'Retain previous revisions'
out.mkdir(parents=True, exist_ok=True)
record = json.loads((source/'process.json').read_text(encoding='utf8'))
bpy.ops.wm.open_mainfile(filepath=str(source/'source.blend'))
obj = bpy.data.objects['RimoNekoSurface']
rig = bpy.data.objects['RimoNekoArmature']
rig.animation_data.action = None
for track in rig.animation_data.nla_tracks: track.mute = True
base.rest_pose(rig)
bpy.context.view_layer.update()
P = base.positions(obj.data)
paws = record['paws']
PB, DB = rig.pose.bones, rig.data.bones
rest = {b.name: b.matrix_local.copy() for b in DB}
side = Vector(record['mouthRepair']['side'])
forward = Vector(record['mouthRepair']['forward'])
up = Vector(record['mouthRepair']['up'])
FPS = 240
# Keep the five retained Blender actions at their original real-time durations.
# Their original exported buffers are copied verbatim into the final GLB below.
for action in bpy.data.actions:
    for curve in base.action_fcurves(action):
        for key in curve.keyframe_points:
            key.co.x *= FPS/60
            key.handle_left.x *= FPS/60
            key.handle_right.x *= FPS/60
    action.frame_start *= FPS/60
    action.frame_end *= FPS/60
RUN = dict(speed=2.0, cycle=.5, duty=7/30, lift=.083,
           touchdown={'FL':0, 'FR':2/30, 'BR':.5, 'BL':17/30})
LEGS = {k: tuple(n+k[1] for n in (('UpperArm.', 'LowerArm.', 'Hand.')
        if k[0]=='F' else ('UpperLeg.', 'LowerLeg.', 'Foot.'))) for k in paws}
neutral = {k:Vector((0, -.027 if k[0]=='F' else 0, -p['floor']+.001)) for k,p in paws.items()}
footMasks = {k:(abs(P[:,0]-p['x'])<.061)&(abs(P[:,1]-p['y'])<.083)&(P[:,2]<.037)
             for k,p in paws.items()}
sm = lambda x: max(0,min(1,x))**2*(3-2*max(0,min(1,x)))
def upd(): bpy.context.view_layer.update()
def set_dir(bone, a, b):
    rb = DB[bone]
    q = (rb.tail_local-rb.head_local).rotation_difference(b-a) @ rb.matrix_local.to_quaternion()
    PB[bone].matrix = Matrix.Translation(a) @ q.to_matrix().to_4x4()
    upd()
def solve_leg(k, disp, pitch, stats):
    if k[0]=='F':
        scap = 'Shoulder.'+k[1]
        PB[scap].location = rest[scap].to_3x3().inverted() @ Vector((0,(disp.y-neutral[k].y)*.43,-.005))
        upd()
    upper, lower, end = LEGS[k]
    start = PB[upper].head.copy()
    goal = rest[end].to_translation()+disp
    a,b = DB[upper].length, DB[lower].length
    axis = goal-start
    requested = axis.length
    axis.normalize()
    d = min(max(requested,abs(a-b)+.0003),a+b-.0003)
    stats[k] = max(stats[k], requested-d)
    goal = start+axis*d
    along = (a*a-b*b+d*d)/(2*d)
    height = math.sqrt(max(0,a*a-along*along))
    pole = Vector((0,1 if k[0]=='F' else -1,0))
    pole -= axis*pole.dot(axis)
    pole.normalize()
    joint = start+axis*along+pole*height
    set_dir(upper,start,joint)
    set_dir(lower,joint,goal)
    q = Quaternion((1,0,0), math.radians(pitch)) @ rest[end].to_quaternion()
    PB[end].matrix = Matrix.Translation(goal) @ q.to_matrix().to_4x4()
    upd()
def rotate(bone, axis, degrees):
    PB[bone].rotation_quaternion = Quaternion((DB[bone].matrix_local.to_3x3().inverted() @ axis).normalized(), math.radians(degrees))
def flatten_ears(amount):
    for lr in 'LR':
        bone = DB['Ear.'+lr]
        # Each pinna gets its own rest-direction solve; a shared angle left one
        # of the asymmetrically modelled ears too upright in revision 03.
        desired = (-forward*.88 + side*(.42 if lr=='L' else -.42) - up*.26).normalized()
        basis = bone.matrix_local.to_quaternion()
        world = (bone.tail_local-bone.head_local).rotation_difference(desired)
        local = basis.inverted() @ world @ basis
        PB[bone.name].rotation_quaternion = Quaternion((1,0,0,0)).slerp(local, amount)
def common(): return {'Neck':{'yaw':-16},'Head':{'yaw':-24},'Hips':{'loc':(0,0,-.012)}}
def hiss(t):
    k = sm(t/.22)*(1-sm((t-1.70)/.40))
    pose = common()
    pose['Hips'] = {'loc':(0,.028*k,-.012-.105*k),'pitch':-10*k}
    pose['Spine'] = {'pitch':18*k}
    pose['Chest'] = {'pitch':8*k}
    pose['Neck'].update(pitch=7*k, yaw=-16-3*k)
    pose['Head']['pitch'] = -20*k
    for i in range(5):
        pose[f'Tail{i+1}'] = {'pitch':(-6 if i==0 else -2)*k,
                              'yaw':(3+(.7 if i<3 else 1.7)*math.sin(t*7-i*.7))*k}
    legs = {key:neutral[key].copy() for key in LEGS}
    for key in legs: legs[key].x += (.010 if key[1]=='L' else -.010)*k
    return pose, legs, {k:0 for k in legs}, (29+1.2*math.sin(t*13))*k, k
def run(t):
    u = t/RUN['cycle']
    w = 2*math.pi*u
    flex = math.cos(2*math.pi*(u-.36))
    pose = common()
    pose['Hips'] = {'loc':(0,.010*flex,-.065+.023*math.cos(w-1.7*math.pi)+.008*math.cos(2*w-.2*math.pi)), 'pitch':-24*flex}
    pose['Spine'] = {'pitch':40*flex}
    pose['Chest'] = {'pitch':6-9*flex,'roll':.6*math.sin(w)}
    pose['Neck']['pitch'] = 4-7*flex
    pose['Head']['pitch'] = -6
    for i in range(5):
        pose[f'Tail{i+1}'] = {'pitch':(12 if i==0 else 1.5)*math.cos(2*math.pi*(u-.36)-i*.18),
                              'yaw':(1+i*.4)*math.sin(w-i*.35)}
    legs, pitches = {}, {}
    span = RUN['speed']*RUN['cycle']*RUN['duty']
    for key, touchdown in RUN['touchdown'].items():
        phase = (u-touchdown)%1
        if phase<RUN['duty']:
            y,z,pitch = span*(phase/RUN['duty']-.5),0,0
        else:
            swing = (phase-RUN['duty'])/(1-RUN['duty'])
            y = span*(.5-sm(swing))
            z = RUN['lift']*math.sin(math.pi*swing)**1.2
            pitch = (58 if key[0]=='F' else 32)*math.sin(math.pi*swing)**2
        # Hind paws land under the abdomen and propel rearwards; forelimbs
        # reach out to receive the body. These are not diagonal trot pairs.
        y += 0 if key[0]=='B' else -.006
        legs[key] = neutral[key]+Vector((0,y,z))
        pitches[key] = pitch
    return pose, legs, pitches, 0, 0

clips = {'Run_Loop':(.5,True,run), 'Hiss':(2.1,False,hiss)}
checks = []
bpy.context.scene.render.fps = FPS
for name,(seconds,loop,fn) in clips.items():
    old = bpy.data.actions.get(name)
    assert old is not None, name
    bpy.data.actions.remove(old)
    action = bpy.data.actions.new(name)
    action.use_fake_user = True
    rig.animation_data.action = action
    rig.animation_data.action_slot = action.slots.new(id_type='OBJECT',name=name)
    n = round(seconds*FPS)
    minima, samples = [], []
    shortfall = {k:0 for k in LEGS}
    for frame in range(n+1):
        t = seconds*frame/n if not loop or frame<n else 0
        pose, legs, pitches, jaw, ears = fn(t)
        for bone,spec in pose.items():
            if 'loc' in spec: spec['loc'] = tuple(rest[bone].to_3x3().inverted() @ Vector(spec['loc']))
        base.apply_pose(rig,pose)
        rotate('Jaw',side,jaw)
        flatten_ears(ears)
        upd()
        for k,d in legs.items(): solve_leg(k,d,pitches[k],shortfall)
        q = base.evaluated_positions(obj)
        for k,d in legs.items():
            minimum = float(q[footMasks[k],2].min())
            desired = d.z-neutral[k].z+.001
            if minimum<desired-.0004:
                d.z += desired-minimum
                solve_leg(k,d,pitches[k],shortfall)
        q = base.evaluated_positions(obj)
        minima.append(float(q[:,2].min()))
        samples.append(dict(time=t,minimum=minima[-1],paws={k:float(q[mask,2].min()) for k,mask in footMasks.items()},
                            joints={b:list(PB[b].head) for b in ['Hips','Spine','Chest','Neck','Head']}))
        for b in PB:
            b.keyframe_insert(data_path='rotation_quaternion',frame=frame)
            b.keyframe_insert(data_path='location',frame=frame)
    base.set_interpolation(action,'LINEAR')
    action.use_frame_range = True
    action.frame_start,action.frame_end = 0,n
    checks.append(dict(clip=name,minimum=min(minima),maxShortfall=shortfall,samples=samples))
    rig.animation_data.action = None
    base.rest_pose(rig)
    upd()
    print('CLIP_READY',name,min(minima),shortfall,flush=True)
base.FPS = FPS
base.export(out/'motion-export.glb',list(bpy.data.actions))
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
def unpack(path):
    data=path.read_bytes();end=20+struct.unpack_from('<I',data,12)[0]
    return json.loads(data[20:end]),data[end+8:]
original,oldbin=unpack(source/'candidate.glb')
revised,newbin=unpack(out/'motion-export.glb')
assert original['nodes']==revised['nodes'], 'No rest-rig changes are permitted'
binary=bytearray(oldbin)
views,accessors={},{}
def copy_accessor(index):
    if index in accessors:return accessors[index]
    a=copy.deepcopy(revised['accessors'][index]);v=a['bufferView']
    if v not in views:
        b=copy.deepcopy(revised['bufferViews'][v]);offset=b.get('byteOffset',0)
        while len(binary)%4:binary.append(0)
        b['byteOffset']=len(binary);b['buffer']=0
        binary.extend(newbin[offset:offset+b['byteLength']])
        views[v]=len(original['bufferViews']);original['bufferViews'].append(b)
    a['bufferView']=views[v];accessors[index]=len(original['accessors']);original['accessors'].append(a)
    return accessors[index]
for i,old in enumerate(original['animations']):
    if old['name'] not in clips:continue
    new=copy.deepcopy(next(c for c in revised['animations'] if c['name']==old['name']))
    for sampler in new['samplers']:
        sampler['input']=copy_accessor(sampler['input']);sampler['output']=copy_accessor(sampler['output'])
    original['animations'][i]=new
original['buffers'][0]['byteLength']=len(binary)
j=json.dumps(original,separators=(',',':')).encode('utf8');j+=b' '*((-len(j))%4)
binary.extend(b'\0'*((-len(binary))%4))
data=struct.pack('<III',0x46546c67,2,28+len(j)+len(binary))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(binary),0x004e4942)+binary
(out/'candidate.glb').write_bytes(data)
record.update(revision=args.revision,sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),bytes=(out/'candidate.glb').stat().st_size,
              animationSource=str(source/'source.blend'),parentSha256=record['sha256'],changedClips=list(clips),checks=checks,
              preserved='Same mesh, normals, UVs, materials, rest rig, skin weights, and five other actions')
record['clips'] = [dict(c,seconds=clips[c['name']][0],fps=FPS) if c['name'] in clips else c for c in record['clips']]
walk = record['locomotion']['Walk_Loop']
walk.update(metresPerSecond=.47*.68/(41/60), authoredCycleSeconds=.68, gait='walk', touchdownPhases={'BL':0,'FL':.75,'BR':.5,'FR':.25})
record['locomotion']['Run_Loop'] = dict(metresPerSecond=RUN['speed'],cycleSeconds=RUN['cycle'],authoredCycleSeconds=RUN['cycle'],
    dutyFactor=RUN['duty'],gait='feline-gallop',touchdownPhases=RUN['touchdown'],airbornePhases=[[.3,.5],[.8,1]],
    strideMetres=RUN['speed']*RUN['cycle'],timingBasis='Authored to fit this cat; observed sequence, not motion capture')
record['locomotionSpeedIsExported'] = True
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n',encoding='utf8')
(out/'rig-source.py').write_bytes(Path(__file__).read_bytes())
print('RIG_DONE',record['sha256'],flush=True)
