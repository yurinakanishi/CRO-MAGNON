"""Measured four-legged rig on the new image-to-TRELLIS surface, without added geometry."""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Vector, Matrix
ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M = ROOT/'output/model-generation/models/violet-behemoth-quadruped'
sys.path.insert(0, str(M/'workflow/candidate-01'))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_rig as base, skin_weights as sw, graph_tools as gt
from motions import pose_at, DURATIONS, LOCOMOTION
ap = argparse.ArgumentParser(); ap.add_argument('--revision', default='01'); ap.add_argument('--clips')
args = ap.parse_args(sys.argv[sys.argv.index('--')+1:])
out = M/f'work/rig/revision-{args.revision}'; out.mkdir(parents=True, exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Never overwrite an exported revision'
source = M/'work/low-poly/revision-01/candidate.glb'
obj = base.import_mesh(source); topology = base.weld_and_shade(obj, angle_degrees=50)
obj.name = 'HornedQuadrupedSurface'; P = base.positions(obj.data); F = base.mesh_triangles(obj.data)
lo, hi = P.min(0), P.max(0); W, L, H = np.ptp(P, axis=0); base.H = H; base.FPS = FPS = 120
bpy.context.scene.render.fps = FPS

# Bone landmarks measured in the source's side/front/bottom renders and slices.
# The front wrist and rear ankle are separate, functional support joints.
plan = [('Root', [0,0,0], [0,0,.15], None, False),
        ('Hips', [0,.8,1.43], [0,.08,1.62], 'Root', False),
        ('Spine', [0,.08,1.62], [0,-.55,1.82], 'Hips', False),
        ('Chest', [0,-.55,1.82], [0,-1.05,2.07], 'Spine', False),
        ('Neck', [0,-1.05,2.07], [0,-1.52,2.24], 'Chest', False),
        ('Head', [0,-1.52,2.24], [0,-2.26,2.25], 'Neck', False),
        ('Jaw', [0,-1.65,2.05], [0,-2.28,1.95], 'Head', False)]
feet_masks, neutral = {}, {}
for side, s in [('L',1), ('R',-1)]:
    shoulder = [s*1.02,-.8,1.8]; elbow = [s*1.3,-.8,.91]; wrist = [s*1.24,-1.2,.24]
    hip = [s*.78,.8,1.48]; knee = [s*.91,.65,.89]; ankle = [s*.83,1.45,.25]
    plan += [('Shoulder.'+side, [s*.6,-.65,1.95], shoulder, 'Chest', False),
             ('UpperArm.'+side, shoulder, elbow, 'Shoulder.'+side, False),
             ('LowerArm.'+side, elbow, wrist, 'UpperArm.'+side, False),
             ('Hand.'+side, wrist, [s*1.24,-1.6,.11], 'LowerArm.'+side, False),
             ('UpperLeg.'+side, hip, knee, 'Hips', False),
             ('LowerLeg.'+side, knee, ankle, 'UpperLeg.'+side, False),
             ('Foot.'+side, ankle, [s*.83,1.08,.09], 'LowerLeg.'+side, False)]
    for end, forward in [('F',-1),('B',1)]:
        k = end+side
        feet_masks[k] = (P[:,0]*s>.38)&(P[:,1]*forward>.45)&(P[:,2]<.19)
        neutral[k] = Vector((0, 0, .003-float(P[feet_masks[k],2].min())))

# Follow the actual curved tail, rather than projecting it onto a straight axis.
tail_points = [[0,1.05,1.46]]
for y in np.linspace(1.48,3.5,6):
    q = P[np.abs(P[:,1]-y)<.06]
    if y < 1.9: q = q[(np.abs(q[:,0])<.45)&(q[:,2]>.72)]
    tail_points.append([float((q[:,0].min()+q[:,0].max())/2), float(y), float(np.quantile(q[:,2], .48))])
tip = P[np.argmax(P[:,2]+np.where(P[:,1]>3.4,0,-100))]
tail_points.append(tip.tolist())
for i in range(7): plan.append((f'Tail{i+1}', tail_points[i], tail_points[i+1], 'Hips' if i==0 else f'Tail{i}', False))
rig = base.build_armature(plan); rig.name = 'HornedQuadrupedRig'; rig.data.name = 'FourSupportLegsAndFlexibleTail'
bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active = rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
segments = [(b.name,np.asarray(b.head_local),np.asarray(b.tail_local)) for b in rig.data.bones if b.name!='Root']
names = [s[0] for s in segments]
weights, report = sw.solve(P,F,segments,radius=.22,power=1.6,smooth_iterations=65,bridge_radius=.004,side_keep_full=.06,side_fade_to=.2)
def ramp(a,b,x): return np.clip((x-a)/(b-a),0,1)
def blend(target, amount):
    global weights
    weights = weights*(1-amount[:,None])+target*amount[:,None]
def to_bone(name, amount):
    target = np.zeros_like(weights); target[:,names.index(name)]=1; blend(target,amount)
# The head and horns turn together. Jaw selection fades back into the throat.
to_bone('Head', (1-ramp(-1.65,-1.15,P[:,1]))*ramp(1.1,1.5,P[:,2]))
to_bone('Head', ramp(2.4,2.65,P[:,2])*(1-ramp(-.65,-.35,P[:,1])))
jaw = (1-ramp(-1.84,-1.5,P[:,1]))*(1-ramp(2.015,2.10,P[:,2]))
to_bone('Jaw', jaw)
# The belly remains with the trunk when the four limbs separate during a stride.
centre = (1-ramp(.34,.64,np.abs(P[:,0])))*ramp(.34,.6,P[:,2])
torso = np.where(P[:,1]>.5,names.index('Hips'),np.where(P[:,1]<-.6,names.index('Chest'),names.index('Spine')))
for i,n in enumerate(names):
    if n.startswith(sw.LIMB_STEMS):
        moved=weights[:,i]*centre; weights[:,i]-=moved; np.add.at(weights,(np.arange(len(P)),torso),moved)
# Tail blending uses arc distance along its measured centreline, with adjacent
# segments overlapping. The rear thigh is excluded from the tail's root gate.
tail = np.asarray(tail_points); arc=np.r_[0,np.cumsum(np.linalg.norm(np.diff(tail,axis=0),axis=1))]
dist=np.full(len(P),np.inf); parameter=np.zeros(len(P))
for i in range(7):
    ab=tail[i+1]-tail[i]; f=np.clip((P-tail[i])@ab/(ab@ab),0,1)
    d=np.linalg.norm(P-(tail[i]+f[:,None]*ab),axis=1); better=d<dist
    parameter[better]=arc[i]+f[better]*(arc[i+1]-arc[i]); dist[better]=d[better]
centres=(arc[:-1]+arc[1:])*.5; target=np.zeros_like(weights)
for i in range(7):
    left=centres[i-1] if i else centres[0]-.6; right=centres[i+1] if i<6 else centres[-1]+.6
    target[:,names.index(f'Tail{i+1}')]=np.maximum(0,np.minimum((parameter-left)/(centres[i]-left),(right-parameter)/(right-centres[i])))
target/=np.maximum(target.sum(1)[:,None],1e-9)
blend(target,ramp(1.35,1.98,P[:,1])*(1-ramp(.46,.75,np.abs(P[:,0]))+ramp(1.95,2.15,P[:,1])*ramp(.46,.75,np.abs(P[:,0]))))
edges=gt.unique_edges(F); starts,neighbours=gt.adjacency(len(P),edges)
weights=sw.laplacian_smooth(weights,starts,neighbours,80,.5)
# Broad paws are rigid at the sole, softly joining the lower leg above the ankle.
for side,s in [('L',1),('R',-1)]:
    for end,forward,prefix in [('F',-1,'Hand.'),('B',1,'Foot.')]:
        amount=(1-ramp(.22,.48,P[:,2]))*ramp(.25,.38,P[:,0]*s)*ramp(.35,.5,P[:,1]*forward)
        to_bone(prefix+side,amount)
cutoff=np.sort(weights,axis=1)[:,-5]; weights=np.maximum(weights-cutoff[:,None],0); weights/=weights.sum(1)[:,None]
assert np.isfinite(weights).all()
for col,name in enumerate(names):
    group=obj.vertex_groups.new(name=name)
    for i in np.nonzero(weights[:,col]>1e-8)[0]: group.add([int(i)],float(weights[i,col]),'REPLACE')
report.update(base.normalise_weights(obj,rig))

PB, DB = rig.pose.bones, rig.data.bones
rest={b.name:b.matrix_local.copy() for b in DB}
legs={'FL':('UpperArm.L','LowerArm.L','Hand.L'), 'FR':('UpperArm.R','LowerArm.R','Hand.R'),
      'BL':('UpperLeg.L','LowerLeg.L','Foot.L'), 'BR':('UpperLeg.R','LowerLeg.R','Foot.R')}
def upd(): bpy.context.view_layer.update()
def solve_leg(k,disp,yaw,stats):
    up,lower,end=legs[k]; rotation=Matrix.Rotation(math.radians(yaw),4,'Z')
    start=PB[up].head.copy(); goal=rotation.to_3x3()@(rest[end].to_translation()+neutral[k]+Vector(disp))
    l1,l2=DB[up].length,DB[lower].length
    axis=goal-start; d=axis.length
    if d>l1+l2-.008:
        shortfall=d-(l1+l2-.008)
        stats[k]=max(stats[k],shortfall)
        # Scapula/hip glide gives the huge limb a small extra reach without
        # stretching a bone, raising the planted paw or translating the torso.
        start+=axis.normalized()*shortfall; axis=goal-start; d=axis.length
    axis.normalize(); d=max(abs(l1-l2)+.005,d)
    a=(l1*l1-l2*l2+d*d)/(2*d)
    pole=rotation.to_3x3()@Vector(((1 if k[1]=='L' else -1)*.4,1 if k[0]=='F' else -1,.05))
    pole-=axis*pole.dot(axis); pole.normalize()
    joint=start+axis*a+pole*math.sqrt(max(0,l1*l1-a*a))
    for name,p,q in [(up,start,joint),(lower,joint,goal)]:
        bone=DB[name]; local_dir=rotation.to_3x3().inverted()@(q-p)
        quat=rotation.to_quaternion()@(bone.tail_local-bone.head_local).rotation_difference(local_dir)@bone.matrix_local.to_quaternion()
        PB[name].matrix=Matrix.Translation(p)@quat.to_matrix().to_4x4(); upd()
    PB[end].matrix=Matrix.Translation(goal)@rotation@rest[end].to_quaternion().to_matrix().to_4x4(); upd()

actions=[]; records=[]; mouth=None
for name in (args.clips.split(',') if args.clips else DURATIONS):
    seconds=DURATIONS[name]; loop=name.endswith('_Loop'); n=round(seconds*FPS)
    action=bpy.data.actions.new(name); action.use_fake_user=True
    if rig.animation_data is None: rig.animation_data_create()
    rig.animation_data.action=action; rig.animation_data.action_slot=action.slots.new(id_type='OBJECT',name=name)
    minima=[]; contacts=[]; glide={k:0. for k in legs}
    for frame in range(n+1):
        t=(frame%n if loop else frame)/FPS; pose,targets,yaw=pose_at(name,t)
        if name=='TailSpin':
            # The internal full-body spin pivots about the same ground origin
            # as the paws. Rotating Hips alone would pivot 0.8 m behind them,
            # wrenching the skin between torso and legs at the half turn.
            hip=rest['Hips'].to_translation()
            orbit=Matrix.Rotation(math.radians(yaw),3,'Z')@hip-hip
            pose['Hips']['loc']=tuple(Vector(pose['Hips']['loc'])+orbit)
        for bone,spec in pose.items():
            if 'loc' in spec: spec['loc']=tuple(rest[bone].to_3x3().inverted()@Vector(spec['loc']))
        base.apply_pose(rig,pose)
        for b in PB: b.scale=Vector(pose.get(b.name,{}).get('scale',(1,1,1)))
        upd()
        if targets is not None:
            for k,disp in targets.items(): solve_leg(k,disp,yaw,glide)
        q=base.evaluated_positions(obj)
        if name=='Death':
            PB['Hips'].location+=rest['Hips'].to_3x3().inverted()@Vector((0,0,.003-float(q[:,2].min()))); upd(); q=base.evaluated_positions(obj)
        minima.append(float(q[:,2].min())); contacts.append([float(q[feet_masks[k],2].min()) for k in legs])
        if name=='Spit' and frame==round(.18*FPS):
            # A point midway between the front upper and lower lip at release.
            aperture=Vector((0,-2.36,2.115,1))
            top=PB['Head'].matrix@rest['Head'].inverted()@aperture
            bottom=PB['Jaw'].matrix@rest['Jaw'].inverted()@aperture
            point=(top+bottom)*.5
            mouth={'authoredSeconds':t,'pointBlender':list(point[:3]),'mouthSide':point.x,'mouthForward':-point.y,'mouthHeight':point.z}
        for b in PB:
            for prop in ['rotation_quaternion','location','scale']: b.keyframe_insert(data_path=prop,frame=frame)
    base.set_interpolation(action,'LINEAR'); action.use_frame_range=True; action.frame_start=0; action.frame_end=n
    record={'clip':name,'minimumGroundMetres':min(minima),'maximumLowestPawMetres':float(np.min(contacts,axis=1).max()),'maximumJointGlideMetres':glide}
    records.append(record); actions.append(action); rig.animation_data.action=None; base.rest_pose(rig)
    for b in PB: b.scale=Vector((1,1,1))
    upd(); print('CLIP_READY',json.dumps(record),flush=True)
base.export(out/'candidate.glb',actions); bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
result={'candidate':1,'revision':args.revision,'source':source.relative_to(M).as_posix(),'sha256':hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),
        'bytes':(out/'candidate.glb').stat().st_size,'heightMetres':float(H),'widthMetres':float(W),'lengthMetres':float(L),'upAxis':'Y','forwardAxis':'+Z',
        'boundsBlender':{'min':lo.tolist(),'max':hi.tolist()},'triangles':len(F),'topology':topology,'weights':report,'bones':[p[0] for p in plan],'bonePlan':plan,
        'clips':[{'name':n,'seconds':DURATIONS[n],'loop':n.endswith('_Loop'),'rootMotion':'in-place'} for n in (args.clips.split(',') if args.clips else DURATIONS)],
        'locomotion':LOCOMOTION,'groundCheck':records,'mouth':mouth,'tailCentreline':tail_points,
        'geometryOrigin':'New Codex image -> local TRELLIS-2 -> measured surface reduction. No visible procedural geometry.',
        'motionNotes':'Four independent planted paw IK chains, seven delayed tail links, distinct charge brace, tail coil, bite gape and inflated poison draw-back. All current gameplay tuning retained.',
        'visualReviewRequired':True}
(out/'process.json').write_text(json.dumps(result,indent=2)+'\n'); print('RIG_DONE',result['sha256'],flush=True)
