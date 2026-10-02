"""Fixed-scale side/front/three-quarter contact sheets from the exact GLB."""
import argparse,json,math,sys
from pathlib import Path
import bpy
from mathutils import Vector
ap=argparse.ArgumentParser();ap.add_argument('revision');ap.add_argument('--happy', action='store_true');a=ap.parse_args(sys.argv[sys.argv.index('--')+1:])
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/rimo-neko';out=M/f'qa/rig-{a.revision}/motion-frames';out.mkdir(parents=True,exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True);scene=bpy.context.scene;scene.render.fps=60
bpy.ops.import_scene.gltf(filepath=str(M/f'work/rig/revision-{a.revision}/candidate.glb'))
rig=next(o for o in scene.objects if o.type=='ARMATURE')
for tr in rig.animation_data.nla_tracks:tr.mute=True
scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=640;scene.render.resolution_y=480;scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG';scene.view_settings.view_transform='AgX';scene.view_settings.look='AgX - Medium High Contrast'
world=bpy.data.worlds.new('QA world');scene.world=world;world.use_nodes=True
world.node_tree.nodes['Background'].inputs[0].default_value=(.72,.74,.77,1);world.node_tree.nodes['Background'].inputs[1].default_value=.65
centre=Vector((0,.035,.235));size=.9
for name,location,power,scale in [('Key',(-2,-3,4),400,4),('Fill',(3,-1,2),190,3),('Rim',(0,3,4),250,3)]:
    light=bpy.data.objects.new(name,bpy.data.lights.new(name,'AREA'));scene.collection.objects.link(light)
    light.location=centre+Vector(location)*size;light.data.energy=power*size*size;light.data.shape='DISK';light.data.size=scale*size
    light.rotation_euler=(centre-light.location).to_track_quat('-Z','Y').to_euler()
# This plane belongs only to the review scene, never to the delivered cat.
bpy.ops.mesh.primitive_plane_add(size=200,location=(0,0,-.001))
floor=bpy.context.object;floor.name='QA floor (not exported)'
mat=bpy.data.materials.new('QA floor');mat.diffuse_color=(.33,.37,.39,1);floor.data.materials.append(mat)
cam=bpy.data.objects.new('QA camera',bpy.data.cameras.new('QA camera'));scene.collection.objects.link(cam);scene.camera=cam;cam.data.type='ORTHO';cam.data.ortho_scale=size
views={'right':(1,0,.10),'front':(0,-1,.10),'threequarter':(-.8,-1,.24)}
schedule={'Idle_Loop':[0],'Hiss':[0,.22,.8,1.5,2.1],'Run_Loop':[i*.5/8 for i in range(8)]}
if a.happy:
    schedule={'Pet':[1.6], 'Happy':[0,.2,.4,.6,.8,1.0,1.3,1.6], 'Idle_Loop':[0]}
for clip,times in schedule.items():
    action=next(x for x in bpy.data.actions if x.name==clip or x.name.endswith('|'+clip))
    rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
    for i,t in enumerate(times):
        scene.frame_set(int(t*60)+1,subframe=t*60%1);bpy.context.view_layer.update()
        for view,d in views.items():
            cam.location=centre+Vector(d).normalized()*3;cam.rotation_euler=(cam.location-centre).to_track_quat('Z','Y').to_euler()
            scene.render.filepath=str(out/f'{clip}-{view}-{i:02}.png');bpy.ops.render.render(write_still=True)
(out/'schedule.json').write_text(json.dumps(schedule,indent=2)+'\n',encoding='utf8')
print('MOTION_FRAMES_DONE',flush=True)
