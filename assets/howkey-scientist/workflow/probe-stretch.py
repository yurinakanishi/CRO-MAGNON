import json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/howkey-scientist'
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'));sys.path.insert(0,str(M/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
path=Path(sys.argv[1]);r=Rigged(path);P=r.rest;edges=gt.unique_edges(r.merged_faces())
length=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1);valid=length>.00279
W=np.concatenate([p['W'] for p in r.prims]);J=np.concatenate([p['J'] for p in r.prims])
names=[r.node_name(n) for n in r.joints];records=[]
for a in r.animations():
    if a['name'] not in ['Gather','Run_Loop','Walk_Loop','Downed','Eat']:continue
    track=r.tracks(a);duration=r.clip_bounds(a)[1]
    worst=[]
    for t in np.linspace(0,duration,19):
        Q=r.skinned(track,t);ratio=np.linalg.norm(Q[edges[:,1]]-Q[edges[:,0]],axis=1)/np.maximum(length,1e-10)
        for i in np.argsort(np.where(valid,ratio,0))[-5:]:
            ids=edges[i];worst.append(dict(t=float(t),stretch=float(ratio[i]),rest=P[ids].tolist(),
                deformed=Q[ids].tolist(),weights=[{names[j]:float(w) for j,w in zip(J[k],W[k]) if w>0} for k in ids]))
    worst.sort(key=lambda x:x['stretch'],reverse=True);records.append(dict(clip=a['name'],worst=worst[:4]))
print(json.dumps(records,indent=2));(path.parent/'qa/stretch.json').write_text(json.dumps(records,indent=2)+'\n')
