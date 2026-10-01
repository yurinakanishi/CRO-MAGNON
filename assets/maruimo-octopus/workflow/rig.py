"""Skin the retained TRELLIS surface to measured mantle/arm centre lines.

No visible geometry is created here. Bone paths are measured on the reconstructed
surface and stored in landmarks.json; every mesh vertex keeps its source position.
"""
import argparse, hashlib, heapq, json, math, sys
from pathlib import Path
import bpy, numpy as np
from mathutils import Matrix, Quaternion, Vector

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as surface, skin_weights as sw
M=ROOT/'output/model-generation/models/maruimo-octopus'
p=argparse.ArgumentParser()
p.add_argument('--revision',default='01')
p.add_argument('--surface-revision',default='01')
args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
source=M/f'work/low-poly/revision-{args.surface_revision}/candidate.glb'
out=M/f'work/rig/revision-{args.revision}'
out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists(), 'Keep completed revisions'
marks=json.loads((ROOT/'assets/maruimo-octopus/source/landmarks.json').read_text())
for workflow in ['rig.py','motion.py']:
    (out/workflow).write_bytes((Path(__file__).parent/workflow).read_bytes())
# Subdivide the measured centre line, not the reconstructed visible surface.
measured=marks['rightArm']
marks['rightArm']=[point for a,b in zip(measured[:-1],measured[1:]) for point in (a,((np.asarray(a)+b)/2).tolist())]+[measured[-1]]
obj=surface.import_dense(source)
print('SURFACE_IMPORTED',flush=True)
surface.weld(obj)
surface.triangulate(obj)
obj.name=obj.data.name='MaruimoSurface'
P=surface.positions_of(obj.data)
F=surface.face_array(obj.data)
print('SURFACE_WELDED',len(P),len(F),flush=True)
H=float(np.ptp(P[:,2]))
plan=[('Root',[0,0,0],[0,0,.06],None),
      ('Hips',marks['hips'],marks['spine'],'Root'),
      ('Spine',marks['spine'],marks['chest'],'Hips'),
      ('Chest',marks['chest'],marks['neck'],'Spine'),
      ('Neck',marks['neck'],marks['head'],'Chest'),
      ('Head',marks['head'],marks['headTop'],'Neck')]
left=marks['leftArm']
plan += [('Shoulder.L',marks['chest'],left[0],'Chest'),
         ('UpperArm.L',left[0],left[1],'Shoulder.L'),
         ('LowerArm.L',left[1],left[2],'UpperArm.L'),
         ('Hand.L',left[2],left[3],'LowerArm.L')]
chains={}
for key,points in [('ArmR',marks['rightArm'])]+[(f'Tentacle{i+1}',path) for i,path in enumerate(marks['lowerArms'])]:
    names=[]
    for i in range(len(points)-1):
        name=f'{key}{i+1:02}'
        parent=('Chest' if key=='ArmR' else 'Hips') if i==0 else names[-1]
        plan.append((name,points[i],points[i+1],parent))
        names.append(name)
    chains[key]=names
armature=bpy.data.armatures.new('MaruimoOctopusRig')
rig=bpy.data.objects.new('MaruimoArmature',armature)
bpy.context.collection.objects.link(rig)
bpy.context.view_layer.objects.active=rig
bpy.ops.object.mode_set(mode='EDIT')
for name,a,b,parent in plan:
    bone=armature.edit_bones.new(name)
    bone.head=a
    bone.tail=b
    if parent: bone.parent=armature.edit_bones[parent]
