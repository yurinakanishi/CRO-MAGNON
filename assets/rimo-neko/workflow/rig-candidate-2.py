"""Candidate 2: measured quadruped rig for the new retained TRELLIS surface.

Four planted-paw IK chains, a flexible back, five tail segments, both ears and
an articulated jaw. The small mouth cavity is a repair extruded from the source
lip boundary; it is not a replacement head. All animation is in-place at 120 Hz.
"""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy,bmesh,numpy as np
from mathutils import Vector,Matrix,Quaternion
from mathutils.kdtree import KDTree
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(Path(__file__).resolve().parent/'lib'))
import blender_rig as base,skin_weights as sw,graph_tools as gt
ap=argparse.ArgumentParser(); ap.add_argument('--revision',default='01'); ap.add_argument('--reuse-bind'); ap.add_argument('--bind-source'); args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
M=ROOT/'output/model-generation/models/rimo-neko/candidate-2'; source=M/'work/low-poly/revision-01/candidate.glb'
out=M/f'work/rig/revision-{args.revision}'; out.mkdir(parents=True,exist_ok=True); assert not (out/'candidate.glb').exists()
if args.reuse_bind or args.bind_source:
    prior=Path(args.bind_source).resolve() if args.bind_source else M/f'work/rig/revision-{args.reuse_bind}'
    bpy.ops.wm.open_mainfile(filepath=str(prior/'source.blend'))
    previous=json.loads((prior/'process.json').read_text())
    obj=bpy.data.objects['RimoNekoSurface']; rig=obj.find_armature()
    rig.animation_data_clear()
    for action in list(bpy.data.actions): bpy.data.actions.remove(action)
    landmark_file=prior/'landmarks.json' if (prior/'landmarks.json').exists() else M/'qa/face-landmarks.json'
    marks=json.loads(landmark_file.read_text()); at=lambda key:Vector(marks[key]['at'])
    mouth=at('mouth'); side=(at('lipRight')-at('lipLeft')).normalized(); forward=Vector((side.y,-side.x,0)).normalized(); up=forward.cross(side).normalized()
    cached=np.load(prior/'binding.npz'); P=base.positions(obj.data); F=base.mesh_triangles(obj.data)
    assert np.max(np.abs(P-cached['positions']))<1e-8
    weights=cached['weights']; names=cached['names'].tolist()
    H=previous['heightMetres']; base.H=H; plan=previous['bonePlan']; report=previous['weights']; topology=previous['topology']; mouthRepair=previous['mouthRepair']; paws=previous['paws']
    pawNames=list(paws); pawXY=np.asarray([[paws[k]['x'],paws[k]['y']] for k in pawNames]); pawOwner=np.argmin(np.linalg.norm(P[:,None,:2]-pawXY[None,:,:],axis=2),axis=1)
    footMasks={k:(pawOwner==pawNames.index(k))&(abs(P[:,0]-p['x'])<.061)&(abs(P[:,1]-p['y'])<.083)&(P[:,2]<.037) for k,p in paws.items()}
    print('BINDING_REUSED',args.reuse_bind,flush=True)
