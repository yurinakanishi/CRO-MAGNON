"""Fit candidate 2's reconstructed mountain to the valley, retaining source topology/UVs.
Run from repository root with Blender --python this-file -- <revision>.
The QEM/normal/export tail is the shared source-preserving preparation workflow.
"""
import sys, pathlib
revision=sys.argv[sys.argv.index('--')+1]
original=pathlib.Path('assets/camp-cave/workflow/prepare-model.py').read_text()
original=original.replace("'work/trellis/reduced-res1024-seed42.glb'", "'work/trellis/massif-v2-res1024-seed42.glb'")
# Flattened uplands allow geometric QEM to span disjoint texture charts. Retain
# the native source reduction here; a low distance error does not prove UV fidelity.
original=original.replace('for ratio in [.5, .25, .125, .0625]:','for ratio in []:')
start=original.index("if key == 'camp-mountain':")
end=original.index('\nmesh.update()',start)
fit='''
if key == 'camp-mountain':
    depth=(hi.y-lo.y)*scale
    height=(hi.z-lo.z)*scale
    mesh.transform(Matrix.Diagonal(Vector((1,280/depth,44/height,1))))
    def ease(a,b,v):
        t=max(0,min(1,(v-a)/(b-a)))
        return t*t*(3-2*t)
    # Stretch the source's north-eastern foothill toward the camp. The source
    # otherwise ends midway through the approach, making a raised cut edge.
    for vertex in mesh.vertices:
        p=vertex.co;wx,wz=-75-p.x,175+p.y
        p.y-=32*ease(15,45,wx)*(1-ease(100,150,wz))
    points=sorted(set((v.co.x,v.co.y) for v in mesh.vertices))
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def half(points):
        h=[]
        for p in points:
            while len(h)>=2 and cross(h[-2],h[-1],p)<=0:h.pop()
            h.append(p)
        return h[:-1]
    hull=half(points)+half(list(reversed(points)))
    edges=[]
    for a,b in zip(hull,hull[1:]+hull[:1]):
        dx,dy=b[0]-a[0],b[1]-a[1];d=math.hypot(dx,dy)
        edges.append((a[0],a[1],dx/d,dy/d))
    def ease(a,b,v):
        t=max(0,min(1,(v-a)/(b-a)))
        return t*t*(3-2*t)
    trail=[(50,62,0),(49,73,.3),(45,84,2.5),(42,95,5),(35,104,8),
           (22,102,10.6),(8,97,13.8),(-10,91,17.8),(-30,87,22),
           (-50,90,26.5),(-68,96,29.6),(-68,116,35),(-68,123,35)]
    mesh.update()
    envelope=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
    buried=0
    for vertex in mesh.vertices:
        p=vertex.co;wx,wz=-75-p.x,175+p.y
        top=envelope.ray_cast(Vector((p.x,p.y,60)),Vector((0,0,-1)))[0]
        original_height=p.z
        surface_height=top.z if top is not None else p.z
        p.z=surface_height
        # The broad upland supports the whole existing ruin, not a narrow pedestal.
        edge=max(abs(wx+70)-58,abs(wz-183)-67)
        foundation=1-ease(0,30,edge)
        p.z=p.z*(1-foundation)+35*foundation
        # A continuous subsidiary shoulder encloses the cave roof and back.
        shoulder=22*max(0,1-((wx-20)/43)**2-((wz-136)/49)**2)**1.2
        p.z=max(p.z,shoulder)
        # Keep the original camp, mammoth meadow, bridge and river bed at their height.
        p.z*=ease(18,35,math.hypot(wx-50,wz-50))
        river=65+math.sin(wz*.065)*3.5
        p.z*=ease(7,22,river-wx)
        border=min(dx*(p.y-y)-dy*(p.x-x) for x,y,dx,dy in edges)
        p.z*=ease(0,45,border)
        # The cave entrance opens onto an eight-metre ledge. Its rear remains buried.
        ledge=(1-ease(8,18,abs(wx-35)))*(1-ease(103,113,wz))*ease(88,100,wz)
        p.z=p.z*(1-ledge)+8*ledge
        # The roof and rear of the cave are buried in a continuous mountain
        # shoulder. The entrance remains on the open ledge, not on a lone rock.
        enclosure=(1-ease(8,26,abs(wx-35)))*ease(104,117,wz)*(1-ease(133,160,wz))
        p.z=max(p.z,22*enclosure)
        # Match the actual natural trail with a broad, blended walking surface.
        nearest=1e9;level=0
        for a,b in zip(trail,trail[1:]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            t=max(0,min(1,((wx-a[0])*dx+(wz-a[1])*dz)/(dx*dx+dz*dz)))
            d=math.hypot(wx-a[0]-dx*t,wz-a[1]-dz*t)
            if d<nearest:nearest=d;level=a[2]+(b[2]-a[2])*t
        weight=1-ease(3,11,nearest)
        p.z=p.z*(1-weight)+level*weight
        # Preserve vertical source thickness, rather than folding the lower skin
        # onto the same surface. Fade the fitted rim too, so no ledge floats.
        p.z=p.z*ease(0,6,border)-(surface_height-original_height)
    mesh.normals_split_custom_set([(0,0,0)]*len(mesh.loops))
    print('Buried source underside vertices:',buried,flush=True)
'''
sys.argv=['prepare-model.py','--','camp-mountain','280',revision,'.09']
exec(compile(original[:start]+fit+original[end:],'prepare-massif-expanded.py','exec'))
