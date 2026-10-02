import sys,json
from pathlib import Path
import bpy,bmesh
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base
source=Path(sys.argv[sys.argv.index('--')+1])
obj=base.import_dense(source);base.weld(obj)
bm=bmesh.new();bm.from_mesh(obj.data)
unseen=set(bm.verts);groups=[]
while unseen:
    stack=[unseen.pop()];group=[]
    while stack:
        v=stack.pop();group.append(v)
        for e in v.link_edges:
            q=e.other_vert(v)
            if q in unseen:unseen.remove(q);stack.append(q)
    groups.append(group)
rows=[]
for group in sorted(groups,key=len,reverse=True)[:15]:
    p=np.array([list(v.co) for v in group]);rows.append(dict(vertices=len(group),min=p.min(0).tolist(),max=p.max(0).tolist(),center=p.mean(0).tolist()))
print(json.dumps(dict(source=str(source),bounds=rows)),flush=True)
P=base.positions_of(obj.data);F=base.face_array(obj.data)
from mathutils import Vector
for i,group in enumerate(sorted(groups,key=len,reverse=True)[:2]):
    allowed=np.zeros(len(P),bool);allowed[[v.index for v in group]]=True
    tree=base.bvh_from_arrays(P,F[allowed[F].all(1)])
    rays=[]
    for x in [-.22,-.125,-.06,0,.125]:
        for z in [-.11,-.02,.01,.12]:
            hit=tree.ray_cast(Vector((x,-2,z)),Vector((0,1,0)))
            rays.append([x,z,list(hit[0]) if hit[0] else None])
    print(json.dumps(dict(component=i,rays=rays)),flush=True)
