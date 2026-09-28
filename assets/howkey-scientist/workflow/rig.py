"""Source-specific Howkey skin. Geometry and UVs are never synthesized here.

Coat panels follow their own thigh through a separate joint; the shared waist
stays on the pelvis. Glasses and face stay rigid with Head. Only the bob tips
receive a small secondary motion. Walk/run are replaced from CMU afterwards.
"""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy, numpy as np

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
MODEL=ROOT/'output/model-generation/models/howkey-scientist'
ap=argparse.ArgumentParser();ap.add_argument('--revision',default='01');ap.add_argument('--surface',default='02')
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
sys.path.insert(0,str(MODEL/'workflow/candidate-01'))
import blender_rig as base, skin_weights as sw, graph_tools as gt, clips_data as cd
H=1.55;base.H=H
out=MODEL/f'work/rig/revision-{args.revision}';out.mkdir(parents=True,exist_ok=True)
assert not (out/'candidate.glb').exists(),'Use a new revision'
source=MODEL/f'work/low-poly/revision-{args.surface}/candidate.glb'
obj=base.import_mesh(source);topology=base.weld_and_shade(obj,angle_degrees=50)
obj.name='Howkey';obj.data.name='HowkeySurface';P=base.positions(obj.data);F=base.mesh_triangles(obj.data)
def depth(f):
    q=P[(abs(P[:,2]-f*H)<.020*H)&(abs(P[:,0])<.06*H)]
    return float((np.quantile(q[:,1],.08)+np.quantile(q[:,1],.92))*.5)
marks={n:[0,depth(f),f*H] for n,f in [('pelvis',.505),('spine',.61),('chest',.735),('neck',.79),('head',.865),('head_tip',.96)]}
for side,sign in [('L',1),('R',-1)]:
    axis=base.foot_axis(P,sign);heel=np.array(axis['heel']);span=np.array(axis['toe'])-heel
    for name,t,z in [('ankle',.29,.053),('foot',.79,.021),('toe',.98,.015)]:
        xy=heel+span*t;marks[name+'_'+side]=[float(xy[0]),float(xy[1]),z*H]
    marks['knee_'+side]=list(base.leg_centre(P,.28*H,sign,half=.018*H))
    marks['hip_'+side]=[sign*.058*H,depth(.505),.505*H]
    shoulder=list(base.arm_centre(P,.762*H,sign,half=.013*H,thickness=.062*H));shoulder[0]*=.92
    marks['shoulder_'+side]=shoulder
    marks['shoulder_in_'+side]=[sign*.03*H,depth(.74),.775*H]
    for name,f,thick in [('elbow',.63,.055),('wrist',.56,.032),('hand',.51,.028)]:
        marks[name+'_'+side]=list(base.arm_centre(P,f*H,sign,half=.009*H,thickness=thick*H))
mouthBand=P[(abs(P[:,0])<.02*H)&(abs(P[:,2]-.838*H)<.008*H)]
marks['mouth']=[0,float(np.quantile(mouthBand[:,1],.02)),.838*H]
plan=base.bone_plan(marks);coreNames=[b[0] for b in plan if b[0]!='Root']
for side,sign in [('L',1),('R',-1)]:
    for panel,dy in [('Front',-.057),('Back',.065)]:
        plan.append(('Coat'+panel+'.'+side,[sign*.095*H,depth(.50)+dy*H,.515*H],
                     [sign*.145*H,depth(.50)+dy*H,.32*H],'UpperLeg.'+side,False))
    plan.append(('Hair.'+side,[sign*.09*H,depth(.86),.89*H],
                 [sign*.10*H,depth(.83),.807*H],'Head',False))
rig=base.build_armature(plan);sockets=base.add_grip_sockets(rig,marks)
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);rig.select_set(True);bpy.context.view_layer.objects.active=rig
bpy.ops.object.parent_set(type='ARMATURE_NAME')
for group in list(obj.vertex_groups):obj.vertex_groups.remove(group)
segments=[(b.name,np.asarray(b.head_local),np.asarray(b.tail_local)) for b in rig.data.bones if b.name in coreNames]
# Blender iterates bones in hierarchy order, not the construction-list order.
# Keep the solver's matrix columns keyed to those exact segment names.
names=[s[0] for s in segments]+[b[0] for b in plan if b[0].startswith(('Coat','Hair'))]
initial,weights=sw.solve(P,F,segments,radius=.072,smooth_iterations=24,bridge_radius=.003)
W=np.zeros((len(P),len(names)));W[:,:len(coreNames)]=initial
def target(name):
    a=np.zeros_like(W);a[:,names.index(name)]=1;return a