else:
    obj=base.import_mesh(source); topology=base.weld_and_shade(obj,angle_degrees=65); obj.name=obj.data.name='RimoNekoSurface'
    print('SURFACE_READY', len(obj.data.vertices), flush=True)
    marks=json.loads((M/'qa/face-landmarks.json').read_text()); at=lambda key:Vector(marks[key]['at'])
    mouth=at('mouth'); side=(at('lipRight')-at('lipLeft')).normalized(); forward=Vector((side.y,-side.x,0)).normalized(); up=forward.cross(side).normalized()

    # Split the existing lip seam, then line its own duplicated boundary inward.
    bm=bmesh.new(); bm.from_mesh(obj.data); bm.faces.ensure_lookup_table()
    region=[]
    for f in bm.faces:
        q=f.calc_center_median()-mouth; u,v,h=q.dot(side),q.dot(forward),q.dot(up)
        if abs(u)<.033 and abs(h)<.022 and v>-.014: region.append(f)
    geom=set(region)
    for f in region: geom.update(f.verts); geom.update(f.edges)
    cut=bmesh.ops.bisect_plane(bm,geom=list(geom),dist=1e-7,plane_co=mouth,plane_no=up,use_snap_center=True,clear_inner=False,clear_outer=False)
    seam=[]
    for edge in cut['geom_cut']:
        if not isinstance(edge,bmesh.types.BMEdge): continue
        q=(edge.verts[0].co+edge.verts[1].co)/2-mouth
        if abs(q.dot(side))<.026 and q.dot(forward)>-.012: seam.append(edge)
    assert len(seam)>3,('Unresolved lip seam',len(seam))
    bmesh.ops.split_edges(bm,edges=seam)
    layer=bm.verts.layers.float.new('mouth_seam_side')
    for v in bm.verts:
        q=v.co-mouth
        if abs(q.dot(up))<1e-5 and abs(q.dot(side))<.028 and q.dot(forward)>-.014:
            h=sum((f.calc_center_median()-mouth).dot(up) for f in v.link_faces)/max(1,len(v.link_faces))
            v[layer]=-1 if h<0 else 1
    rim=[e for e in bm.edges if e.is_boundary and all(v[layer] for v in e.verts)]
    material=bpy.data.materials.new('Rimo mouth lining'); material.use_nodes=True
    bsdf=material.node_tree.nodes.get('Principled BSDF'); bsdf.inputs['Base Color'].default_value=(.025,.003,.005,1); bsdf.inputs['Roughness'].default_value=.85
    obj.data.materials.append(material); material_index=len(obj.data.materials)-1
    inner=bm.verts.new(mouth-forward*.024-up*.004)
    for edge in rim:
        try:
            face=bm.faces.new([edge.verts[1],edge.verts[0],inner]); face.material_index=material_index; face.smooth=True
        except ValueError: pass
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(obj.data); bm.free(); obj.data.validate(clean_customdata=False); obj.data.update()
    P=base.positions(obj.data); F=base.mesh_triangles(obj.data); H=float(np.ptp(P[:,2])); base.H=H
    seamSide=np.asarray([a.value for a in obj.data.attributes['mouth_seam_side'].data])
    mouthRepair=dict(sourceLipCentre=list(mouth),side=list(side),forward=list(forward),up=list(up),splitEdges=len(seam),rimEdges=len(rim),method='Existing lip seam split; its own boundary extruded inward with a dark lining')

    # Measure each foot independently; the reference pose has unequal hind spacing.
    low=P[P[:,2]<.034]; paws={}
    for end,ey in [('F',-1),('B',1)]:
        for lr,s in [('L',1),('R',-1)]:
            q=low[(low[:,1]*ey>0)&(low[:,0]*s>0)]
            paws[end+lr]=dict(x=float(q[:,0].mean()),y=float(q[:,1].mean()),floor=float(q[:,2].min()),toe=float(q[:,1].min()))
    def column(key,z):
        p=paws[key]; near=P[(abs(P[:,2]-z)<.012)&(abs(P[:,0]-p['x'])<.058)&(abs(P[:,1]-p['y'])<.08)]
        return [float(np.median(near[:,0])) if len(near) else p['x'],float(np.median(near[:,1])) if len(near) else p['y'],z]
    hipY=sum(paws['B'+s]['y'] for s in 'LR')/2; frontY=sum(paws['F'+s]['y'] for s in 'LR')/2
    head=list(at('headCentre')); pet=list(at('crown')+up*.002)
    hip=list(at('hipCentre')); middle=list(at('spineCentre')); chest=list(at('chestCentre')); neck=list(at('neckCentre'))
    plan=[('Root',[0,0,0],[0,0,.055],None,False),('Hips',hip,middle,'Root',False),
          ('Spine',middle,chest,'Hips',False),('Chest',chest,neck,'Spine',False),
          ('Neck',neck,head,'Chest',False),('Head',head,list(at('nose')),'Neck',False),
          ('PetContact',pet,[pet[0],pet[1],pet[2]+.008],'Head',False),
          ('Jaw',list(mouth-forward*.048-up*.004),list(mouth-up*.018),'Head',False)]
    for lr,key in [('L','earRight'),('R','earLeft')]:
        eb=at(key+'Base')-forward*.01-up*.013; tip=at(key+'Tip')
        plan.append(('Ear.'+lr,list(eb),list(tip),'Head',False))
    tail=[list(at('tail'+str(i))) for i in range(6)]
    for i in range(5): plan.append((f'Tail{i+1}',tail[i],tail[i+1],'Hips' if i==0 else f'Tail{i}',False))
    for lr in 'LR':
        f,b=paws['F'+lr],paws['B'+lr]
        wrist=column('F'+lr,.060); elbow=column('F'+lr,.165); elbow[1]+=.023
        shoulder=column('F'+lr,.255); shoulder[0]*=.82; scap=[shoulder[0]*.58,shoulder[1]+.025,.325]
        plan += [('Shoulder.'+lr,scap,shoulder,'Chest',False),('UpperArm.'+lr,shoulder,elbow,'Shoulder.'+lr,False),
                 ('LowerArm.'+lr,elbow,wrist,'UpperArm.'+lr,False),('Hand.'+lr,wrist,[f['x'],f['toe']+.014,.022],'LowerArm.'+lr,False)]
        hock=column('B'+lr,.095); hock[1]+=.012; knee=column('B'+lr,.183); knee[1]-=.032
        hip=column('B'+lr,.27); hip[0]*=.76
        plan += [('UpperLeg.'+lr,hip,knee,'Hips',False),('LowerLeg.'+lr,knee,hock,'UpperLeg.'+lr,False),
                 ('Foot.'+lr,hock,[b['x'],b['toe']+.013,.024],'LowerLeg.'+lr,False)]
    rig=base.build_armature(plan); rig.name='RimoNekoArmature'; rig.data.name='RimoNekoQuadrupedRig'
    print('SKELETON_READY', len(plan), flush=True)
    bpy.ops.object.select_all(action='DESELECT'); obj.select_set(True); rig.select_set(True); bpy.context.view_layer.objects.active=rig
    bpy.ops.object.parent_set(type='ARMATURE_NAME')
    for g in list(obj.vertex_groups): obj.vertex_groups.remove(g)
    segments=[(b.name,np.asarray(b.head_local),np.asarray(b.tail_local)) for b in rig.data.bones if b.name not in ('Root','PetContact','Jaw','Ear.L','Ear.R')]
    def bridge_detached_fur(P, edges, radius):
        # Bind-only graph edges: never change the selected model's mesh. Use a
        # balanced spatial tree instead of rescanning all vertices for every loose
        # fur shell. Each detached component joins its nearest main-surface point.
        count, labels=gt.components(len(P),edges); before=count
        nearby=gt.proximity_pairs(P,radius)
        extra=[(int(a),int(b)) for a,b in nearby if labels[a]!=labels[b]]
        if extra: edges=np.vstack([edges,np.asarray(extra,dtype=np.int64)])
        count,labels=gt.components(len(P),edges); forced=[]
        if count>1:
            main_label=int(np.bincount(labels).argmax()); main=np.flatnonzero(labels==main_label)
            tree=KDTree(len(main))
            for v in main: tree.insert(Vector(P[v]),int(v))
            tree.balance()
            for label in range(count):
                if label==main_label: continue
                group=np.flatnonzero(labels==label); best=None
                for v in group:
                    _,nearest,distance=tree.find(Vector(P[v]))
                    if best is None or distance<best[2]: best=(int(v),int(nearest),float(distance))
                forced.append(best)
            edges=np.vstack([edges,np.asarray([(a,b) for a,b,_ in forced],dtype=np.int64)])
        lengths=[float(np.linalg.norm(P[a]-P[b])) for a,b in extra]+[d for _,_,d in forced]
        report=dict(components_before=before,bridges=len(extra)+len(forced),forced_bridges=len(forced),max_bridge_m=max(lengths,default=0),method='KDTree nearest main component, bind graph only')
        print('BIND_GRAPH_READY',json.dumps(report),flush=True)
        return edges,report
    gt.bridge_components=bridge_detached_fur
    weights,report=sw.solve(P,F,segments,radius=.042,power=1.6,smooth_iterations=24,bridge_radius=.002,side_keep_full=.012,side_fade_to=.042)
    print('WEIGHTS_READY',flush=True)
    names=[s[0] for s in segments]; weights=np.pad(weights,((0,0),(0,3))); names+=['Jaw','Ear.L','Ear.R']
    smooth=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))
    def redirect(name,amount):
        global weights
        weights*=1-amount[:,None]; weights[:,names.index(name)]+=amount
    # Keep the face coherent, and the belly out of the swinging leg chains.
    redirect('Head',smooth((P[:,2]-(head[2]-.075))/.035)*smooth((frontY+.04-P[:,1])/.035))
    belly=(1-smooth((abs(P[:,0])-.03)/.045))*smooth((P[:,2]-.12)/.05)*(1-smooth((P[:,1]-.13)/.035))*(1-smooth((-.11-P[:,1])/.04))
    for i,n in enumerate(names):
        if n.startswith(sw.LIMB_STEMS):
            moved=weights[:,i]*belly; weights[:,i]-=moved; weights[:,names.index('Spine')]+=moved
            # Fur hanging under the abdomen must not be owned by a neighbouring shin.
            frontLimb=n.startswith(('Shoulder.','UpperArm.','LowerArm.','Hand.'))
            gate=smooth((-.035-P[:,1])/.055) if frontLimb else smooth((P[:,1]-.025)/.050)
            moved=weights[:,i]*(1-gate); weights[:,i]-=moved; weights[:,names.index('Spine' if frontLimb else 'Hips')]+=moved
    for lr,key in [('L','earRight'),('R','earLeft')]:
        b=rig.data.bones['Ear.'+lr]; a=np.asarray(b.head_local); d=np.asarray(b.tail_local)-a; t=((P-a)@d)/(d@d)
        distance=np.linalg.norm((P-a)-np.clip(t,0,1)[:,None]*d,axis=1)
        ear=smooth(t/.34)*(1-smooth((distance-.026)/.021)); redirect('Ear.'+lr,ear)
    q=P-np.asarray(mouth); u=q@np.asarray(side); v=q@np.asarray(forward); h=q@np.asarray(up)
    jaw=(h<=0).astype(float)*(1-smooth((abs(u)-.027)/.027))*smooth((v+.055)/.02)*smooth((P[:,2]-.278)/.035)
    jaw[seamSide<0]=1; jaw[seamSide>0]=0
    redirect('Jaw',jaw)
    # Paw bottoms are rigid to their end bone; fur above the wrist blends normally.
    footMasks={}
    pawNames=list(paws)
    pawXY=np.asarray([[paws[k]['x'],paws[k]['y']] for k in pawNames])
    pawOwner=np.argmin(np.linalg.norm(P[:,None,:2]-pawXY[None,:,:],axis=2),axis=1)
    for k,p in paws.items():
        near=(pawOwner==pawNames.index(k))&(abs(P[:,0]-p['x'])<.061)&(abs(P[:,1]-p['y'])<.083)
        footMasks[k]=near&(P[:,2]<.037)
        rigid=(1-smooth((P[:,2]-.057)/.027))*near
        redirect(('Hand.' if k[0]=='F' else 'Foot.')+k[1],rigid)
    cutoff=np.sort(weights,axis=1)[:,-5]; weights=np.maximum(weights-cutoff[:,None],0); weights/=weights.sum(1)[:,None]
    for col,name in enumerate(names):
        group=obj.vertex_groups.new(name=name)
        for i in np.flatnonzero(weights[:,col]>1e-8): group.add([int(i)],float(weights[i,col]),'REPLACE')
    report.update(base.normalise_weights(obj,rig)); report['specialRegions']='Head, ears, jaw, planted paw bottoms, torso belly'
