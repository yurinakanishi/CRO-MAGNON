"""Repair the accepted TRELLIS cave and resurface its measured mountain.
No primitive terrain is substituted: every hill sample is a ray projection onto
the retained r11 TRELLIS-derived skin, with hole repair and a low-pass finish.
Blender --background --python this-file -- cave|mountain REVISION
"""
import bpy, bmesh, math, pathlib, sys, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

kind, revision = sys.argv[sys.argv.index('--') + 1:]
key = 'camp-' + kind
out = pathlib.Path('assets') / key / 'work' / ('revision-' + revision)
out.mkdir(parents=True, exist_ok=True)
assert not (out / 'model.glb').exists(), 'Keep completed revisions'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def load(path):
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(path).resolve()))
    objects=[o for o in bpy.context.scene.objects if o not in before and o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj

def ease(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

if kind=='cave':
    obj=load('public/models/camp-cave/model-r05.glb')
    mesh=obj.data
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
    bm.to_mesh(mesh);bm.free()
    # Keep the entrance world position; the placement moves half an old depth
    # into the mountain, while the source is stretched along its chamber axis.
    for v in mesh.vertices:
        v.co.y*=2
        z=v.co.z
        floor=1-ease(1.4,2.7,z)
        v.co.z=z*(1-floor)+(1.05+(z-1.05)*.10)*floor
    modifier=obj.modifiers.new('Welded rock surface finish','SMOOTH')
    modifier.factor=.32;modifier.iterations=7
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    # The old separate blocking rock becomes the natural end of this same GLB.
    cap=load('public/models/valley-boulder/model.glb')
    lo=[min(v.co[i] for v in cap.data.vertices) for i in range(3)]
    hi=[max(v.co[i] for v in cap.data.vertices) for i in range(3)]
    for v in cap.data.vertices:
        v.co.x=(v.co.x-(lo[0]+hi[0])/2)*14/(hi[0]-lo[0])
        v.co.y=(v.co.y-(lo[1]+hi[1])/2)*7.6/(hi[1]-lo[1])+12.05
        v.co.z=(v.co.z-lo[2])*8.6/(hi[2]-lo[2])+.75
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True);cap.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.object.join()
    report={'source':'public/models/camp-cave/model-r05.glb','depthScale':2,
            'endRock':'public/models/valley-boulder/model.glb','floor':'source floor flattened and smoothed; source UVs retained'}
else:
    source=load('public/models/camp-mountain/model-r11.glb')
    bvh=BVHTree.FromObject(source,bpy.context.evaluated_depsgraph_get())
    step=.8
    xs=np.arange(-140,140+step/2,step);ys=np.arange(-140,140+step/2,step)
    h=np.zeros((len(ys),len(xs)));valid=np.zeros_like(h)
    for j,y in enumerate(ys):
        for i,x in enumerate(xs):
            hit=bvh.ray_cast(Vector((x,y,70)),Vector((0,0,-1)))[0]
            if hit is not None:h[j,i]=max(0,hit.z);valid[j,i]=1
    def blur(a,r):
        p=np.pad(a,((0,0),(r,r)),mode='edge')
        a=sum(p[:,i:i+a.shape[1]] for i in range(2*r+1))/(2*r+1)
        p=np.pad(a,((r,r),(0,0)),mode='edge')
        return sum(p[i:i+a.shape[0]] for i in range(2*r+1))/(2*r+1)
    # Repair short source holes by normalized neighbours, then smooth relief.
    weights=blur(valid,4)
    fill=blur(h,4)/np.maximum(weights,.0001)
    h=np.where(valid>0,h,fill)
    for _ in range(3):h=blur(h,2)
    X,Y=np.meshgrid(xs,ys);wx=-75-X;wz=175+Y
    edge=np.maximum(abs(wx+70)-58,abs(wz-183)-67)
    foundation=1-ease(0,30,edge);h=h*(1-foundation)+35*foundation
    enclosure=(1-ease(7.5,25,abs(wx-35)))*ease(103,118,wz)*(1-ease(147,174,wz))
    h=np.maximum(h,22*enclosure)
    ledge=(1-ease(8,18,abs(wx-35)))*(1-ease(103,113,wz))*ease(88,100,wz)
    h=h*(1-ledge)+8*ledge
    trail=[(50,62,0),(49,73,.3),(45,84,2.5),(42,95,5),(35,104,8),
           (22,102,10.6),(8,97,13.8),(-10,91,17.8),(-30,87,22),
           (-50,90,26.5),(-68,96,29.6),(-68,116,35),(-68,123,35)]
    nearest=np.full_like(h,1e9);level=np.zeros_like(h)
    for a,b in zip(trail,trail[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1];t=np.clip(((wx-a[0])*dx+(wz-a[1])*dz)/(dx*dx+dz*dz),0,1)
        distance=np.hypot(wx-a[0]-dx*t,wz-a[1]-dz*t)
        take=distance<nearest;level=np.where(take,a[2]+(b[2]-a[2])*t,level);nearest=np.minimum(nearest,distance)
    weight=1-ease(3.5,13,nearest);h=h*(1-weight)+level*weight
    # Do not leave a zero-height sheet over the river or the depressed shore.
    river=65+np.sin(wz*.065)*3.5
    h*=ease(7,20,river-wx)*ease(18,35,np.hypot(wx-50,wz-50))
    # Broad, walkable river-side foothill instead of a tall compressed turf wall.
    cap=np.maximum(0,(river-wx-6)*.72)
    h=np.minimum(h,cap)
    # The source cave has a long open floor apron before its rock arch.
    # Keep that approach below the floor rather than raising a soil ramp
    # through the doorway. The measured roof mask handles the arch itself.
    apron=(1-ease(4.8,10,abs(wx-35)))*ease(103,107,wz)*(1-ease(116,121,wz))
    h=h*(1-apron)+7.95*apron
    coverage=ease(.05,.8,weights)*ease(0,6,np.minimum(140-abs(X),140-abs(Y)))
    h=h*coverage-1.1*(1-ease(.015,.22,h*coverage))
    # Retopology of the source ray field: adjacent cells share the exact vertex.
    vertices=[(float(x),float(y),float(h[j,i])) for j,y in enumerate(ys) for i,x in enumerate(xs)]
    n=len(xs);faces=[]
    for j in range(len(ys)-1):
        for i in range(n-1):
            a=j*n+i;faces.extend([(a,a+1,a+n+1),(a,a+n+1,a+n)])
    mesh=bpy.data.meshes.new('Retopologized source envelope')
    mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('Source mountain continuous surface',mesh);bpy.context.collection.objects.link(obj)
    # Use the accepted meadow surface texture for a consistent adjoining soil.
    ground=load('public/models/meadow-ground/model.glb')
    mesh.materials.append(ground.data.materials[0])
    uv=mesh.uv_layers.new(name='Source meadow tiling')
    for face in mesh.polygons:
        for li in face.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv=(( -75-v.x)/32,(175+v.y)/32)
    bpy.data.objects.remove(ground,do_unlink=True);bpy.data.objects.remove(source,do_unlink=True)
    report={'source':'public/models/camp-mountain/model-r11.glb','method':'ray-projected source-envelope retopology, normalized hole repair, 3 local smoothing passes',
            'step':step,'textureSource':'public/models/meadow-ground/model.glb','maximum':float(h.max()),'originalSamples':int(valid.sum())}

for polygon in obj.data.polygons:polygon.use_smooth=True
# Preserve original face winding; an open terrain sheet has no unambiguous
# outside for volume-based normal repair. Its measured upward winding is explicit.
obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str((out/'model.glb').resolve()),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=str((out/'source-derived.blend').resolve()))
report['triangles']=sum(len(p.vertices)-2 for p in obj.data.polygons)
(out/'process.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
