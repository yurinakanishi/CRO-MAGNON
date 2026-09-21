"""Build source-derived medium LODs without changing the adopted close model.

Usage (Blender 5.x):
  blender -b --python scripts/build-performance-lods.py -- <source.glb> <output.glb> <ratio>

The collapse modifier keeps UVs, materials, skin indices/weights and the original
armature/animation hierarchy.  Runtime uses only the reduced geometry for actors,
so the adopted materials and animation clips remain authoritative.
"""

import json
import os
import sys

import bpy


args = sys.argv[sys.argv.index("--") + 1 :]
if len(args) != 3:
    raise RuntimeError("Expected <source.glb> <output.glb> <ratio>")

source, destination, ratio_text = args
source = os.path.abspath(source)
destination = os.path.abspath(destination)
ratio = float(ratio_text)
if not os.path.isfile(source):
    raise RuntimeError("Missing source GLB: " + source)
if os.path.exists(destination):
    raise RuntimeError("Refusing to overwrite completed LOD: " + destination)
if not 0.02 <= ratio <= 0.5:
    raise RuntimeError("LOD ratio must be between 0.02 and 0.5")

bpy.ops.object.select_all(action="SELECT")
bpy.ops.object.delete(use_global=False)
bpy.ops.import_scene.gltf(filepath=source)

meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
if not meshes:
    raise RuntimeError("Imported GLB has no meshes")
actor_geometry_only = any(obj.type == "ARMATURE" for obj in bpy.context.scene.objects)

before = sum(len(obj.data.polygons) for obj in meshes)
records = []
for obj in meshes:
    original = len(obj.data.polygons)
    if original < 24:
        records.append({"object": obj.name, "before": original, "after": original})
        continue
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    modifier = obj.modifiers.new("PerformanceMediumLOD", "DECIMATE")
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    # Skinning must run after reduction.  Moving the modifier to the top avoids
    # baking an arbitrary animation pose into the exported LOD.
    while obj.modifiers.find(modifier.name) > 0:
        bpy.ops.object.modifier_move_up(modifier=modifier.name)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.update()
    records.append({"object": obj.name, "before": original, "after": len(obj.data.polygons)})
    obj.select_set(False)

# Actor LODs are never rendered with their exported materials: the runtime
# swaps this geometry onto the adopted SkinnedMesh and therefore uses its exact
# material/texture objects. Keep material slot boundaries for primitive groups,
# but do not duplicate multi-megabyte embedded textures that would be decoded
# and immediately discarded.
if actor_geometry_only:
    replacements = {}
    for obj in meshes:
        for slot in obj.material_slots:
            original = slot.material
            key = original.name if original else "Default"
            if key not in replacements:
                material = bpy.data.materials.new("LODGeometrySlot_" + key)
                material.diffuse_color = (0.5, 0.5, 0.5, 1.0)
                material.use_nodes = False
                replacements[key] = material
            slot.material = replacements[key]

after = sum(len(obj.data.polygons) for obj in meshes)
if after >= before or after > before * (ratio + 0.04):
    raise RuntimeError(f"Unexpected reduction: {before} -> {after} at ratio {ratio}")

os.makedirs(os.path.dirname(destination), exist_ok=True)
bpy.ops.object.select_all(action="SELECT")
bpy.ops.export_scene.gltf(
    filepath=destination,
    export_format="GLB",
    use_selection=True,
    # Actor LOD files contribute geometry only. Runtime binds their retained
    # skin attributes to the already-animated adopted skeleton, avoiding a
    # second set of clips and bones in memory.
    export_animations=False,
    export_yup=True,
    export_apply=False,
)

print(
    json.dumps(
        {
            "source": source,
            "destination": destination,
            "ratio": ratio,
            "trianglesBefore": before,
            "trianglesAfter": after,
            "objects": records,
            "animationsExported": False,
            "actorGeometryOnly": actor_geometry_only,
        },
        ensure_ascii=False,
    ),
    flush=True,
)