PB=rig.pose.bones; DB=rig.data.bones; rest={b.name:b.matrix_local.copy() for b in DB}; FPS=120
smooth=lambda x:np.clip(x,0,1)**2*(3-2*np.clip(x,0,1))
# Skeletal IK should not re-evaluate a dense skin at every intermediate bone
# edit. Evaluate its identical linear blend once after the four chains settle.
modifiers=[modifier for modifier in obj.modifiers if modifier.type=='ARMATURE']
for modifier in modifiers: modifier.show_viewport=False
skin_indices=np.argsort(-weights,axis=1)[:,:4]
skin_values=np.take_along_axis(weights,skin_indices,axis=1)
skin_points=np.column_stack((P,np.ones(len(P))))
inverse_bind={name:DB[name].matrix_local.inverted() for name in names}
def evaluated_skin():
    matrices=np.asarray([np.asarray(PB[name].matrix@inverse_bind[name]) for name in names])
    deformed=np.einsum('nkij,nj->nki',matrices[skin_indices,:,:],skin_points,optimize=True)
    return np.einsum('nki,nk->ni',deformed[:,:,:3],skin_values,optimize=True)
np.savez_compressed(out/'binding.npz',positions=P,weights=weights,names=np.asarray(names),bonePlan=json.dumps(plan))
print('BINDING_READY',flush=True)
def upd(): bpy.context.view_layer.update()
def set_dir(bone,a,b):
    rb=DB[bone]; q=(rb.tail_local-rb.head_local).rotation_difference(b-a)@rb.matrix_local.to_quaternion()
    PB[bone].matrix=Matrix.Translation(a)@q.to_matrix().to_4x4(); upd()