bpy.ops.object.mode_set(mode='OBJECT')
obj.parent=rig
modifier=obj.modifiers.new('OctopusSkin','ARMATURE')
modifier.object=rig
segments=[(name,np.asarray(a),np.asarray(b)) for name,a,b,_ in plan if name!='Root']
# The same exact surface distances, precomputed once instead of taking a tiny
# NumPy norm at every Dijkstra edge of every bone.
graph_cache={}
def graph_distances(points,starts,neighbours,sources,labels):
    if not graph_cache:
        rows=np.repeat(np.arange(len(points)),np.diff(starts))
        graph_cache['costs']=np.linalg.norm(points[rows]-points[neighbours],axis=1).tolist()
        graph_cache['starts']=starts.tolist()
        graph_cache['neighbours']=neighbours.tolist()
    costs=graph_cache['costs']; offsets=graph_cache['starts']; links=graph_cache['neighbours']
    distances=[math.inf]*len(points);tags=[-1]*len(points);heap=[]
    for v,label in zip(sources,labels):
        v=int(v)
        if distances[v]>0: distances[v]=0;tags[v]=int(label);heap.append((0.,v))
    heapq.heapify(heap)
    while heap:
        d,v=heapq.heappop(heap)
        if d>distances[v]: continue
        for index in range(offsets[v],offsets[v+1]):
            u=links[index];value=d+costs[index]
            if value<distances[u]:
                distances[u]=value;tags[u]=tags[v];heapq.heappush(heap,(value,u))
    return np.asarray(distances),np.asarray(tags)
sw.gt.multi_source_dijkstra=graph_distances
signature=hashlib.sha256(source.read_bytes()+json.dumps(plan).encode()+b'geodesic-radius12-smooth64').hexdigest()
cache=M/f'work/rig/weights-{signature[:12]}.npz'
if cache.exists() and str(np.load(cache)['signature'])==signature:
    weights=np.load(cache)['weights']
    report=json.loads((cache.with_suffix('.json')).read_text())
else:
    weights,report=sw.solve(P,F,segments,radius=.12,power=1.7,smooth_iterations=64,bridge_radius=.004)
    np.savez_compressed(cache,signature=signature,weights=weights)
    cache.with_suffix('.json').write_text(json.dumps(report,indent=2))
print('WEIGHTS_SOLVED',flush=True)
names=[name for name,_,_ in segments]
smooth=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))
# The oversized sleeve must not pull the sweater hem when the hand is raised.
left_indices=[i for i,n in enumerate(names) if n.endswith('.L')]
# Anatomical fields are spatially continuous across UV seams and painted details.
# Colour-driven weights were rejected in r07 because those boundaries tore.
left_mask=smooth((P[:,0]-.14)/.16)*smooth((P[:,2]-.46)/.05)
lost=(weights[:,left_indices]*(1-left_mask[:,None])).sum(1)
weights[:,left_indices]*=left_mask[:,None]
weights[:,names.index('Spine')]+=lost
leftpath=np.asarray(marks['leftArm']);parts=np.diff(leftpath,axis=0);ll=np.linalg.norm(parts,axis=1)
lc=np.r_[0,np.cumsum(ll)];closest=np.full(len(P),np.inf);ls=np.zeros(len(P))
for i,segment in enumerate(parts):
    t=np.clip(np.einsum('ij,j->i',P-leftpath[i],segment)/(ll[i]**2),0,1)
    d=np.linalg.norm(P-(leftpath[i]+t[:,None]*segment),axis=1);chosen=d<closest
    closest[chosen]=d[chosen];ls[chosen]=lc[i]+t[chosen]*ll[i]
