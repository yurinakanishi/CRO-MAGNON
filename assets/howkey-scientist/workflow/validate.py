"""Evaluate all vertices of the exact delivery, including interpolated frames."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
MODEL=ROOT/'output/model-generation/models/howkey-scientist'
ap=argparse.ArgumentParser();ap.add_argument('path');ap.add_argument('--hz',type=int,default=120);args=ap.parse_args()
path=Path(args.path);out=path.parent/'qa/numeric.json';out.parent.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0,str(MODEL/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
r=Rigged(path);g=r.gltf;nodes={n.get('name'):i for i,n in enumerate(g['nodes'])}
P=r.skinned({},0);F=r.merged_faces();edges=gt.unique_edges(F)
length=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1);H=float(np.ptp(P[:,1]));valid=length>.0018*H
area=lambda q:np.linalg.norm(np.cross(q[F[:,1]]-q[F[:,0]],q[F[:,2]]-q[F[:,0]]),axis=1)*.5
areas=area(P);big=areas>H*H*.0000004;total=areas.sum()
weights=np.concatenate([p['W'] for p in r.prims]);restroot=r.global_transforms({},0)[nodes['Root']]
records=[];errors=[]
required={'Idle_Loop','Walk_Loop','Run_Loop','Gather','Craft','Give','Eat','Wave','Attack','Downed'}
assert required=={a['name'] for a in r.animations()}
for a in r.animations():
    name=a['name'];tracks=r.tracks(a);duration=r.clip_bounds(a)[1]
    times=np.linspace(0,duration,round(duration*args.hz)+1)
    first=r.skinned(tracks,0);last=r.skinned(tracks,duration)
    lo=np.full(3,np.inf);hi=-lo;ground=1e9;elong=1;worstArea=1;collapsed=0;rootdrift=0
    for t in times:
        q=r.skinned(tracks,float(t));mat=r.global_transforms(tracks,float(t))
        assert np.isfinite(q).all()
        lo=np.minimum(lo,q.min(0));hi=np.maximum(hi,q.max(0));ground=min(ground,float(q[:,1].min()))
        rootdrift=max(rootdrift,float(np.max(np.abs(mat[nodes['Root']]-restroot))))
        ratio=np.linalg.norm(q[edges[:,1]]-q[edges[:,0]],axis=1)[valid]/length[valid]
        elong=max(elong,float(ratio.max()));ar=area(q);worstArea=min(worstArea,float(ar.sum()/total))
        collapsed=max(collapsed,int(((ar[big]/areas[big])<.03).sum()))
    closure=float(np.max(np.linalg.norm(first-last,axis=1)))
    rec=dict(clip=name,seconds=float(duration),samples=len(times),minimumGroundMetres=ground,
        bounds={'min':lo.tolist(),'max':hi.tolist()},rootMatrixMaxDelta=rootdrift,
        maximumEdgeElongation=elong,minimumTotalAreaRatio=worstArea,
        maximumCollapsedMeaningfulTriangles=collapsed,meaningfulTriangles=int(big.sum()),
        loopClosureMetres=closure if name.endswith('_Loop') else None)
    if name=='Attack':
        rec['handsAtRelease']={side:r.global_transforms(tracks,.4)[nodes['Grip.'+side]][:3,3].tolist() for side in ['L','R']}
    if ground<-.006:errors.append(name+' ground penetration exceeds 6mm')
    if rootdrift>1e-5:errors.append(name+' Root moves')
    if name.endswith('_Loop') and closure>1e-5:errors.append(name+' loop seam')
    if elong>8:errors.append(name+' edge stretch exceeds 8x')
    records.append(rec);print(json.dumps(rec),flush=True)
report=dict(source=str(path),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size,
    sampleRate=args.hz,triangles=len(F),renderVertices=len(P),skinJoints=len(r.joints),
    restBounds={'min':P.min(0).tolist(),'max':P.max(0).tolist()},
    weights={'sumMin':float(weights.sum(1).min()),'sumMax':float(weights.sum(1).max()),'maxInfluences':int((weights>0).sum(1).max())},
    clips=records,errors=errors,numericPass=not errors,visualReviewRequired=True)
out.write_text(json.dumps(report,indent=2)+'\n');print('NUMERIC_DONE',not errors,flush=True)
sys.exit(1 if errors else 0)
