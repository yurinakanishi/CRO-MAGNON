"""Reimport the delivery and render all clips against a contact plane."""
import argparse,math,sys,json
from pathlib import Path
import bpy
from mathutils import Vector
p=argparse.ArgumentParser();p.add_argument('source');p.add_argument('output');args=p.parse_args(sys.argv[sys.argv.index('--')+1:])
out=Path(args.output).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(Path(args.source).resolve()))
rig=next(o for o in bpy.context.scene.objects if o.type=='ARMATURE')
actions=list(bpy.data.actions)
scene=bpy.context.scene
fps=scene.render.fps
scene.render.engine='BLENDER_EEVEE';scene.eevee.taa_render_samples=24
scene.eevee.use_gtao=True;scene.eevee.gtao_distance=.16
scene.render.resolution_x=720;scene.render.resolution_y=720;scene.render.resolution_percentage=100
scene.world=bpy.data.worlds.new('ReviewWorld');scene.world.use_nodes=True
scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.82,.85,.88,1)
scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast'
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.002))
floor=bpy.context.object;floor.name='QA floor, not exported'
mat=bpy.data.materials.new('QA floor');mat.diffuse_color=(.58,.64,.66,1);floor.data.materials.append(mat)
for name,position,power in [('Key',(-3,-5,7),650),('Fill',(4,-1,4),350),('Rim',(-2,4,5),500)]:
    light=bpy.data.lights.new(name,'AREA');light.energy=power;light.size=4
    obj=bpy.data.objects.new(name,light);scene.collection.objects.link(obj);obj.location=position
    obj.rotation_euler=(Vector((0,0,.7))-obj.location).to_track_quat('-Z','Y').to_euler()
camera=bpy.data.objects.new('ReviewCamera',bpy.data.cameras.new('ReviewCamera'));scene.collection.objects.link(camera);scene.camera=camera
camera.data.type='ORTHO';camera.data.ortho_scale=2.7
camera.location=(3,-4,2.2);camera.rotation_euler=(Vector((0,-.15,.73))-camera.location).to_track_quat('-Z','Y').to_euler()
records=[]
for action in actions:
    rig.animation_data.action=action
    name=action.name.removesuffix('_MaruimoArmature')
    start,end=action.frame_range
    for i,fraction in enumerate([0,.25,.5,.75,1]):
        frame=start+(end-start)*fraction
        scene.frame_set(math.floor(frame),subframe=frame%1)
        file=out/f'{name}-{i}.png';scene.render.filepath=str(file)
        bpy.ops.render.render(write_still=True)
        records.append(dict(clip=name,fraction=fraction,seconds=float(frame/fps),file=file.name))
(out/'frames.json').write_text(json.dumps(records,indent=2))
cards=''.join(f'<figure><img src="{r["file"]}"><figcaption>{r["clip"]} · {r["fraction"]:.2f}</figcaption></figure>' for r in records)
(out/'index.html').write_text('<!doctype html><meta charset="utf-8"><title>まるぃも 全動作</title><style>body{background:#e2e8e7;font:16px system-ui}.grid{display:grid;grid-template-columns:repeat(5,1fr)}figure{margin:4px}img{width:100%}</style><h1>採用GLBを再読込した13動作</h1><div class="grid">'+cards+'</div>',encoding='utf8')