coordinate=np.interp(ls,(lc[:-1]+lc[1:])/2,np.arange(3))
floor=np.floor(coordinate).astype(int);fraction=coordinate-floor
leftfield=np.zeros_like(weights)
ln=[names.index(n) for n in ['UpperArm.L','LowerArm.L','Hand.L']]
leftfield[np.arange(len(P)),np.asarray(ln)[floor]]+=1-fraction
leftfield[np.arange(len(P)),np.asarray(ln)[np.minimum(floor+1,2)]]+=fraction
weights=weights*(1-left_mask[:,None])+leftfield*left_mask[:,None]
torso=smooth((P[:,0]+.34)/.08)*smooth((.34-P[:,0])/.08)*smooth((P[:,2]-.46)/.07)*smooth((.94-P[:,2])/.07)*(1-left_mask)
body=np.zeros_like(weights)
coordinate=np.interp(P[:,2],[.49,.67,.84],[0,1,2]);floor=np.floor(coordinate).astype(int);fraction=coordinate-floor
bn=[names.index(n) for n in ['Hips','Spine','Chest']]
body[np.arange(len(P)),np.asarray(bn)[floor]]+=1-fraction
body[np.arange(len(P)),np.asarray(bn)[np.minimum(floor+1,2)]]+=fraction
weights=weights*(1-torso[:,None])+body*torso[:,None]
# The connected central mantle moves with the pelvis. Independent arm motion
# starts below this shared membrane, preventing opposite branches from tearing it.
radial=np.linalg.norm(P[:,:2]-np.array([-.04,0]),axis=1)
mantle=smooth((P[:,2]-.12)/.16)*smooth((.50-radial)/.20)*smooth((.56-P[:,2])/.08)*(1-left_mask)
weights*=1-mantle[:,None];weights[:,names.index('Hips')]+=mantle
# A smooth arc-length field gives the continuous unbranched upper tentacle four
# consecutive influences, avoiding geodesic core changes across suction cups.
points=np.asarray(marks['rightArm'])
parts=np.diff(points,axis=0); lengths=np.linalg.norm(parts,axis=1)
cumulative=np.r_[0,np.cumsum(lengths)]
near=np.full(len(P),np.inf);arc=np.zeros(len(P))
for i,segment in enumerate(parts):
    t=np.clip(np.einsum('ij,j->i',P-points[i],segment)/(lengths[i]**2),0,1)
    distance=np.linalg.norm(P-(points[i]+t[:,None]*segment),axis=1)
    selected=distance<near
    near[selected]=distance[selected];arc[selected]=cumulative[i]+t[selected]*lengths[i]
centers=(cumulative[:-1]+cumulative[1:])/2
param=np.interp(arc,centers,np.arange(len(lengths)))
base=np.floor(param).astype(int);fraction=param-base
kernel=[(1-fraction)**3/6,(3*fraction**3-6*fraction**2+4)/6,(-3*fraction**3+3*fraction**2+3*fraction+1)/6,fraction**3/6]
right_indices=[names.index(n) for n in chains['ArmR']]
total=weights[:,right_indices].sum(1)
weights[:,right_indices]=0
for delta,value in zip([-1,0,1,2],kernel):
    ids=np.asarray(right_indices)[np.clip(base+delta,0,len(lengths)-1)]
    weights[np.arange(len(P)),ids]+=total*value
# Keep glasses, eyes and the entire hair mass rigid to the head.
head=smooth((P[:,2]-marks['neck'][2])/.055)*smooth((P[:,0]+.65)/.2)*smooth((.65-P[:,0])/.2)
weights*=1-head[:,None]
weights[:,names.index('Head')]+=head
keep=np.argsort(-weights,axis=1)[:,:4]
trimmed=np.zeros_like(weights)
rows=np.arange(len(P))[:,None]
trimmed[rows,keep]=weights[rows,keep]
weights=trimmed/trimmed.sum(1)[:,None]
for j,name in enumerate(names):
    group=obj.vertex_groups.new(name=name)
    for i in np.flatnonzero(weights[:,j]>1e-8): group.add([int(i)],float(weights[i,j]),'REPLACE')
report['maxWeightError']=float(np.abs(weights.sum(1)-1).max())
report['maxInfluences']=int((weights>1e-8).sum(1).max())
report['discontinuity']=sw.weight_discontinuity(P,F,weights,names)
support_masks={key:((weights[:,[names.index(n) for n in group]].sum(1)>.35)&(P[:,2]<.6))
               for key,group in chains.items() if key.startswith('Tentacle')}
PB=rig.pose.bones
DB=rig.data.bones
rest={bone.name:bone.matrix_local.copy() for bone in DB}
restlocal={name:rest[DB[name].parent.name].inverted()@matrix if DB[name].parent else matrix.copy() for name,matrix in rest.items()}
worlds={}
def bone_world(name):
    if name not in worlds:
        parent=DB[name].parent
        worlds[name]=(bone_world(parent.name) if parent else Matrix.Identity(4))@restlocal[name]@PB[name].matrix_basis
    return worlds[name]