def blend(a,t):
    global W
    W=W*(1-t[:,None])+a*t[:,None]
headBlend=np.clip((P[:,2]-.793*H)/(.029*H),0,1)
blend(target('Head'),headBlend)
armDistance=np.full(len(P),np.inf)
for side in ['L','R']:
    for first,last in [('shoulder','elbow'),('elbow','wrist'),('wrist','hand')]:
        a=np.array(marks[first+'_'+side]);b=np.array(marks[last+'_'+side]);axis=b-a
        t=np.clip(((P-a)@axis)/(axis@axis),0,1)
        armDistance=np.minimum(armDistance,np.linalg.norm(P-(a+t[:,None]*axis),axis=1))
torso=np.clip((.135*H-abs(P[:,0]))/(.045*H),0,1)*np.clip((armDistance-.048*H)/(.028*H),0,1)
torso*=np.clip((P[:,2]-.53*H)/(.045*H),0,1)*np.clip((.795*H-P[:,2])/(.025*H),0,1)
t=np.clip((P[:,2]-.61*H)/(.125*H),0,1)
blend(target('Spine')*(1-t[:,None])+target('Chest')*t[:,None],torso)
# Sample the unmodified reconstructed albedo only to distinguish the white
# coat from the black trousers in the same height range. Never repaint it.
image=next(n.image for m in obj.data.materials for n in m.node_tree.nodes if n.type=='TEX_IMAGE' and n.image)
faceColor=base.face_uv_colours(obj,image);color=np.zeros((len(P),3));count=np.zeros(len(P))
for c,poly in zip(faceColor,obj.data.polygons):
    for v in poly.vertices:color[v]+=c;count[v]+=1
color/=np.maximum(count,1)[:,None]
white=np.clip((color.min(1)-.43)/.20,0,1)
coat=white*np.clip((.56*H-P[:,2])/(.055*H),0,1)*np.clip((P[:,2]-.265*H)/(.02*H),0,1)
coat*=np.clip((armDistance-.049*H)/(.028*H),0,1)
coat*=np.clip((.25*H-abs(P[:,0]))/(.045*H),0,1)
left=np.clip(.5+P[:,0]/(.025*H),0,1)
front=np.clip(.5-(P[:,1]-depth(.48))/(.065*H),0,1)
lower=np.clip((.545*H-P[:,2])/(.11*H),0,1)
panels=np.zeros_like(W)
for side,l in [('L',left),('R',1-left)]:
    for panel,f in [('Front',front),('Back',1-front)]:panels[:,names.index('Coat'+panel+'.'+side)]=l*f
blend(panels*lower[:,None]+target('Hips')*(1-lower[:,None]),coat)
edges=gt.unique_edges(F);starts,neighbours=gt.adjacency(len(P),edges)
W=sw.laplacian_smooth(W,starts,neighbours,28,.4)
# The source's close trouser/ankle surface rings inherited distant thigh/toe
# seeds. Anatomical height blends keep each calf between its knee and ankle,
# and each shoe between its ankle and toe. White coat panels are excluded.
def smooth(t):
    t=np.clip(t,0,1);return t*t*(3-2*t)
for side,sign in [('L',1),('R',-1)]:
    knee=smooth((P[:,2]/H-.23)/.09)
    ankle=1-smooth((P[:,2]/H-.043)/.082)
    axis=base.foot_axis(P,sign);heel=np.array(axis['heel']);span=np.array(axis['toe'])-heel
    along=((P[:,:2]-heel)@span)/(span@span)
    toe=smooth((along-.72)/.25)
    leg=target('UpperLeg.'+side)*knee[:,None]+target('LowerLeg.'+side)*((1-knee)*(1-ankle))[:,None]
    leg+=target('Foot.'+side)*((1-knee)*ankle*(1-toe))[:,None]+target('Toe.'+side)*((1-knee)*ankle*toe)[:,None]
    gate=smooth((.35-P[:,2]/H)/.055)*(1-coat)*(sign*P[:,0]>0)
    blend(leg,gate)