def keep_orientation(bone,at): PB[bone].matrix=Matrix.Translation(at)@rest[bone].to_quaternion().to_matrix().to_4x4(); upd()
LEGS={k:(('UpperArm.','LowerArm.','Hand.') if k[0]=='F' else ('UpperLeg.','LowerLeg.','Foot.')) for k in paws}
LEGS={k:tuple(n+k[1] for n in ns) for k,ns in LEGS.items()}
neutral={k:Vector((0,0,-p['floor']+.001)) for k,p in paws.items()}
def solve_leg(k,disp,stats):
    if k[0]=='F':
        scap='Shoulder.'+k[1]; PB[scap].location=rest[scap].to_3x3().inverted()@Vector((0,(disp.y-neutral[k].y)*.43,-.005)); upd()
    upper,lower,end=LEGS[k]; start=PB[upper].head.copy(); goal=rest[end].to_translation()+disp
    a,b=DB[upper].length,DB[lower].length; axis=goal-start; requested=axis.length; axis.normalize()
    d=min(max(requested,abs(a-b)+.0003),a+b-.0003); stats[k]=max(stats[k],requested-d)
    goal=start+axis*d; along=(a*a-b*b+d*d)/(2*d); height=math.sqrt(max(0,a*a-along*along))
    pole=Vector((0,1 if k[0]=='F' else -1,0)); pole-=axis*pole.dot(axis); pole.normalize()
    joint=start+axis*along+pole*height; set_dir(upper,start,joint); set_dir(lower,joint,goal); keep_orientation(end,goal)
