import sys,json
from pathlib import Path
import numpy as np,bpy
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/howkey-scientist'
sys.path.insert(0,str(M/'workflow/candidate-01'))
import blender_rig as b
obj=b.import_mesh(M/'work/low-poly/revision-02/candidate.glb');P=b.positions(obj.data);H=1.55;b.H=H
for side,sign in [('L',1),('R',-1)]:
    q=P[sign*P[:,0]>.19*H]
    print('OUTER_HAND',side,'minZ',q[:,2].min()/H,'maxZ',q[:,2].max()/H,flush=True)
    for f in np.arange(.45,.671,.01):
        p=b.arm_centre(P,f*H,sign,half=.004*H,thickness=.033*H)
        print('ARM',side,round(f,3),[round(v/H,4) for v in p] if p else None,flush=True)
for f in np.arange(.81,.921,.01):
    q=P[(abs(P[:,0])<.025*H)&(abs(P[:,2]-f*H)<.006*H)]
    print('FACE',round(f,3),'frontY',np.quantile(q[:,1],.02)/H,flush=True)
