"""Measure every exported skinned surface at 60 Hz, independently of Blender."""
import argparse,hashlib,json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
ap=argparse.ArgumentParser();ap.add_argument('key');ap.add_argument('--revision',default='01');args=ap.parse_args()
model=ROOT/'output/model-generation/models'/args.key;folder=model/f'work/rig/revision-{args.revision}';path=folder/'candidate.glb';out=folder/'qa/numeric.json';out.parent.mkdir(parents=True,exist_ok=True)
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'));sys.path.insert(0,str(model/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
r=Rigged(path);g=r.gltf;nodes={n.get('name'):i for i,n in enumerate(g['nodes'])};P=r.skinned({},0);F=r.merged_faces();edges=gt.unique_edges(F);length=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1);H=float(np.ptp(P[:,1]));valid=length>.0018*H
area=lambda q:np.linalg.norm(np.cross(q[F[:,1]]-q[F[:,0]],q[F[:,2]]-q[F[:,0]]),axis=1)*.5
areas=area(P);big=areas>H*H*.0000004;total=areas.sum();weights=np.concatenate([p['W'] for p in r.prims]);restroot=r.global_transforms({},0)[nodes['Root']];records=[];errors=[]
assert set(a['name'] for a in g['animations'])==set(json.loads((model/'request-spec.json').read_text(encoding='utf-8'))['clips'])
process=json.loads((folder/'process.json').read_text())
for a in g['animations']:
    name=a['name'];tracks=r.tracks(a);duration=max(s.times[-1] for tr in tracks.values() for s in tr.values());times=np.linspace(0,duration,round(duration*60)+1)
    first=r.skinned(tracks,0);last=r.skinned(tracks,duration);lo=np.full(3,np.inf);hi=-lo;ground=1e9;elong=1;worstArea=1;collapsed=0;rootdrift=0;ankles={'L':[],'R':[]};hands=[]
    for t in times:
        q=r.skinned(tracks,float(t));mat=r.global_transforms(tracks,float(t));lo=np.minimum(lo,q.min(0));hi=np.maximum(hi,q.max(0));ground=min(ground,float(q[:,1].min()));rootdrift=max(rootdrift,float(np.max(np.abs(mat[nodes['Root']]-restroot))))
        ratio=np.linalg.norm(q[edges[:,1]]-q[edges[:,0]],axis=1)[valid]/length[valid];elong=max(elong,float(ratio.max()));ar=area(q);worstArea=min(worstArea,float(ar.sum()/total));collapsed=max(collapsed,int(((ar[big]/areas[big])<.03).sum()))
        for side in ankles:ankles[side].append(mat[nodes['Hand.'+side]][:3,3].tolist())
    closure=float(np.max(np.linalg.norm(first-last,axis=1)))
    rec=dict(clip=name,seconds=float(duration),samples=len(times),minimumGroundMetres=ground,bounds={'min':lo.tolist(),'max':hi.tolist()},rootMatrixMaxDelta=rootdrift,maximumEdgeElongation=elong,minimumTotalAreaRatio=worstArea,maximumCollapsedMeaningfulTriangles=collapsed,meaningfulTriangles=int(big.sum()),loopClosureMetres=closure if name.endswith('_Loop') else None)
    rec['handJointBounds']={side:{'min':np.min(pts,axis=0).tolist(),'max':np.max(pts,axis=0).tolist()} for side,pts in ankles.items()}
    if ground<-.006:errors.append(name+' ground penetration exceeds 6mm')
    if rootdrift>1e-5:errors.append(name+' root world motion')
    if name.endswith('_Loop') and closure>1e-5:errors.append(name+' loop seam')
    if elong>6:errors.append(name+' edge stretch exceeds 6x')
    records.append(rec);print(json.dumps(rec),flush=True)
report=dict(source=path.relative_to(model).as_posix(),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),bytes=path.stat().st_size,triangles=len(F),renderVertices=len(P),skinJoints=len(r.joints),restBounds={'min':P.min(0).tolist(),'max':P.max(0).tolist()},weights={'sumMin':float(weights.sum(1).min()),'sumMax':float(weights.sum(1).max()),'maxInfluences':int((weights>0).sum(1).max())},clips=records,errors=errors,numericPass=not errors,visualReviewRequired=True)
out.write_text(json.dumps(report,indent=2)+'\n');print('NUMERIC_DONE',not errors,flush=True);sys.exit(1 if errors else 0)
