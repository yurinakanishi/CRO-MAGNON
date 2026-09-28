"""Editable handoff from the exact final GLB, including all ten actions."""
import hashlib,json,sys
from pathlib import Path
import bpy
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
M=ROOT/'output/model-generation/models/howkey-scientist'
revision=sys.argv[sys.argv.index('--')+1] if '--' in sys.argv else '11'
folder=M/f'work/final/revision-{revision}/howkey-scientist'
source=folder/'model-downed-r01.glb';dest=folder/'source.blend'
assert not dest.exists(),'Retain the existing editable source'
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.context.scene.render.fps=60
bpy.ops.import_scene.gltf(filepath=str(source))
bpy.ops.file.pack_all()
bpy.ops.wm.save_as_mainfile(filepath=str(dest))
(folder/'source-blend.json').write_text(json.dumps(dict(source=source.name,
    sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest(),file=dest.name,
    sha256=hashlib.sha256(dest.read_bytes()).hexdigest(),fps=60,
    actions=[a.name for a in bpy.data.actions],note='Exact delivered GLB reimport; texture images packed. Authoring rig retained separately.'),indent=2)+'\n')
