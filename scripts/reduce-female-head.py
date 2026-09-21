"""Source-derived QEM only. Runs after TRELLIS; retains the source UV atlas."""
import bpy, bmesh, json, sys
from pathlib import Path
from mathutils.bvhtree import BVHTree
args=sys.argv[sys.argv.index('--')+1:]
source,destination,ratio=Path(args[0]).resolve(),Path(args[1]).resolve(),float(args[2])
assert source.is_file() and not destination.exists()
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
records=[]
for obj in [o for o in bpy.context.scene.objects if o.type=='MESH']:
    bpy.context.view_layer.objects.active=obj
    obj.select_set(True)
    obj.data.transform(obj.matrix_world)
    obj.matrix_world.identity()
    before=len(obj.data.polygons)
    # glTF duplicates vertices at texture seams. Collapse a single connected
    # surface, keeping per-corner UVs; independent islands otherwise pull apart.
    bm=bmesh.new()
    bm.from_mesh(obj.data)
    vertices_before=len(bm.verts)
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6)
    welded=vertices_before-len(bm.verts)
    bm.to_mesh(obj.data)
    bm.free()
    original=[v.co.copy() for v in obj.data.vertices]
    source_bvh=BVHTree.FromPolygons(original,[list(p.vertices) for p in obj.data.polygons],all_triangles=True)
    mod=obj.modifiers.new('Source-preserving head QEM','DECIMATE')
    mod.ratio=ratio
    mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    # Source topology is retained and all surviving winding stays unchanged.
    # Continuous vertex normals are needed for skin; no face-by-face flat shading.
    for p in obj.data.polygons:p.use_smooth=True
    obj.data.update()
    if hasattr(obj.data,'use_auto_smooth'):obj.data.use_auto_smooth=False
    errors=[]
    for v in obj.data.vertices:
        hit=source_bvh.find_nearest(v.co)
        if hit[0] is not None:errors.append(hit[3])
    errors.sort()
    for mat in obj.data.materials:
        if not mat or not mat.use_nodes:continue
        bs=next((n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED'),None)
        if bs:
            bs.inputs['Metallic'].default_value=0
            for link in list(bs.inputs['Metallic'].links):mat.node_tree.links.remove(link)
    records.append({'mesh':obj.name,'before':before,'after':len(obj.data.polygons),'weldedTextureSeamVertices':welded,'sourceDistanceP95':errors[int(len(errors)*.95)],'sourceDistanceMax':max(errors)})
    obj.select_set(False)
destination.parent.mkdir(parents=True,exist_ok=True)
bpy.ops.export_scene.gltf(filepath=str(destination),export_format='GLB',export_animations=False,export_yup=True)
destination.with_suffix('.json').write_text(json.dumps({'source':str(source),'blender':bpy.app.version_string,'ratio':ratio,'records':records},indent=2)+'\n')
print(json.dumps(records))
