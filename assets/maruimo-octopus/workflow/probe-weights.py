import json,sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
from glb_skin import Rigged
import graph_tools as gt
r=Rigged(sys.argv[1]); P=r.rest; F=r.merged_faces();E=gt.unique_edges(F)
L=np.linalg.norm(P[E[:,0]]-P[E[:,1]],axis=1);good=L>.002;E=E[good];L=L[good]
W=np.concatenate([p['W'] for p in r.prims]);J=np.concatenate([p['J'] for p in r.prims])
def describe(i):return dict(index=int(i),point=P[i].tolist(),skin=[(r.node_name(r.joints[j]),round(float(w),4)) for j,w in zip(J[i],W[i]) if w>.001])
for clip in r.animations():
    if '--all' not in sys.argv and clip['name'] not in ['Idle_Loop','Run_Loop','Walk_Loop','Wave','Attack']: continue
    duration=r.clip_bounds(clip)[1];tracks=r.tracks(clip);best=None
    for t in np.linspace(0,duration,25):
        q=r.skinned(tracks,t);R=np.linalg.norm(q[E[:,0]]-q[E[:,1]],axis=1)/L
        maximum=float(R.max())
        if best is None or maximum>best['maximum']:
            worst=int(R.argmax());a,b=E[worst]
            best=dict(clip=clip['name'],time=float(t),maximum=maximum,p999=float(np.percentile(R,99.9)),over8=int((R>8).sum()),edges=len(E),restLength=float(L[worst]),a=describe(a),b=describe(b),posedA=q[a].tolist(),posedB=q[b].tolist())
    print(json.dumps(best),flush=True)
