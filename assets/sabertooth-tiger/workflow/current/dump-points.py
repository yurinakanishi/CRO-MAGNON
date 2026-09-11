import sys, numpy as np, bpy
from pathlib import Path
glb, out = sys.argv[sys.argv.index('--')+1:][:2]
bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=glb)
m = [o for o in bpy.context.scene.objects if o.type=='MESH'][0]
P = np.array([m.matrix_world @ v.co for v in m.data.vertices]); np.save(out, P); print('DUMPED', P.shape)