# Consolidate anatomically impossible elbow influence near the shoulder and
# avoid adjacent triangles choosing different fourth joints at the armpit.
for side in ['L','R']:
    upper=smooth((P[:,2]/H-.65)/.065)
    for name in ['LowerArm.','Hand.']:
        moved=W[:,names.index(name+side)]*upper
        W[:,names.index(name+side)]-=moved;W[:,names.index('UpperArm.'+side)]+=moved
    chestBand=1-smooth((P[:,2]/H-.74)/.04)
    moved=W[:,names.index('Shoulder.'+side)]*chestBand
    W[:,names.index('Shoulder.'+side)]-=moved;W[:,names.index('Chest')]+=moved
# The generated hand begins at the rolled cuff, not at the palm centre.
# Give the cuff and adjacent skin the same forearm/wrist transition so that
# flexing the wrist cannot stretch a narrow skin ring into a bare forearm.
for side,sign in [('L',1),('R',-1)]:
    elbow=smooth((P[:,2]/H-.602)/.058)
    wrist=smooth((P[:,2]/H-.548)/.031)
    arm=target('UpperArm.'+side)*elbow[:,None]
    arm+=target('LowerArm.'+side)*((1-elbow)*wrist)[:,None]
    arm+=target('Hand.'+side)*((1-elbow)*(1-wrist))[:,None]
    gate=smooth((sign*P[:,0]/H-.125)/.037)
    gate*=1-smooth((P[:,2]/H-.69)/.04)
    gate*=1-smooth((armDistance/H-.046)/.03)
    blend(arm,gate)
# Re-consolidate the rigid face after graph smoothing. Hair is classified by
# its lateral position and rear depth; never let an eye or glasses rim flex.
blend(target('Head'),np.clip((P[:,2]-.815*H)/(.026*H),0,1))
for side,sign in [('L',1),('R',-1)]:
    hair=np.clip((sign*P[:,0]-.067*H)/(.032*H),0,1)
    hair*=np.clip((P[:,2]-.793*H)/(.018*H),0,1)*np.clip((.895*H-P[:,2])/(.06*H),0,1)*.6
    blend(target('Hair.'+side),hair)
# The coat has a close inner and outer shell. Graph smoothing alone cannot
# cross its disconnected thickness and produced speckled intersections when
# the two shells followed different joints. Transfer a continuous spatial
# weight field across the thin layers, without changing the source surface.
from mathutils.kdtree import KDTree
tree=KDTree(len(P))
for i,p in enumerate(P):tree.insert(p,i)
tree.balance()
near=np.empty((len(P),24),dtype=np.int32);kernel=np.zeros((len(P),24))
for i,p in enumerate(P):
    found=tree.find_n(p,24)
    for j,(_,index,distance) in enumerate(found):
        near[i,j]=index;kernel[i,j]=math.exp(-(distance/(.009*H))**2)
kernel/=kernel.sum(1)[:,None]
spatial=smooth((P[:,2]/H-.25)/.045)*(1-smooth((P[:,2]/H-.775)/.025))
for _ in range(6):
    averaged=(W[near]*kernel[:,:,None]).sum(1)
    W=W*(1-spatial[:,None])+averaged*spatial[:,None]
keep=np.argsort(-W,axis=1)[:,:4];clipped=np.zeros_like(W);rows=np.arange(len(P))[:,None]
clipped[rows,keep]=W[rows,keep];W=clipped;W[W<1e-5]=0;W/=W.sum(1)[:,None]
for col,name in enumerate(names):
    group=obj.vertex_groups.new(name=name)
    for index in np.flatnonzero(W[:,col]>0):group.add([int(index)],float(W[index,col]),'REPLACE')
weights.update(maximumInfluences=int((W>0).sum(1).max()),sumMin=float(W.sum(1).min()),sumMax=float(W.sum(1).max()),
               coatVertices=int((coat>.5).sum()),discontinuity=sw.weight_discontinuity(P,F,W,names))