def rotation(bone,axis,angle):
    PB[bone].rotation_quaternion=Quaternion((DB[bone].matrix_local.to_3x3().inverted()@axis).normalized(),math.radians(angle))
sm=lambda x:float(smooth(x)); bell=lambda x:math.sin(math.pi*max(0,min(1,x)))
CLIPS={}
def clip(name,duration,loop=False):
    def wrap(fn): CLIPS[name]=(duration,loop,fn); return fn
    return wrap
faceYaw=math.degrees(math.atan2(forward.x,-forward.y))
straightened=bool(args.bind_source and previous.get('straightening'))
def common(): return {'Neck':{'yaw':0},'Head':{'yaw':0},'Hips':{'loc':(0,0,-.012)}}
def plant(): return {k:neutral[k].copy() for k in LEGS}
@clip('Idle_Loop',3,True)
def idle(t):
    w=2*math.pi*t/3; pose=common(); pose['Chest']={'pitch':.7*math.sin(w)}; pose['Head']['yaw']+=3*math.sin(w)
    for i in range(5): pose[f'Tail{i+1}']={'yaw':(1.2+i*.35)*math.sin(2*w) if straightened else (2+i)*math.sin(2*w-i*.5)}
    return pose,plant(),0,2*math.sin(w)
WALK=dict(speed=.4677073170731707,cycle=82/120,duty=.6,lift=.031)
RUN=dict(speed=2.0,cycle=.5,duty=7/30,lift=.079,touchdown={'FL':0,'FR':2/30,'BR':.5,'BL':17/30})
def gait(phase,c):
    stride=c['speed']*c['cycle']*c['duty']
    if phase<c['duty']: return Vector((0,stride*(phase/c['duty']-.5),0))
    u=(phase-c['duty'])/(1-c['duty']); return Vector((0,stride*(.5-sm(u)),c['lift']*math.sin(math.pi*u)))
