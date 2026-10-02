"""QA-only isolation of source components; original dense GLB stays unchanged."""
import sys
from pathlib import Path
import bpy,bmesh
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT/'assets/rimo-neko/workflow/lib'))
import blender_reduce as base
source=ROOT/'output/model-generation/models/orb-bot-triangle/work/trellis/dense-attempt-01-res512-seed0042.glb'
out=source.parents[2]/'qa/source-layers';out.mkdir(parents=True,exist_ok=True)
for name,keep_large in [('without-lenses',True),('lenses-only',False)]:
    obj=base.import_dense(source);base.weld(obj)
    bm=bmesh.new();bm.from_mesh(obj.data);unseen=set(bm.verts);groups=[]
    while unseen:
        stack=[unseen.pop()];group=[]
        while stack:
            v=stack.pop();group.append(v)
            for e in v.link_edges:
                q=e.other_vert(v)
                if q in unseen:unseen.remove(q);stack.append(q)
        groups.append(group)
    groups.sort(key=len,reverse=True)
    remove=[v for i,g in enumerate(groups) for v in g if (i>=2 if keep_large else i<2)]
    bmesh.ops.delete(bm,geom=remove,context='VERTS');bm.to_mesh(obj.data);bm.free()
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    bpy.ops.export_scene.gltf(filepath=str(out/(name+'.glb')),export_format='GLB',use_selection=True,export_animations=False)
