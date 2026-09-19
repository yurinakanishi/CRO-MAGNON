"""Conservative conversion of the saved TRELLIS mesh; creates no replacement geometry.
blender -b --python ... -- <key> <width> <revision> <error-metres>
"""
import bpy, sys, os, json, math, random, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

key, width, revision, tolerance = sys.argv[sys.argv.index('--') + 1:]
width, tolerance = float(width), float(tolerance)
root = os.path.abspath('assets/' + key)
out = os.path.join(root, 'work', 'revision-' + revision)
os.makedirs(out, exist_ok=True)
destination = os.path.join(out, 'model.glb')
if os.path.exists(destination):
    raise RuntimeError('Never overwrite a completed revision: ' + destination)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
print('Importing saved source-derived reduction',flush=True)
bpy.ops.import_scene.gltf(filepath=os.path.join(root, 'work/trellis/reduced-res1024-seed42.glb'))
objects = [o for o in bpy.context.scene.objects if o.type == 'MESH']
for o in objects:
    o.select_set(True)
bpy.context.view_layer.objects.active = objects[0]
bpy.ops.object.join()
obj = bpy.context.object
bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
mesh = obj.data
lo = Vector(tuple(min(v[i] for v in obj.bound_box) for i in range(3)))
hi = Vector(tuple(max(v[i] for v in obj.bound_box) for i in range(3)))
scale = width / (hi.x - lo.x)
centre = (lo + hi) * .5
mesh.transform(Matrix.Scale(scale,4) @ Matrix.Translation(Vector((-centre.x,-centre.y,-lo.z))))
# Reconnect the native export's coincident UV-seam vertices before any reduction.
# Loop UVs and face winding survive; otherwise independent edge collapses make cracks.
before_weld=len(mesh.vertices)
bm=bmesh.new();bm.from_mesh(mesh)
bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.00001)
bm.to_mesh(mesh);bm.free();mesh.update()
print('SOURCE SEAM WELD',before_weld,len(mesh.vertices),flush=True)
if key == 'camp-mountain':
    # Fit the reconstructed low hill to the south-east side of the existing camp.
    # Keep every source triangle and its UV; no procedural replacement mesh.
    depth=(hi.y-lo.y)*scale
    height=(hi.z-lo.z)*scale
    mesh.transform(Matrix.Diagonal(Vector((1,190/depth,11/height,1))))
    points=sorted(set((v.co.x,v.co.y) for v in mesh.vertices))
    def cross(a,b,c):return (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0])
    def half(points):
        h=[]
        for p in points:
            while len(h)>=2 and cross(h[-2],h[-1],p)<=0:h.pop()
            h.append(p)
        return h[:-1]
    hull=half(points)+half(list(reversed(points)))
    edge_lines=[]
    for a,b in zip(hull,hull[1:]+hull[:1]):
        dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
        edge_lines.append((a[0],a[1],dx/length,dy/length))
    def ease(a,b,v):
        t=max(0,min(1,(v-a)/(b-a)))
        return t*t*(3-2*t)
    for vertex in mesh.vertices:
        p=vertex.co
        wx,wz=153-p.x,115+p.y
        # Leave the underside below the soil; do not fold it onto the summit.
        if p.z < .3:
            p.z=-.1
            continue
        # The castle's existing deep plinth meets a level earthen summit.
        edge=max(abs(wx-153)-64,abs(wz-115)-55)
        foundation=1-ease(0,24,edge)
        p.z=p.z*(1-foundation)+8.5*foundation
        # A broad western shoulder joins the cave's rear rock to the same hill.
        r=math.hypot(wx-50,wz-99)/40
        shoulder=9*max(0,1-r*r)**2
        p.z=max(p.z,shoulder)
        # Preserve the complete camp clearing and the original river corridor.
        p.z*=ease(19,37,math.hypot(wx-50,wz-50))
        if -64 < wz < 184:
            river=65+math.sin(wz*.065)*3.5
            p.z*=ease(5.3,22,abs(wx-river))
        # Carve only an apron/notch for the separate source-derived cave.
        cave_edge=max(abs(wx-50)-7.5,abs(wz-74)-7.5)
        p.z*=ease(0,3,cave_edge)
        # Fade every fitted shoulder into the original mesh's outer boundary;
        # lifting a boundary vertex directly would create a vertical turf skirt.
        border=min(dx*(p.y-y)-dy*(p.x-x) for x,y,dx,dy in edge_lines)
        p.z*=ease(0,20,border)
        # A broad switchback keeps the ascent gentle across the river-side slope.
        trail=[(61,65,0),(62,86,0),(70,94,.15),(77,101,1.6),(77,122,4.4),(87,128,6.5),(87,113,7.5),(93,113,8.5)]
        nearest=1e9;level=0
        for a,b in zip(trail,trail[1:]):
            dx,dz=b[0]-a[0],b[1]-a[1]
            t=max(0,min(1,((wx-a[0])*dx+(wz-a[1])*dz)/(dx*dx+dz*dz)))
            distance=math.hypot(wx-a[0]-dx*t,wz-a[1]-dz*t)
            if distance<nearest:nearest=distance;level=a[2]+(b[2]-a[2])*t
        weight=1-ease(2.5,8,nearest)
        p.z=p.z*(1-weight)+level*weight
    mesh.normals_split_custom_set([(0,0,0)]*len(mesh.loops))
mesh.update()
dense_triangles = len(mesh.polygons)
dense_bvh = BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
random.seed(42)
samples = [mesh.vertices[i].co.copy() for i in random.sample(range(len(mesh.vertices)),min(8000,len(mesh.vertices)))]
source = mesh
reports = []
selected = source
for ratio in [.5, .25, .125, .0625]:
    obj.data = source.copy()
    dec = obj.modifiers.new('Source-preserving QEM', 'DECIMATE')
    dec.ratio = ratio
    bpy.ops.object.modifier_apply(modifier=dec.name)
    reduced = obj.data
    bvh = BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
    forward = sorted(bvh.find_nearest(v)[3] for v in samples)
    backward = sorted(dense_bvh.find_nearest(reduced.vertices[i].co)[3] for i in random.sample(range(len(reduced.vertices)),min(8000,len(reduced.vertices))))
    p95 = max(forward[int(len(forward)*.95)], backward[int(len(backward)*.95)])
    worst = max(forward[-1], backward[-1])
    passed = p95 <= tolerance and worst <= tolerance * 5
    reports.append(dict(ratio=ratio, triangles=len(reduced.polygons), p95=p95, maximum=worst, passed=passed))
    print('REDUCTION', reports[-1], flush=True)
    if not passed:
        break
    if selected != source:
        bpy.data.meshes.remove(selected)
    selected = reduced
    bvh = None
obj.data = selected
for p in obj.data.polygons:
    p.use_smooth = True
for m in obj.data.materials:
    m.use_backface_culling = True
    if m.use_nodes:
        bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bsdf:
            bsdf.inputs['Metallic'].default_value = 0
            bsdf.inputs['Roughness'].default_value = .93
bpy.ops.export_scene.gltf(filepath=destination, export_format='GLB', use_selection=True, export_animations=False, export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=os.path.join(out, 'source-derived.blend'))
json.dump(dict(key=key, width=width, scale=scale, source_bounds=[list(lo),list(hi)], dense_triangles=dense_triangles, triangles=len(obj.data.polygons), tolerance=tolerance, reductions=reports), open(os.path.join(out, 'process.json'), 'w'), indent=2)
