"""Re-bake existing 3D UVs with body-colour padding, preserving geometry/rig/LOD."""
import argparse, hashlib, importlib.util, json, shutil, sys
from pathlib import Path
import bpy
import numpy as np

ROOT = next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
p=argparse.ArgumentParser();p.add_argument('colour');p.add_argument('previous');p.add_argument('revision')
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
base=ROOT/f'output/model-generation/models/orb-bot-{a.colour}/work/rig'
old=base/f'revision-{a.previous}';out=base/f'revision-{a.revision}'
assert not out.exists();out.mkdir()
bpy.ops.wm.open_mainfile(filepath=str(old/'source.blend'))
obj=bpy.data.objects['OrbSurface']
coordinates=np.array([v.co[:] for v in obj.data.vertices])
uvs=np.array([loop.uv[:] for loop in obj.data.uv_layers['BotAtlas'].data])
spec=importlib.util.spec_from_file_location('reference_material',Path(__file__).with_name('reference-material.py'))
repair=importlib.util.module_from_spec(spec);spec.loader.exec_module(repair)
material=repair.bake_reference(obj,ROOT/f'assets/orb-bots/source/{a.colour}-reference-v1.png',a.colour,out,keep_existing_uv=True)
assert np.array_equal(coordinates,np.array([v.co[:] for v in obj.data.vertices]))
assert np.array_equal(uvs,np.array([loop.uv[:] for loop in obj.data.uv_layers['BotAtlas'].data]))
bpy.ops.object.select_all(action='SELECT')
options=dict(filepath=str(out/'candidate.glb'),export_format='GLB',export_animations=True,export_yup=True,
    export_animation_mode='ACTIONS',export_frame_range=False,export_force_sampling=True,
    export_anim_single_armature=True,export_skins=True,export_def_bones=False,export_optimize_animation_size=False)
supported=set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
bpy.ops.export_scene.gltf(**{k:v for k,v in options.items() if k in supported})
bpy.ops.wm.save_as_mainfile(filepath=str(out/'source.blend'))
shutil.copyfile(old/'lod.glb',out/'lod.glb')
sha=lambda file:hashlib.sha256(file.read_bytes()).hexdigest()
record=json.loads((old/'rig.json').read_text())
record.update(revision=a.revision,sha256=sha(out/'candidate.glb'),bytes=(out/'candidate.glb').stat().st_size,
              materialRepair=material,paddingRevisionFrom=a.previous,originalUVsExact=True,originalVerticesExact=True)
assert record['lod']['sha256']==sha(out/'lod.glb')
(out/'rig.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(dict(colour=a.colour,revision=a.revision,sha256=record['sha256'],bytes=record['bytes'])),flush=True)
