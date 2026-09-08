import bpy, bmesh, json, hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[1]
repo=root.parents[3]
source=repo/'public/models/flint-spear/model.glb'
out=root/'work/revision-01';out.mkdir(parents=True,exist_ok=True)
if (out/'candidate.glb').exists(): raise RuntimeError('Preserve existing revision')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes=[o for o in bpy.context.scene.objects if o.type=='MESH']
reports=[]
for o in meshes:
    bpy.context.view_layer.objects.active=o;o.select_set(True)
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    # glTF +Y is Blender +Z. Remove only the old tip and its binding above the bare shaft.
    bm=bmesh.new();bm.from_mesh(o.data)
    before=len(bm.faces)
    cut=bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),dist=.000001,plane_co=(0,0,.90),plane_no=(0,0,1),clear_outer=True,clear_inner=False)
    boundary=[e for e in bm.edges if e.is_boundary and all(abs(v.co.z-.90)<.00002 for v in e.verts)]
    # Bounded closure of the cut end, using the surviving source boundary only.
    fill=bmesh.ops.holes_fill(bm,edges=boundary,sides=0) if boundary else {'faces':[]}
    for face in fill['faces']: face.material_index=0
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    bm.to_mesh(o.data);bm.free();o.data.update()
    reports.append(dict(before=before,after=len(o.data.polygons),cutY=.90,capFaces=len(fill['faces'])))
    o.name='Bare wooden shaft'
bpy.ops.export_scene.gltf(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=False)
(out/'process.json').write_text(json.dumps(dict(candidate=1,revision=1,source=str(source.relative_to(repo)),sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),lineage='Existing imagegen → TRELLIS flint-spear delivered mesh; retain original wood vertices, UV and material; clip above bare shaft and close bounded cut. No new primitive geometry.',meshes=reports),indent=2))
