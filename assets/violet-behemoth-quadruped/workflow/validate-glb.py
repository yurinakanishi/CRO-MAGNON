"""Independent 240 Hz playback of the final GLB, including between authored keys."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M=ROOT/'output/model-generation/models/violet-behemoth-quadruped'
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0,str(M/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
revision=sys.argv[1] if len(sys.argv)>1 else '01'
folder=M/f'work/rig/revision-{revision}'; out=folder/'qa'; out.mkdir(parents=True,exist_ok=True)
r=Rigged(folder/'candidate.glb'); P=r.skinned({},0); F=r.merged_faces()
process=json.loads((folder/'process.json').read_text()); nodes={n.get('name'):i for i,n in enumerate(r.gltf['nodes'])}
edges=gt.unique_edges(F); lengths=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1); valid=lengths>.006
W=np.concatenate([p['W'] for p in r.prims]); errors=[]; records=[]
names=sorted(a['name'] for a in r.animations())
assert names==sorted(json.loads((M/'request-spec.json').read_text(encoding='utf-8'))['clips'])
feet={}
for end,sign in [('F',1),('B',-1)]:
    for side,s in [('L',1),('R',-1)]:
        feet[end+side]=(P[:,0]*s>.38)&(P[:,2]*sign>.45)&(P[:,1]<.19)
        assert feet[end+side].sum()>20
rest=r.global_transforms({},0); tracks_by_name={a['name']:r.tracks(a) for a in r.animations()}
for name,tr in tracks_by_name.items():
    duration=float(max(s.times[-1] for ts in tr.values() for s in ts.values()))
    expected=next(c['seconds'] for c in process['clips'] if c['name']==name)
    if abs(duration-expected)>1e-5: errors.append(name+' duration differs from authored manifest')
    times=np.linspace(0,duration,round(duration*240)+1); supports=[]; floor=[]; edge_max=0.; p99=0.; root_drift=0.; joints=[]; tail=[]
    for t in times:
        q=r.skinned(tr,float(t)); mats=r.global_transforms(tr,float(t))
        floor.append(float(q[:,1].min())); supports.append([float(q[mask,1].min()) for mask in feet.values()])
        joints.append([mats[nodes[prefix+side]][:3,3] for prefix,side in [('Hand.','L'),('Hand.','R'),('Foot.','L'),('Foot.','R')]])
        root_drift=max(root_drift,float(np.abs(mats[nodes['Root']]-rest[nodes['Root']]).max()))
        ratio=np.linalg.norm(q[edges[:,1]]-q[edges[:,0]],axis=1)[valid]/lengths[valid]
        edge_max=max(edge_max,float(ratio.max())); p99=max(p99,float(np.quantile(ratio,.99)))
        tail.append([mats[nodes[f'Tail{i}']][:3,3].tolist() for i in [1,4,7]])
    supports=np.array(supports); joint_range=np.ptp(np.asarray(joints),axis=0)
    closure=float(np.linalg.norm(r.skinned(tr,0)-r.skinned(tr,duration),axis=1).max())
    contacts=(supports<=.009).sum(1)
    rec={'clip':name,'seconds':duration,'samples':len(times),'minimumGroundMetres':min(floor),
         'maximumLowestPawMetres':float(supports.min(1).max()),'minimumPawsInContact':int(contacts.min()),
         'allPawsAirborneFraction':float((contacts==0).mean()),'pawJointRangeMetres':joint_range.tolist(),
         'rootMatrixMaxDelta':root_drift,'maximumEdgeElongation':edge_max,'maximumP99EdgeElongation':p99,
         'loopClosureMetres':closure if name.endswith('_Loop') else None}
    if min(floor)<-.006: errors.append(name+' floor penetration >6 mm')
    if root_drift>1e-5: errors.append(name+' contains world root motion')
    if name.endswith('_Loop') and closure>1e-5: errors.append(name+' loop seam')
    if edge_max>6.: errors.append(name+' meaningful mesh edge exceeds 6x rest length')
    if name in ['Roar','Gape','Tremble','SpitWindup','Spit','Alert','Attack','Hit','Idle_Loop']:
        if contacts.min()<3: errors.append(name+' loses three-paw support')
    if name in ['Walk_Loop','Run_Loop','Charge']:
        if contacts.min()<1: errors.append(name+' unintended flight')
        if joint_range[:,2].min()<.15: errors.append(name+' one of the four legs does not stride')
    if name in ['Gape','Tremble','SpitWindup','Spit','Alert','Attack','Hit','Idle_Loop']:
        if joint_range[:,[0,2]].max()>.002: errors.append(name+' planted paw slides')
    records.append(rec); print(json.dumps(rec),flush=True)
if not np.isfinite(W).all() or np.abs(W.sum(1)-1).max()>1e-5 or (W>0).sum(1).max()>4:
    errors.append('Invalid skin weights')
# Sample the mouth at the game's exact release mapped into authored clip time.
tr=tracks_by_name['Spit']; at=.18; mats=r.global_transforms(tr,at)
aperture=np.array([0,2.115,2.36,1.])
point=sum(mats[nodes[n]]@np.linalg.inv(rest[nodes[n]])@aperture for n in ['Head','Jaw'])*.5
mouth={'authoredSeconds':at,'activeMilliseconds':144,'mouthSide':float(point[0]),'mouthHeight':float(point[1]),'mouthForward':float(point[2]),'method':'Midpoint of upper and lower lip reference transformed by exact exported Head/Jaw matrices.'}
mouth_windup=[]
for t in np.linspace(0,1.3,17):
    mats=r.global_transforms(tracks_by_name['SpitWindup'],float(t))
    p=sum(mats[nodes[n]]@np.linalg.inv(rest[nodes[n]])@aperture for n in ['Head','Jaw'])*.5
    mouth_windup.append({'forward':round(float(p[2]),6),'height':round(float(p[1]),6)})
report={'revision':revision,'sha256':hashlib.sha256(r.raw).hexdigest(),'bytes':len(r.raw),'sampleRate':240,'triangles':len(F),'renderVertices':len(P),'skinJoints':len(r.joints),
        'restBounds':{'min':P.min(0).tolist(),'max':P.max(0).tolist()},'weights':{'sumMin':float(W.sum(1).min()),'sumMax':float(W.sum(1).max()),'maxInfluences':int((W>0).sum(1).max())},
        'mouth':mouth,'mouthWindup':mouth_windup,'clips':records,'numericPass':not errors,'errors':errors,'visualReviewRequired':True}
(out/'numeric.json').write_text(json.dumps(report,indent=2)+'\n'); print('NUMERIC_DONE',not errors,errors,flush=True)
sys.exit(1 if errors else 0)
