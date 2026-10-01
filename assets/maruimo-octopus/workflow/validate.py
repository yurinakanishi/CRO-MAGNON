"""Evaluate every vertex of the exported skin, including between-key poses."""
import argparse, hashlib, json, sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
from glb_skin import Rigged
import graph_tools as gt
p=argparse.ArgumentParser()
p.add_argument('path')
p.add_argument('--hz',type=int,default=120)
args=p.parse_args()
path=Path(args.path)
r=Rigged(path)
out=path.parent/'qa/numeric.json'
out.parent.mkdir(parents=True,exist_ok=True)
P=r.skinned({},0)
F=r.merged_faces()
edges=gt.unique_edges(F)
length=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1)
valid=length>.002
edges,length=edges[valid],length[valid]
nodes={n.get('name'):i for i,n in enumerate(r.gltf['nodes'])}
root=r.global_transforms({},0)[nodes['Root']]
records=[]
errors=[]
required={'Idle_Loop','Walk_Loop','Run_Loop','Attack','Gather','Craft','Give','Eat','Wave','Jump','Ride_Loop','Boat_Loop','Downed'}
assert {a['name'] for a in r.animations()}==required
W=np.concatenate([p['W'] for p in r.prims])
assert np.abs(W.sum(1)-1).max()<1e-6
for clip in r.animations():
    name=clip['name']
    tracks=r.tracks(clip)
    duration=r.clip_bounds(clip)[1]
    steps=round(duration*args.hz)
    first=r.skinned(tracks,0)
    lo=np.full(3,np.inf)
    hi=-lo
    rootdrift=0
    maxelong=1
    maxgap=0
    for frame in range(steps+1):
        t=duration*frame/steps
        q=r.skinned(tracks,t)
        assert np.isfinite(q).all()
        lo=np.minimum(lo,q.min(0))
        hi=np.maximum(hi,q.max(0))
        maxgap=max(maxgap,float(q[:,1].min()))
        transforms=r.global_transforms(tracks,t)
        rootdrift=max(rootdrift,float(np.abs(transforms[nodes['Root']]-root).max()))
        if frame % max(1,args.hz//24)==0:
            maxelong=max(maxelong,float((np.linalg.norm(q[edges[:,1]]-q[edges[:,0]],axis=1)/length).max()))
    closure=float(np.linalg.norm(first-q,axis=1).max())
    rec=dict(clip=name,seconds=duration,samples=steps+1,minimumY=float(lo[1]),maximumLowestY=maxgap,
             bounds=dict(min=lo.tolist(),max=hi.tolist()),rootDrift=rootdrift,maximumEdgeElongation=maxelong,
             loopClosure=closure if name.endswith('_Loop') else None)
    if name=='Attack':
        rec['tipAtImpact']=r.global_transforms(tracks,.4)[nodes['Grip.R']][:3,3].tolist()
    if lo[1]<-.003: errors.append(name+': floor penetration greater than 3mm')
    if rootdrift>1e-5: errors.append(name+': root drift')
    if name.endswith('_Loop') and closure>1e-5: errors.append(name+': loop seam')
    if maxelong>8: errors.append(name+': edge stretch greater than 8x')
    records.append(rec)
    print(json.dumps(rec),flush=True)
report=dict(file=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),sampleHz=args.hz,
            renderVertices=len(P),triangles=len(F),bones=len(r.joints),clips=records,
            weightSumError=float(np.abs(W.sum(1)-1).max()),errors=errors,numericPass=not errors,
            scope=f'All surface vertices at {args.hz} Hz including interpolated frames; edge stretch at up to 24 Hz. Visual review separately checks curl intersections.')
out.write_text(json.dumps(report,indent=2)+'\n')
print('NUMERIC_DONE',not errors,flush=True)
sys.exit(1 if errors else 0)
