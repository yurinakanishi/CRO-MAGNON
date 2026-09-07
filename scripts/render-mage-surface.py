"""Reimport exact TRELLIS GLBs for matched neutral/clay seven-view inspection."""
import argparse, hashlib, json, math, sys
from pathlib import Path
import bpy
import numpy as np
from mathutils import Vector

ap=argparse.ArgumentParser()
ap.add_argument('glb');ap.add_argument('out');ap.add_argument('--height',type=float,default=.78)
args=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
source=Path(args.glb).resolve();out=Path(args.out).resolve();out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene=bpy.context.scene;scene.render.fps=30
bpy.ops.import_scene.gltf(filepath=str(source))
meshes=[max((o for o in scene.objects if o.type=='MESH'),key=lambda o:len(o.data.vertices))]
scene.frame_set(1)
bpy.context.view_layer.update()
deps=bpy.context.evaluated_depsgraph_get();points=[]
for obj in meshes:
    evaluated=obj.evaluated_get(deps);mesh=evaluated.to_mesh()
    points.extend(tuple(evaluated.matrix_world@v.co) for v in mesh.vertices)
    evaluated.to_mesh_clear()
points=np.array(points)
lo=points.min(0);hi=points.max(0);factor=args.height/(hi[2]-lo[2]);centre=(lo+hi)/2
# Inspection wrapper only: rigid centering and uniform scale, never written to GLB.
wrapper=bpy.data.objects.new('DiagnosticWrapper',None);scene.collection.objects.link(wrapper)
for obj in list(scene.objects):
    if obj is not wrapper and obj.parent is None:obj.parent=wrapper
wrapper.scale=(factor,)*3;wrapper.location=Vector(-centre*factor)
scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=12;scene.cycles.use_denoising=True
scene.render.threads_mode='FIXED';scene.render.threads=6
scene.render.resolution_x=512;scene.render.resolution_y=512;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX'
world=bpy.data.worlds.new('NeutralWorld');world.use_nodes=True
world.node_tree.nodes['Background'].inputs['Color'].default_value=(.32,.32,.32,1)
world.node_tree.nodes['Background'].inputs['Strength'].default_value=.7;scene.world=world
for name,pos,power in [('Key',(2,-3,4),250),('Fill',(-3,-2,1),120),('Rim',(1,3,3),180)]:
    data=bpy.data.lights.new(name,'AREA');data.energy=power;data.size=3
    obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=pos
    obj.rotation_euler=obj.location.to_track_quat('Z','Y').to_euler()
data=bpy.data.cameras.new('Camera');camera=bpy.data.objects.new('Camera',data);scene.collection.objects.link(camera)
data.type='ORTHO';data.ortho_scale=max(args.height,float(max(hi[0]-lo[0],hi[1]-lo[1])*factor))*1.3;scene.camera=camera
views={'front':(0,-1,0),'rear':(0,1,0),'left':(-1,0,0),'right':(1,0,0),'top':(0,0,1),'bottom':(0,0,-1),'threequarter':(.65,-1,.2)}
clay=bpy.data.materials.new('DiagnosticNeutralClay');clay.use_nodes=True
bsdf=clay.node_tree.nodes['Principled BSDF'];bsdf.inputs['Base Color'].default_value=(.55,.55,.55,1)
bsdf.inputs['Roughness'].default_value=.55;bsdf.inputs['Metallic'].default_value=0
records=[]
for mode in ['neutral','clay']:
    scene.view_layers[0].material_override=clay if mode=='clay' else None
    for name,vector in views.items():
        target=out/f'{mode}-{name}.png';assert not target.exists()
        camera.location=Vector(vector).normalized()*3
        camera.rotation_euler=camera.location.to_track_quat('Z','Y').to_euler()
        scene.render.filepath=str(target);bpy.ops.render.render(write_still=True)
        records.append({'mode':mode,'view':name,'image':target.name})
report={'source':str(source),'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'render':'exact GLB reimport; diagnostic uniform centering only','fpsSetBeforeImport':30,'views':records,'orthoScale':data.ortho_scale,'nativeBoundsBlender':{'min':lo.tolist(),'max':hi.tolist()}}
(out/'manifest.json').write_text(json.dumps(report,indent=2)+'\n')