for bone in PB: bone.rotation_mode='QUATERNION'
for side,bone,point in [('L','Hand.L',left[3]),('R',chains['ArmR'][-1],marks['rightArm'][-1])]:
    grip=bpy.data.objects.new('Grip.'+side,None)
    bpy.context.collection.objects.link(grip)
    grip.parent=rig
    grip.parent_type='BONE'
    grip.parent_bone=bone
    bpy.context.view_layer.update()
    grip.matrix_world=Matrix.Translation(Vector(point))@rest[bone].to_quaternion().to_matrix().to_4x4()

def reset():
    for bone in PB:
        bone.location=(0,0,0)
        bone.rotation_quaternion=(1,0,0,0)
        bone.scale=(1,1,1)
    worlds.clear()

def aim(name,a,b,orientation=None,stretch=False):
    bind=DB[name]
    q=orientation if orientation is not None else (bind.tail_local-bind.head_local).rotation_difference(b-a)@rest[name].to_quaternion()
    desired=Matrix.Translation(a)@q.to_matrix().to_4x4()
    if stretch: desired=desired@Matrix.Diagonal(Vector((1,(b-a).length/bind.length,1,1)))
    parent=DB[name].parent
    parentworld=bone_world(parent.name) if parent else Matrix.Identity(4)
    PB[name].matrix_basis=restlocal[name].inverted()@parentworld.inverted()@desired
    worlds[name]=desired

def rotate(name,axis,radians):
    local=rest[name].to_3x3().inverted()@Vector(axis)
    PB[name].rotation_quaternion=Quaternion(local.normalized(),radians)
    worlds.clear()

def chain_pose(key,points):
    parent=DB[chains[key][0]].parent.name
    follow=bone_world(parent)@rest[parent].inverted()
    points=[follow@Vector(point) for point in points]
    if key!='ArmR':
        # Flexible tissue uses translated joints. Non-uniform bone scaling with
        # rotated children introduces shear, which glTF TRS cannot preserve.
        for name,a,b in zip(chains[key],points[:-1],points[1:]): aim(name,a,b)
        return
    # Parallel transport keeps the suction-cup side continuous around a curl.
    # Independent shortest-arc rotations produce a roll flip near a U-turn.
    previous_bind=previous_direction=oldframe=newframe=None
    for name,a,b in zip(chains[key],points[:-1],points[1:]):
        bind=(DB[name].tail_local-DB[name].head_local).normalized()
        direction=(b-a).normalized()
        if oldframe is None:
            oldframe=rest[name].to_quaternion()
            newframe=bind.rotation_difference(direction)@oldframe
        else:
            oldframe=previous_bind.rotation_difference(bind)@oldframe
            newframe=previous_direction.rotation_difference(direction)@newframe
        orientation=newframe@oldframe.inverted()@rest[name].to_quaternion()
        aim(name,a,b,orientation)
        previous_bind=bind
        previous_direction=direction

def blend_right(a,b,amount):
    chain_pose('ArmR',a)
    first=[(PB[n].location.copy(),PB[n].rotation_quaternion.copy()) for n in chains['ArmR']]
    chain_pose('ArmR',b)
    for name,(p,q) in zip(chains['ArmR'],first):
        bone=PB[name]
        bone.location=p.lerp(bone.location,amount)
        bone.rotation_quaternion=q.slerp(bone.rotation_quaternion,amount)
    worlds.clear()

def left_hand(goal,tip=None):
    upper,lower,hand=[PB[name] for name in ['UpperArm.L','LowerArm.L','Hand.L']]
    start=bone_world('UpperArm.L').translation.copy()
    a,b=DB['UpperArm.L'].length,DB['LowerArm.L'].length
    axis=Vector(goal)-start
    d=min(max(axis.length,abs(a-b)+.001),a+b-.001)
    axis.normalize()
    pole=Vector((1,.2,-.4))
    pole-=axis*pole.dot(axis)
    pole.normalize()
    along=(a*a-b*b+d*d)/(2*d)
    elbow=start+axis*along+pole*math.sqrt(max(0,a*a-along*along))
    wrist=start+axis*d
    aim('UpperArm.L',start,elbow)
    aim('LowerArm.L',elbow,wrist)
    direction=(Vector(tip)-wrist).normalized() if tip is not None else Vector((0,-1,0))
    aim('Hand.L',wrist,wrist+direction*DB['Hand.L'].length)

