"""Short diagnostic for the common ground-origin pivot of torso and support paws."""
import sys,json
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
M=ROOT/'output/model-generation/models/violet-behemoth-quadruped'
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools')); sys.path.insert(0,str(M/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
rev=sys.argv[1]; r=Rigged(M/f'work/rig/revision-{rev}/candidate.glb'); P=r.rest
edges=gt.unique_edges(r.merged_faces()); lengths=np.linalg.norm(P[edges[:,1]]-P[edges[:,0]],axis=1); valid=lengths>.006
tr=r.tracks(next(a for a in r.animations() if a['name']=='TailSpin')); rows=[]
for t in np.linspace(0,1.5,31):
    q=r.skinned(tr,t); ratio=np.linalg.norm(q[edges[:,1]]-q[edges[:,0]],axis=1)[valid]/lengths[valid]
    rows.append({'seconds':float(t),'maxEdge':float(ratio.max()),'p99Edge':float(np.quantile(ratio,.99)),'floor':float(q[:,1].min())})
print(json.dumps({'revision':rev,'max':max(x['maxEdge'] for x in rows),'p99':max(x['p99Edge'] for x in rows),'floor':min(x['floor'] for x in rows),'samples':rows},indent=2))