np.savez_compressed(out/'rig-surface.npz',positions=P,faces=F,weights=W,bones=np.array(names))
cd.NEUTRAL_ARM_LOWER=13;cd.BASE=cd.neutral_pose()
solvers={s:cd.LegSolver(marks['hip_'+s],marks['knee_'+s],marks['ankle_'+s]) for s in ['L','R']}
arm=base.ArmIK(rig,obj,marks,hand_pose=cd.EAT_HAND);clips=cd.build_clips(solvers,arm,marks['mouth'])
rest=cd.BASE
wind=cd.merge(rest,{'Chest':{'pitch':-2},'Head':{'pitch':3},
    'UpperArm.R':{'pitch':-38,'roll':-22},'LowerArm.R':{'pitch':-72,'roll':-10},
    'UpperArm.L':{'pitch':-38,'roll':22},'LowerArm.L':{'pitch':-72,'roll':10}})
impact=cd.merge(rest,{'Chest':{'pitch':5},'Head':{'pitch':-3},
    'UpperArm.R':{'pitch':-78,'roll':-20},'LowerArm.R':{'pitch':-12,'roll':-8},
    'UpperArm.L':{'pitch':-78,'roll':20},'LowerArm.L':{'pitch':-12,'roll':8}})
def interpolate(a,b,t):
    t=max(0,min(1,t));t=t*t*(3-2*t)
    return {n:{k:a.get(n,{}).get(k,0)*(1-t)+b.get(n,{}).get(k,0)*t for k in set(a.get(n,{}))|set(b.get(n,{}))} for n in set(a)|set(b)}
poses=[]
for i in range(28):
    pose=interpolate(rest,wind,i/8) if i<8 else interpolate(wind,impact,(i-8)/4) if i<=12 else interpolate(impact,rest,(i-12)/15)
    poses.append((i,pose))
clips.append(dict(name='Attack',loop=False,poses=poses,contact='plant',interpolation='LINEAR'))
for clip in clips:
    duration=clip['poses'][-1][0]
    for f,pose in clip['poses']:
        phase=2*math.pi*f/duration
        for side,sign in [('L',1),('R',-1)]:
            pose['Hair.'+side]={'pitch':math.sin(phase)*1.3,'roll':sign*math.sin(phase)*.7}
            for panel in ['Front','Back']:pose['Coat'+panel+'.'+side]={'pitch':math.sin(phase+sign*.4)*.6}
    # Both ends of a loop must match, including new secondary joints.
    if clip['loop']:clip['poses'][-1]=(clip['poses'][-1][0],clip['poses'][0][1])
bpy.context.scene.render.fps=30;feet=P[:,2]<.09*H;inverse=base.hips_world_to_local(rig);actions=[];locks=[]
for clip in clips:
    action,animated=base.make_action(rig,clip)
    lock=base.ground_lock(rig,obj,action,clip,feet,inverse);lock['clip']=clip['name'];locks.append(lock)
    actions.append(action);print('CLIP_READY',clip['name'],flush=True)
base.rest_pose(rig);bpy.context.view_layer.update();base.export(out/'candidate.glb',actions)
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
report=dict(candidate=1,revision=args.revision,source=source.relative_to(MODEL).as_posix(),
    sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),bytes=(out/'candidate.glb').stat().st_size,
    heightMetres=H,upAxis='Y',forwardAxis='+Z',triangles=len(F),weldedVertices=len(P),topology=topology,
    landmarks=marks,bones=[a[0] for a in plan],sockets=sockets,weights=weights,groundLock=locks,
    clips=[dict(name=c['name'],loop=c['loop'],seconds=c['poses'][-1][0]/30,rootMotion='in-place') for c in clips],
    locomotion={c['name']:dict(metresPerSecond=c['gait'].stride()/(c['poses'][-1][0]/30),strideMetres=c['gait'].stride(),dutyFactor=c['gait'].duty) for c in clips if 'gait' in c},
    attackImpactSeconds=.4,geometryOrigin='TRELLIS surface; positions and albedo unchanged in rigging.',visualReviewRequired=True)
(out/'process.json').write_text(json.dumps(report,indent=2)+'\n')
(out/'asset.json').write_text(json.dumps(dict(report,modelKey='howkey-scientist',url=str(out/'candidate.glb')),indent=2)+'\n')
print('RIG_DONE',report['sha256'],flush=True)
