"""Top-down orthographic strips of the tail clips for review (EEVEE, fast)."""
import sys
from pathlib import Path
import bpy
from mathutils import Vector
ROOT=next(p for p in Path(__file__).resolve().parents if (p/"package.json").is_file() and (p/"shared").is_dir());MODEL=ROOT/'output/model-generation/models/violet-behemoth';sys.path.insert(0,str(MODEL/'workflow/candidate-01'))
import blender_clip_sheet as sheet
args=sys.argv[sys.argv.index('--')+1:];revision=args[0];out=Path(args[1]).resolve();out.mkdir(parents=True,exist_ok=True)
path=MODEL/f'work/rig/revision-{revision}/candidate.glb'
rig,mesh=sheet.setup(path,360,520,{'location':(0,0,12),'target':(0,0,0),'lens':50});scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.fps=30
if hasattr(scene,'eevee'):scene.eevee.taa_render_samples=4
cam=scene.camera;cam.data.type='ORTHO';cam.data.ortho_scale=9.2;cam.location=Vector((0,1.0,14));cam.rotation_euler=(0,0,0)
actions={a.name:a for a in bpy.data.actions}
plan={'TailSpin':[0,6,10,13,16,20,24,28,33,36,40,45],'Charge':[0,8,16,24,32,40,48,56,64,72],'Tremble':[0,5,9,14,18,23,27],'Walk_Loop':[0,5,9,14,18,23,27,32],'Run_Loop':[0,3,6,9,12,15,18,21]}
for name,frames in plan.items():
    sheet.assign_action(rig,actions[name])
    for f in frames:
        scene.frame_set(f);bpy.context.view_layer.update();scene.render.filepath=str(out/f'{name}-{f:02}.png');bpy.ops.render.render(write_still=True)
print('TOPDOWN_DONE')
