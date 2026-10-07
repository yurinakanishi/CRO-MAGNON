"""Move the prepared flask so its origin is the neck grip (the hand holds the neck).

blender -b --python pivot_flask.py -- <surface revision dir> <out.glb> <grip fraction of height>
Only a translation: vertices, UVs and the baked albedo are unchanged.
"""
import json
import sys
from pathlib import Path

import bpy

d, out, grip = sys.argv[sys.argv.index('--') + 1:][:3]
d = Path(d)
record = json.loads((d / 'surface.json').read_text())
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(d / 'surface.glb'))
obj = next(o for o in bpy.context.scene.objects if o.type == 'MESH')
obj.name = 'HowkeyFlask'
lift = float(grip) * record['heightMetres']
for v in obj.data.vertices:
    v.co.z -= lift
obj.data.update()
bpy.ops.object.select_all(action='DESELECT')
obj.select_set(True)
bpy.context.view_layer.objects.active = obj
bpy.ops.export_scene.gltf(filepath=str(Path(out).resolve()), export_format='GLB', use_selection=True,
                          export_animations=False)
print(json.dumps(dict(out=out, gripMetresAboveBase=lift)))