def evaluated():
    evaluated=obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh=evaluated.to_mesh()
    points=surface.positions_of(mesh)
    evaluated.to_mesh_clear()
    return points

# Candidate-specific motion design is retained beside the anatomical landmarks.
sys.path.insert(0,str(Path(__file__).resolve().parent))
from motion import motions
clips=motions(marks,chains)
FPS=60
bpy.context.scene.render.fps=FPS
actions=[]
checks=[]
for name,settings in clips.items():
    duration,loop,fn=settings
    action=bpy.data.actions.new(name)
    action.use_fake_user=True
    rig.animation_data_create()
    rig.animation_data.action=action
    n=round(duration*FPS)
    minimum=math.inf
    maximum=-math.inf
    largest_floor_adjustment=0
    for frame in range(n+1):
        reset()
        t=0 if loop and frame==n else frame/n*duration
        pose=fn(t)
        for bone,rotation in pose.get('rotations',{}).items(): rotate(bone,*rotation)
        for key,points in pose.get('chains',{}).items(): chain_pose(key,points)
        if 'blendRight' in pose: blend_right(*pose['blendRight'])
        if 'leftHand' in pose: left_hand(pose['leftHand'],pose.get('leftTip'))
        for bone,offset in pose.get('offsets',{}).items():
            PB[bone].location+=rest[bone].to_3x3().inverted()@Vector(offset)
        bpy.context.view_layer.update()
        q=evaluated()
        # Project supporting arms out of the floor independently. This leaves
        # the torso/root height alone instead of hiding penetration by floating
        # the entire actor. The original mesh, UVs and bone lengths are retained.
        correction={key:0. for key in support_masks}
        for attempt in range(5):
            changed=False
            for key,mask in support_masks.items():
                delta=.0015-float(q[mask,2].min())
                if delta<=.0001: continue
                correction[key]+=delta*1.15
                chain_pose(key,np.asarray(pose['chains'][key])+np.array([0,0,correction[key]]))
                changed=True
            if not changed: break
            bpy.context.view_layer.update()
            q=evaluated()
        largest_floor_adjustment=max(largest_floor_adjustment,max(correction.values()))
        minimum=min(minimum,float(q[:,2].min()))
        maximum=max(maximum,float(q[:,2].max()))
        for bone in PB:
            bone.keyframe_insert('rotation_quaternion',frame=frame)
            bone.keyframe_insert('location',frame=frame)
            bone.keyframe_insert('scale',frame=frame)
    for curve in action.fcurves:
        for key in curve.keyframe_points: key.interpolation='LINEAR'
    if hasattr(action,'use_frame_range'):
        action.use_frame_range=True
        action.frame_start=0
        action.frame_end=n
    actions.append(action)
    checks.append(dict(clip=name,seconds=duration,loop=loop,minimumY=minimum,maximumY=maximum,
                       largestSupportCorrection=largest_floor_adjustment))
    print('CLIP_READY',json.dumps(checks[-1]),flush=True)
    rig.animation_data.action=None
reset()
scene=bpy.context.scene
scene.frame_set(0)
bpy.ops.object.select_all(action='SELECT')
options=dict(filepath=str(out/'candidate.glb'),export_format='GLB',export_yup=True,export_apply=False,
             export_animations=True,export_frame_range=False,export_force_sampling=False,
             export_nla_strips=True,export_anim_single_armature=True,export_skins=True,
             export_all_influences=False,export_def_bones=False,export_optimize_animation_size=False,
             export_image_format='AUTO')
supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k:v for k,v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
record=dict(candidate=1,revision=args.revision,source=str(source),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),
            sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),bytes=(out/'candidate.glb').stat().st_size,
            heightMetres=H,triangles=len(F),bones=[name for name,_,_,_ in plan],bonePlan=plan,chains=chains,
            weights=report,checks=checks,sourceGeometryUnchanged=True)
(out/'rig.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record),flush=True)