def locomotion(t,c,fast):
    u=t/c['cycle']; w=2*math.pi*u; pose=common()
    pose['Hips']={'loc':(0,0,(-.041 if fast else -.027)+(.009 if fast else .004)*math.cos(2*w)),'roll':1.8*math.sin(w)}
    pose['Chest']={'yaw':2.2*math.sin(w),'roll':-1.5*math.sin(w)}; pose['Neck']['pitch']=-2*math.cos(2*w)
    offsets={'FL':0,'BR':0,'FR':.5,'BL':.5} if fast else {'BL':0,'FL':.25,'BR':.5,'FR':.75}
    for i in range(5): pose[f'Tail{i+1}']={'yaw':(3+i)*math.sin(w-i*.5),'pitch':-2*math.cos(w-i*.4)}
    return pose,{k:neutral[k]+gait((u+o)%1,c) for k,o in offsets.items()},0,0
@clip('Walk_Loop',WALK['cycle'],True)
def walk(t): return locomotion(t,WALK,False)
@clip('Run_Loop',RUN['cycle'],True)
def run(t):
    u=t/RUN['cycle']; w=2*math.pi*u; flex=math.cos(2*math.pi*(u-.36)); pose=common()
    pose['Hips']={'loc':(0,.010*flex,-.059+.022*math.cos(w-1.7*math.pi)+.007*math.cos(2*w-.2*math.pi)),'pitch':-20*flex}
    pose['Spine']={'pitch':34*flex}; pose['Chest']={'pitch':5-8*flex,'roll':.6*math.sin(w)}
    pose['Neck']['pitch']=3-6*flex; pose['Head']['pitch']=-5
    for i in range(5): pose[f'Tail{i+1}']={'pitch':(8 if i==0 else 1.5)*math.cos(w-2*math.pi*.36-i*.18),'yaw':(1+i*.4)*math.sin(w-i*.35)}
    legs={}; span=RUN['speed']*RUN['cycle']*RUN['duty']
    for key,touchdown in RUN['touchdown'].items():
        phase=(u-touchdown)%1
        if phase<RUN['duty']: y,z=span*(phase/RUN['duty']-.5),0
        else:
            swing=(phase-RUN['duty'])/(1-RUN['duty'])
            y,z=span*(.5-sm(swing)),RUN['lift']*math.sin(math.pi*swing)**1.2
        legs[key]=neutral[key]+Vector((0,y,z))
    return pose,legs,0,0
@clip('Pet',1.6)
def petting(t):
    k=bell(t/1.6); w=4*math.pi*t/1.6; pose=common(); pose['Neck'].update(pitch=-6*k,roll=3*k*math.sin(w)); pose['Head']['pitch']=-3*k
    for i in range(5): pose[f'Tail{i+1}']={'pitch':-3*k,'yaw':(4+i)*k*math.sin(w*.5-i*.5)}
    return pose,plant(),0,10*k
@clip('Happy',1.6)
def happy(t):
    settle=sm((t-1.0)/.6); k=sm(t/.25)*(1-settle)
    pose=common(); pose['Neck']['pitch']=-5*k; pose['Head']['roll']=14*k; pose['Chest']={'pitch':-2*k}
    for i in range(5): pose[f'Tail{i+1}']={'pitch':[36,0,-36,-8,0][i]*k,'yaw':(8-i)*k*math.sin(t*8-i*.45)+(0 if straightened else (2+i)*math.sin(-i*.5)*settle)}
    return pose,plant(),0,8*k
@clip('Hit',.5)
def hit(t):
    k=bell(t/.5); pose=common(); pose['Hips']={'loc':(0,.014*k,-.012-.025*k)}; pose['Chest']={'pitch':-8*k}; pose['Neck']['pitch']=-12*k; pose['Head']['pitch']=8*k
    return pose,plant(),3*k,-35*k
@clip('Hiss',2.1)
def hiss(t):
    k=sm(t/.22)*(1-sm((t-1.7)/.4)); pose=common(); pose['Hips']={'loc':(0,.025*k,-.012-.088*k),'pitch':-10*k}
    pose['Spine']={'pitch':18*k}; pose['Chest']={'pitch':8*k}; pose['Neck']['pitch']=7*k; pose['Head']['pitch']=-18*k
    for i in range(5): pose[f'Tail{i+1}']={'yaw':(-3+3*math.sin(t*9-i*.65))*k,'pitch':-4*k}
    legs=plant()
    for key in legs: legs[key].x+=(.011 if key[1]=='L' else -.011)*k
    return pose,legs,(27+1.2*math.sin(t*13))*k,-75*k

