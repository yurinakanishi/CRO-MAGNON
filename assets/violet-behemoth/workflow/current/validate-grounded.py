"""Support contact and motion retention on the exact exported GLB at 120 Hz."""
import hashlib,json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/violet-behemoth'
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0,str(M/'workflow/candidate-01'))
from glb_skin import Rigged
revision=sys.argv[1] if len(sys.argv)>1 else '10'
folder=M/f'work/rig/revision-{revision}'
r=Rigged(folder/'candidate.glb');old=Rigged(M/'work/rig/revision-08/candidate.glb')
P=r.skinned({},0);width=np.ptp(P[:,0]);height=np.ptp(P[:,1]);nodes={n.get('name'):i for i,n in enumerate(r.gltf['nodes'])}
masks=[(P[:,0]*sign>.14*width)&(P[:,2]>1.12)&(P[:,1]<.24*height) for sign in [1,-1]]
def duration(tr):return float(max(s.times[-1] for ts in tr.values() for s in ts.values()))
animations={a['name']:r.tracks(a) for a in r.gltf['animations']}
previous={a['name']:old.tracks(a) for a in old.gltf['animations']}
retained=['Alert','Attack','Death','Hit','Idle_Loop','Run_Loop','Walk_Loop']
errors=[];records=[]
for name in retained:
    maximum=0
    for t in np.linspace(0,duration(animations[name]),13):
        maximum=max(maximum,float(np.linalg.norm(r.skinned(animations[name],t)-old.skinned(previous[name],t),axis=1).max()))
    records.append({'clip':name,'retainedMaximumVertexDifference':maximum})
    if maximum>.00002:errors.append(name+' retained surface motion differs by more than 20 micrometres')
for name in ['Roar','Gape','Tremble','SpitWindup','Spit','Charge','TailSpin']:
    tr=animations[name];support=[];floor=[];tail=[];hip=[];hands=[]
    for t in np.linspace(0,duration(tr),round(duration(tr)*120)+1):
        q=r.skinned(tr,float(t));mat=r.global_transforms(tr,float(t))
        support.append([float(q[mask,1].min()) for mask in masks]);floor.append(float(q[:,1].min()))
        hip.append(mat[nodes['Hips']][1,3]);hands.append([mat[nodes['Hand.'+s]][[0,2],3].tolist() for s in ['L','R']])
        # Direction of the actual tail centreline in the exported skin.
        points=[q[(P[:,2]<z+.12)&(P[:,2]>z-.12)].mean(0) for z in [-.8,-2,-3.6]]
        directions=[np.arctan2((points[i+1]-points[i])[0],-(points[i+1]-points[i])[2]) for i in range(2)]
        bend=abs(np.arctan2(np.sin(directions[1]-directions[0]),np.cos(directions[1]-directions[0])))
        tail.append(float(bend))
    max_support=float(np.min(support,axis=1).max());minimum=min(floor)
    rec={'clip':name,'samples':len(floor),'minimumGroundMetres':minimum,
         'maximumLowestPalmMetres':max_support,'hipsVerticalRangeMetres':float(np.ptp(hip)),
         'maximumTailCentrelineBendDegrees':float(np.rad2deg(max(tail))),
         'palmHorizontalJointRange':np.ptp(np.asarray(hands),axis=0).tolist()}
    if name in ['Roar','Gape','Tremble','SpitWindup','Spit']:
        if max_support>.008:errors.append(name+' loses support contact')
        if float(np.ptp(np.asarray(hands),axis=0).max())>.001:errors.append(name+' planted palm drifts')
    if minimum<-.006:errors.append(name+' penetrates the floor')
    if name in ['Charge','TailSpin'] and max(tail)<np.deg2rad(15):errors.append(name+' tail is too rigid')
    records.append(rec);print(json.dumps(rec),flush=True)
report={'revision':revision,'sha256':hashlib.sha256((folder/'candidate.glb').read_bytes()).hexdigest(),
        'sampleRate':120,'scaleInGame':2.5,'pass':not errors,'records':records,'errors':errors}
(folder/'qa/grounded.json').write_text(json.dumps(report,indent=2)+'\n')
print('GROUNDED_DONE',report['pass'],errors,flush=True)
sys.exit(1 if errors else 0)