actions=[]; checks=[]; bpy.context.scene.render.fps=FPS
for name,(seconds,loop,fn) in CLIPS.items():
    action=bpy.data.actions.new(name); action.use_fake_user=True; rig.animation_data_create(); rig.animation_data.action=action
    if hasattr(rig.animation_data,'action_slot'): rig.animation_data.action_slot=action.slots.new(id_type='OBJECT',name=name)
    n=round(seconds*FPS); mins=[]; shortfall={k:0 for k in LEGS}; pawRange={k:[] for k in LEGS}
    for frame in range(n+1):
        # Exact end == start for loops, even when duration is not a multiple of 60 Hz.
        t=(frame/n*seconds if not loop or frame<n else 0); pose,legs,jawAngle,earAngle=fn(t)
        for bone,spec in pose.items():
            if 'loc' in spec: spec['loc']=tuple(rest[bone].to_3x3().inverted()@Vector(spec['loc']))
        base.apply_pose(rig,pose); rotation('Jaw',side,jawAngle)
        for lr in 'LR': rotation('Ear.'+lr,side,earAngle)
        upd()
        for key,disp in legs.items(): solve_leg(key,disp,shortfall)
        q=evaluated_skin()
        # Correct each sole separately, never lift the entire cat to hide a bad foot.
        for key,disp in legs.items():
            minimum=float(q[footMasks[key],2].min()); desired=disp.z-neutral[key].z+.001
            if minimum<desired-.0004:
                disp.z+=desired-minimum; solve_leg(key,disp,shortfall)
        q=evaluated_skin(); mins.append(float(q[:,2].min()))
        for key in LEGS: pawRange[key].append(float(q[footMasks[key],2].min()))
        for b in PB:
            b.keyframe_insert(data_path='rotation_quaternion',frame=frame); b.keyframe_insert(data_path='location',frame=frame)
    base.set_interpolation(action,'LINEAR')
    if hasattr(action,'use_frame_range'): action.use_frame_range=True; action.frame_start=0; action.frame_end=n
    check=dict(clip=name,minimum=min(mins),maxShortfall=shortfall,pawMinima={k:[min(v),max(v)] for k,v in pawRange.items()}); checks.append(check)
    actions.append(action); rig.animation_data.action=None; base.rest_pose(rig); upd(); print('CLIP_READY',json.dumps(check),flush=True)
base.rest_pose(rig)
for modifier in modifiers: modifier.show_viewport=True
upd(); base.FPS=FPS; base.export(out/'candidate.glb',actions); bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
record=dict(candidate=2,revision=args.revision,reusedBinding=args.reuse_bind,source=str(source),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),sha256=hashlib.sha256((out/'candidate.glb').read_bytes()).hexdigest(),bytes=(out/'candidate.glb').stat().st_size,
            heightMetres=H,widthMetres=float(np.ptp(P[:,0])),lengthMetres=float(np.ptp(P[:,1])),triangles=len(F),bones=[b[0] for b in plan],bonePlan=plan,weights=report,topology=topology,mouthRepair=mouthRepair,paws=paws,checks=checks,
            clips=[dict(name=n,seconds=round(c[0]*FPS)/FPS,loop=c[1],rootMotion='in-place',fps=FPS) for n,c in CLIPS.items()],
            locomotionSpeedIsExported=True,
            locomotion={n:dict(metresPerSecond=c['speed'],cycleSeconds=round(c['cycle']*FPS)/FPS,dutyFactor=c['duty'],touchdownPhases=c.get('touchdown',{'BL':0,'FL':.75,'BR':.5,'FR':.25})) for n,c in [('Walk_Loop',WALK),('Run_Loop',RUN)]},visualReviewRequired=True)
if straightened:
    record['straightening']=previous['straightening'];record['bindSource']=str(prior)
    (out/'landmarks.json').write_text(json.dumps(marks,indent=2)+'\n')
(out/'process.json').write_text(json.dumps(record,indent=2)+'\n'); print('RIG_DONE',record['sha256'],flush=True)
