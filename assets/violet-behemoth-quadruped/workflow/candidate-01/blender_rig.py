"""Stage 4: rig, skin, texture, animate and package the reduced TRELLIS mesh.

Blender only adds UVs, a baked atlas, materials, an armature, skin weights,
sockets, hierarchy and transforms to geometry that TRELLIS-2 produced. No organic
form is authored here: every vertex position is a TRELLIS-derived position moved
only by the recorded rigid alignment and uniform metre scale.
"""
import json
import math
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Quaternion, Vector

sys.path.insert(0, str(Path(__file__).resolve().parent))
import skin_weights as sw  # noqa: E402
from align_apply import TARGET_HEIGHT, apply_alignment, load_alignment, positions  # noqa: E402
from clips_data import EAT_HAND, LegSolver, build_clips  # noqa: E402

FPS = 30
H = TARGET_HEIGHT


def argv_after_dashes():
    if '--' not in sys.argv:
        return []
    return sys.argv[sys.argv.index('--') + 1:]


def parse_args(items):
    out = dict()
    key = None
    for item in items:
        if item.startswith('--'):
            key = item[2:]
            out[key] = True
        elif key is not None:
            out[key] = item
            key = None
    return out


def import_mesh(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for obj in meshes:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
    obj.name = 'NeanderthalHunter'
    obj.data.name = 'NeanderthalHunterMesh'
    return obj


def weld_and_shade(obj, distance=1e-5, angle_degrees=44.0):
    """Merge coincident positions, then mark only above-threshold edges sharp."""
    mesh = obj.data
    before = len(mesh.vertices)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    for face in bm.faces:
        face.smooth = True
    threshold = math.radians(angle_degrees)
    sharp = 0
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            if edge.calc_face_angle(0.0) > threshold:
                edge.smooth = False
                sharp += 1
        else:
            edge.smooth = False
            sharp += 1
    boundary = len([e for e in bm.edges if len(e.link_faces) == 1])
    non_manifold = len([e for e in bm.edges if len(e.link_faces) > 2])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return dict(vertices_before=before, vertices_after=len(mesh.vertices),
                faces=len(mesh.polygons), weld_distance=distance,
                shading='angle-limited crease-aware smooth normals',
                crease_angle_degrees=angle_degrees, sharp_edges=sharp,
                boundary_edges=boundary, non_manifold_edges=non_manifold)


def unwrap(obj, angle_degrees=66.0, margin=0.0025):
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    if not obj.data.uv_layers:
        obj.data.uv_layers.new(name='UVMap')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(angle_degrees),
                             island_margin=margin, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    bpy.ops.object.mode_set(mode='OBJECT')
    return dict(method='Smart UV Project', chart_angle_degrees=angle_degrees,
                island_margin=margin)


def bake_dense_albedo(target, dense_path, texture_path, size):
    """Project the dense TRELLIS atlas onto the reduced surface."""
    material = bpy.data.materials.new('NeanderthalHunter_Body')
    material.use_nodes = True
    nodes = material.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.66
    image = bpy.data.images.new('NeanderthalHunter_Albedo', width=size, height=size,
                                alpha=False, float_buffer=False)
    image.generated_color = (0.28, 0.19, 0.12, 1.0)
    image_node = nodes.new('ShaderNodeTexImage')
    image_node.name = 'Baked TRELLIS Albedo'
    image_node.image = image
    image_node.interpolation = 'Linear'
    material.node_tree.links.new(image_node.outputs['Color'], bsdf.inputs['Base Color'])
    nodes.active = image_node
    target.data.materials.clear()
    target.data.materials.append(material)
    for polygon in target.data.polygons:
        polygon.material_index = 0

    bpy.ops.object.select_all(action='DESELECT')
    bpy.ops.import_scene.gltf(filepath=str(dense_path))
    sources = [o for o in bpy.context.selected_objects if o.type == 'MESH']
    if not sources:
        raise RuntimeError('dense TRELLIS GLB imported no mesh source')
    for source in sources:
        source.select_set(True)
    target.select_set(True)
    bpy.context.view_layer.objects.active = target

    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 8
    scene.cycles.use_denoising = False
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.bake.use_selected_to_active = True
    scene.render.bake.use_clear = True
    scene.render.bake.margin = 16
    scene.render.bake.cage_extrusion = 0.004
    scene.render.bake.max_ray_distance = 0.014
    bpy.ops.object.bake(type='DIFFUSE', pass_filter=set(['COLOR']),
                        use_selected_to_active=True,
                        cage_extrusion=0.004, max_ray_distance=0.014)

    texture_path.parent.mkdir(parents=True, exist_ok=True)
    image.filepath_raw = str(texture_path)
    image.file_format = 'PNG'
    image.save()

    bpy.ops.object.select_all(action='DESELECT')
    for source in sources:
        source.select_set(True)
    bpy.ops.object.delete()
    target.select_set(True)
    bpy.context.view_layer.objects.active = target
    return material, image, dict(
        method='selected-to-active diffuse-colour projection from the exact dense TRELLIS mesh',
        dense_source=str(dense_path),
        texture=str(texture_path), size=[size, size],
        cage_extrusion=0.004, max_ray_distance=0.014, bake_margin=16, samples=8)


def linear_to_srgb(value):
    out = np.where(value <= 0.0031308, value * 12.92,
                   1.055 * np.power(np.clip(value, 1e-8, None), 1.0 / 2.4) - 0.055)
    return np.clip(out, 0.0, 1.0)


def box_blur(field, radius):
    out = field.astype(np.float64)
    for _ in range(2):
        padded = np.pad(out, radius, mode='edge')
        accumulator = np.zeros_like(out)
        for dy in range(-radius, radius + 1):
            for dx in range(-radius, radius + 1):
                accumulator += padded[radius + dy:radius + dy + out.shape[0],
                                      radius + dx:radius + dx + out.shape[1]]
        out = accumulator / ((2 * radius + 1) ** 2)
    return out


SURFACE_CLASSES = (
    ('hair_or_dark_leather', 0.62),
    ('brown_hide', 0.72),
    ('skin', 0.55),
    ('fur_or_cloth', 0.86),
)


def build_roughness_map(albedo_image, path, size=1024, blur_radius=2):
    """Classify the baked albedo into skin, hide, hair and fur and write roughness.

    The request asks for skin, hair and hide to read with their own roughness. One
    constant cannot do that, so the class is inferred from the baked source albedo
    and written as a low-frequency roughness image. Base colour is untouched, so
    this changes only the specular response, never geometry or albedo.
    """
    width = albedo_image.size[0]
    pixels = np.asarray(albedo_image.pixels[:], dtype=np.float32).reshape(width, width, 4)
    step = max(1, width // size)
    small = pixels[::step, ::step, :3]
    srgb = linear_to_srgb(small)
    luminance = 0.2126 * srgb[:, :, 0] + 0.7152 * srgb[:, :, 1] + 0.0722 * srgb[:, :, 2]
    saturation = srgb.max(axis=2) - srgb.min(axis=2)

    roughness = np.full(luminance.shape, SURFACE_CLASSES[1][1], dtype=np.float64)
    counts = dict()
    dark = luminance < 0.20
    roughness[dark] = SURFACE_CLASSES[0][1]
    pale = (luminance >= 0.42) & (saturation < 0.155)
    roughness[pale] = SURFACE_CLASSES[3][1]
    skin = (luminance >= 0.42) & (saturation >= 0.155) & (luminance < 0.86)
    roughness[skin] = SURFACE_CLASSES[2][1]
    total = float(luminance.size)
    counts['hair_or_dark_leather'] = round(float(dark.sum()) / total, 5)
    counts['fur_or_cloth'] = round(float(pale.sum()) / total, 5)
    counts['skin'] = round(float(skin.sum()) / total, 5)
    counts['brown_hide'] = round(1.0 - sum(counts.values()), 5)

    roughness = box_blur(roughness, blur_radius)
    rows = int(roughness.shape[0])
    columns = int(roughness.shape[1])
    rgba = np.zeros((rows, columns, 4), dtype=np.float32)
    for channel in range(3):
        rgba[:, :, channel] = roughness
    rgba[:, :, 3] = 1.0
    image = bpy.data.images.new('NeanderthalHunter_Roughness', width=columns,
                                height=rows, alpha=False, float_buffer=False)
    image.colorspace_settings.name = 'Non-Color'
    image.pixels = rgba.reshape(-1).tolist()
    image.filepath_raw = str(path)
    image.file_format = 'PNG'
    image.save()
    return image, dict(
        method='per-texel class inference from the baked source albedo, then a box blur',
        size=[columns, rows], blur_radius=blur_radius,
        classes=dict((name, value) for name, value in SURFACE_CLASSES),
        area_fraction=counts,
        measured_min=round(float(roughness.min()), 4),
        measured_max=round(float(roughness.max()), 4),
        measured_mean=round(float(roughness.mean()), 4))


def attach_roughness(material, image):
    nodes = material.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    node = nodes.new('ShaderNodeTexImage')
    node.name = 'Roughness Map'
    node.image = image
    node.interpolation = 'Linear'
    separate = nodes.new('ShaderNodeSeparateColor')
    material.node_tree.links.new(node.outputs['Color'], separate.inputs['Color'])
    material.node_tree.links.new(separate.outputs['Green'], bsdf.inputs['Roughness'])
    return node


def face_uv_colours(obj, image):
    """Mean baked sRGB colour per face, sampled at the face UV centroid."""
    width = image.size[0]
    pixels = np.asarray(image.pixels[:], dtype=np.float32).reshape(width, width, 4)
    uv_layer = obj.data.uv_layers.active.data
    colours = np.zeros((len(obj.data.polygons), 3), dtype=np.float64)
    for polygon in obj.data.polygons:
        u = 0.0
        v = 0.0
        for loop_index in polygon.loop_indices:
            uv = uv_layer[loop_index].uv
            u += uv[0]
            v += uv[1]
        count = len(polygon.loop_indices)
        u = min(max(u / count, 0.0), 0.9999)
        v = min(max(v / count, 0.0), 0.9999)
        colours[polygon.index] = pixels[int(v * width), int(u * width), :3]
    return linear_to_srgb(colours)


def largest_face_island(obj, selected):
    """Keep only the biggest connected group inside a boolean face selection."""
    mesh = obj.data
    chosen = set(int(i) for i in np.nonzero(selected)[0])
    if not chosen:
        return selected
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    seen = set()
    best = []
    for index in chosen:
        if index in seen:
            continue
        stack = [index]
        seen.add(index)
        island = []
        while stack:
            current = stack.pop()
            island.append(current)
            for edge in bm.faces[current].edges:
                for other in edge.link_faces:
                    if other.index in chosen and other.index not in seen:
                        seen.add(other.index)
                        stack.append(other.index)
        if len(island) > len(best):
            best = island
    bm.free()
    out = np.zeros_like(selected)
    if best:
        out[np.asarray(best, dtype=np.int64)] = True
    return out


def assign_tribe_accent(obj, albedo, roughness_image):
    """Isolate the source-derived pale shoulder cloth as a tintable material."""
    mesh = obj.data
    colours = face_uv_colours(obj, albedo)
    luminance = 0.2126 * colours[:, 0] + 0.7152 * colours[:, 1] + 0.0722 * colours[:, 2]
    saturation = colours.max(axis=1) - colours.min(axis=1)

    centres = np.array([list(p.center) for p in mesh.polygons], dtype=np.float64)
    region = ((centres[:, 2] > 0.700 * H) & (centres[:, 2] < 0.890 * H)
              & (centres[:, 0] > -0.01 * H) & (centres[:, 0] < 0.21 * H)
              & (centres[:, 1] < 0.05 * H))
    pale = (luminance > 0.55) & (saturation < 0.155)
    selected = largest_face_island(obj, region & pale)

    report = dict(
        rule=('largest connected pale low-saturation face island inside the character-left '
              'shoulder band of the baked source albedo'),
        region_height_band_m=[round(0.700 * H, 3), round(0.890 * H, 3)],
        luminance_threshold=0.55, saturation_threshold=0.155,
        candidate_faces=int((region & pale).sum()),
        selected_faces=int(selected.sum()),
        total_faces=int(len(mesh.polygons)))
    if selected.sum() < 40:
        report['result'] = 'not isolated'
        report['limitation'] = ('no reliable pale cloth island was found, so the whole body '
                                'keeps one material and no TribeAccent slot exists')
        return None, report

    accent = bpy.data.materials.new('TribeAccent')
    accent.use_nodes = True
    nodes = accent.node_tree.nodes
    bsdf = nodes.get('Principled BSDF')
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = 0.80
    node = nodes.new('ShaderNodeTexImage')
    node.name = 'Baked TRELLIS Albedo'
    node.image = albedo
    node.interpolation = 'Linear'
    accent.node_tree.links.new(node.outputs['Color'], bsdf.inputs['Base Color'])
    if roughness_image is not None:
        attach_roughness(accent, roughness_image)
    mesh.materials.append(accent)
    slot = len(mesh.materials) - 1
    for index in np.nonzero(selected)[0]:
        mesh.polygons[int(index)].material_index = slot
    mesh.update()
    report['result'] = 'isolated'
    report['material_slot'] = slot
    report['mean_srgb'] = [round(float(v), 4) for v in colours[selected].mean(axis=0)]
    report['tint_note'] = ('multiply the TribeAccent baseColorFactor by the player colour; '
                           'the baked base stays a light desaturated cloth')
    return accent, report


def band_mask(P, z, half=0.022):
    return np.abs(P[:, 2] - z) < half


def torso_depth(P, z, half=0.026, limit=0.115):
    selection = band_mask(P, z, half) & (np.abs(P[:, 0]) < limit)
    if selection.sum() < 8:
        selection = band_mask(P, z, half * 2.0) & (np.abs(P[:, 0]) < limit * 1.4)
    Q = P[selection]
    return float(0.5 * (Q[:, 1].min() + Q[:, 1].max()))


def arm_centre(P, z, sign, half=0.024, thickness=0.135):
    """Centre of the outer limb mass on one side at height z."""
    selection = band_mask(P, z, half) & (sign * P[:, 0] > 0.0)
    Q = P[selection]
    if len(Q) < 8:
        return None
    outer = float((sign * Q[:, 0]).max())
    Q = Q[sign * Q[:, 0] > outer - thickness]
    return (float(0.5 * (Q[:, 0].min() + Q[:, 0].max())),
            float(0.5 * (Q[:, 1].min() + Q[:, 1].max())), float(z))


def leg_centre(P, z, sign, half=0.026):
    selection = (band_mask(P, z, half) & (sign * P[:, 0] > 0.015)
                 & (np.abs(P[:, 0]) < 0.175 * H))
    Q = P[selection]
    if len(Q) < 8:
        return None
    return (float(0.5 * (Q[:, 0].min() + Q[:, 0].max())),
            float(0.5 * (Q[:, 1].min() + Q[:, 1].max())), float(z))


def foot_axis(P, sign):
    """Long axis of one sole, so a splayed boot still gets a straight foot chain."""
    selection = (sign * P[:, 0] > 0.0) & (P[:, 2] < 0.035 * H)
    Q = P[selection][:, :2]
    centre = Q.mean(axis=0)
    centred = Q - centre
    _, _, vectors = np.linalg.svd(centred, full_matrices=False)
    axis = vectors[0]
    if axis[1] > 0.0:
        axis = -axis
    t = centred @ axis
    toe = centre + axis * float(t.max())
    heel = centre + axis * float(t.min())
    return dict(centre=[float(v) for v in centre], axis=[float(v) for v in axis],
                toe=[float(v) for v in toe], heel=[float(v) for v in heel],
                length=float(t.max() - t.min()),
                splay_degrees=round(math.degrees(math.atan2(abs(float(axis[0])),
                                                            abs(float(axis[1])))), 2))


def face_profile(P, low, high, step=0.004, half=0.0035, limit=0.022, keep=5):
    """Mid-sagittal front surface of the head, height by height.

    The character faces -Y here, so the front of the face is the smallest y. The
    mean of the `keep` front-most samples is used instead of the single minimum so
    one stray reconstruction vertex cannot define the nose.
    """
    rows = []
    z = low
    while z <= high + 1e-9:
        selection = (np.abs(P[:, 2] - z) < half) & (np.abs(P[:, 0]) < limit)
        Q = P[selection]
        if len(Q) >= keep * 2:
            order = np.argsort(Q[:, 1])[:keep]
            rows.append((float(z), float(Q[order, 1].mean())))
        z += step
    return rows


def mouth_landmark(P, neck_z, head_tip_z, drop=0.028):
    """Nose tip and mouth, measured from the face's own front profile.

    The nose is the most protruding mid-sagittal point of the head. The mouth line
    of an adult face sits a little under a third of the way from the nose tip down
    to the chin, which is `drop` metres below the nose at this 1.80 m scale.
    """
    rows = face_profile(P, neck_z + 0.06, head_tip_z + 0.01)
    nose_z, nose_y = min(rows, key=lambda row: row[1])
    mouth_z = nose_z - drop
    near = min(rows, key=lambda row: abs(row[0] - mouth_z))
    return (dict(nose=(0.0, nose_y, nose_z), mouth=(0.0, near[1], near[0])),
            dict(profile_samples=len(rows), nose_drop_to_mouth_m=drop,
                 profile=[[round(z, 4), round(y, 5)] for z, y in rows]))


def build_landmarks(obj):
    """Derive every joint from this mesh, in metres, after alignment."""
    P = positions(obj.data)
    marks = dict()
    spine = (('pelvis', 0.530), ('spine', 0.618), ('chest', 0.726),
             ('neck', 0.842), ('head', 0.884), ('head_tip', 0.980))
    for name, fraction in spine:
        marks[name] = (0.0, torso_depth(P, fraction * H), fraction * H)

    face, face_detail = mouth_landmark(P, marks['neck'][2], marks['head_tip'][2])
    marks.update(face)

    detail = dict(feet=dict(), arm_samples=dict(), leg_samples=dict(),
                  face=face_detail)
    for side, sign in (('L', 1.0), ('R', -1.0)):
        axis = foot_axis(P, sign)
        detail['feet'][side] = axis
        toe = np.array(axis['toe'])
        heel = np.array(axis['heel'])
        span = toe - heel
        ankle_xy = heel + span * 0.30
        ball_xy = heel + span * 0.78
        tip_xy = heel + span * 0.98
        marks['ankle_' + side] = (float(ankle_xy[0]), float(ankle_xy[1]), 0.062 * H)
        marks['foot_' + side] = (float(ball_xy[0]), float(ball_xy[1]), 0.021 * H)
        marks['toe_' + side] = (float(tip_xy[0]), float(tip_xy[1]), 0.017 * H)

        knee = leg_centre(P, 0.285 * H, sign)
        detail['leg_samples'][side] = dict(knee=knee)
        marks['knee_' + side] = knee
        marks['hip_' + side] = (sign * 0.049 * H, marks['pelvis'][1], 0.530 * H)

        shoulder = arm_centre(P, 0.795 * H, sign)
        elbow = arm_centre(P, 0.632 * H, sign)
        wrist = arm_centre(P, 0.522 * H, sign)
        hand = arm_centre(P, 0.462 * H, sign)
        detail['arm_samples'][side] = dict(shoulder=shoulder, elbow=elbow,
                                           wrist=wrist, hand=hand)
        marks['shoulder_' + side] = (shoulder[0] * 0.84, shoulder[1], 0.795 * H)
        marks['shoulder_in_' + side] = (sign * 0.028 * H, marks['chest'][1], 0.812 * H)
        marks['elbow_' + side] = elbow
        marks['wrist_' + side] = wrist
        marks['hand_' + side] = hand
    return marks, detail


def bone_plan(marks):
    plan = []
    plan.append(('Root', (0.0, 0.0, 0.0), (0.0, -0.24, 0.0), None, False))
    plan.append(('Hips', marks['pelvis'], marks['spine'], 'Root', False))
    plan.append(('Spine', marks['spine'], marks['chest'], 'Hips', True))
    plan.append(('Chest', marks['chest'], marks['neck'], 'Spine', True))
    plan.append(('Neck', marks['neck'], marks['head'], 'Chest', True))
    plan.append(('Head', marks['head'], marks['head_tip'], 'Neck', True))
    for side in ('L', 'R'):
        plan.append(('Shoulder.' + side, marks['shoulder_in_' + side],
                     marks['shoulder_' + side], 'Chest', False))
        plan.append(('UpperArm.' + side, marks['shoulder_' + side],
                     marks['elbow_' + side], 'Shoulder.' + side, True))
        plan.append(('LowerArm.' + side, marks['elbow_' + side],
                     marks['wrist_' + side], 'UpperArm.' + side, True))
        plan.append(('Hand.' + side, marks['wrist_' + side],
                     marks['hand_' + side], 'LowerArm.' + side, True))
        plan.append(('UpperLeg.' + side, marks['hip_' + side],
                     marks['knee_' + side], 'Hips', False))
        plan.append(('LowerLeg.' + side, marks['knee_' + side],
                     marks['ankle_' + side], 'UpperLeg.' + side, True))
        plan.append(('Foot.' + side, marks['ankle_' + side],
                     marks['foot_' + side], 'LowerLeg.' + side, True))
        plan.append(('Toe.' + side, marks['foot_' + side],
                     marks['toe_' + side], 'Foot.' + side, True))
    return plan


def build_armature(plan):
    armature_data = bpy.data.armatures.new('HumanoidArmature')
    rig = bpy.data.objects.new('Armature', armature_data)
    bpy.context.scene.collection.objects.link(rig)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.mode_set(mode='EDIT')
    created = dict()
    for name, head, tail, parent, connected in plan:
        bone = armature_data.edit_bones.new(name)
        bone.head = Vector(head)
        bone.tail = Vector(tail)
        if (bone.tail - bone.head).length < 1e-4:
            bone.tail = bone.head + Vector((0.0, 0.0, 0.02))
        if parent:
            bone.parent = created[parent]
            bone.use_connect = bool(connected)
        created[name] = bone
    bpy.ops.object.mode_set(mode='OBJECT')
    return rig


def add_grip_sockets(rig, marks):
    """Non-rendered empties parented to the hand bones, for future prop attachment.

    Axes in the character's rest space: +Y runs from the wrist toward the
    fingertips, so a held haft lies along it; +Z leaves the back of the hand and
    +X completes a right-handed frame.
    """
    report = []
    for side in ('L', 'R'):
        wrist = Vector(marks['wrist_' + side])
        hand = Vector(marks['hand_' + side])
        elbow = Vector(marks['elbow_' + side])
        y_axis = (hand - wrist).normalized()
        reference = (wrist - elbow).normalized()
        z_axis = reference.cross(y_axis)
        if z_axis.length < 1e-4:
            z_axis = Vector((0.0, -1.0, 0.0))
        z_axis.normalize()
        x_axis = y_axis.cross(z_axis).normalized()
        z_axis = x_axis.cross(y_axis).normalized()
        origin = wrist + (hand - wrist) * 0.55

        empty = bpy.data.objects.new('Grip.' + side, None)
        empty.empty_display_type = 'ARROWS'
        empty.empty_display_size = 0.05
        bpy.context.scene.collection.objects.link(empty)
        empty.parent = rig
        empty.parent_type = 'BONE'
        empty.parent_bone = 'Hand.' + side
        bpy.context.view_layer.update()
        empty.matrix_world = Matrix((
            (x_axis.x, y_axis.x, z_axis.x, origin.x),
            (x_axis.y, y_axis.y, z_axis.y, origin.y),
            (x_axis.z, y_axis.z, z_axis.z, origin.z),
            (0.0, 0.0, 0.0, 1.0)))
        bpy.context.view_layer.update()
        translation, rotation, scale = empty.matrix_world.decompose()
        report.append(dict(
            name=empty.name, parent_bone='Hand.' + side, renders=False,
            rest_world_translation=[round(v, 5) for v in translation],
            rest_world_rotation_quaternion_wxyz=[round(v, 6) for v in rotation],
            rest_world_scale=[round(v, 5) for v in scale],
            local_matrix_basis=[[round(v, 6) for v in row] for row in empty.matrix_basis],
            axes=dict(x=[round(v, 5) for v in x_axis],
                      y=[round(v, 5) for v in y_axis],
                      z=[round(v, 5) for v in z_axis]),
            axis_meaning=dict(y='wrist to fingertip grip axis',
                              z='out of the back of the hand',
                              x='right-handed completion'),
            note='Blender Z-up rest space; GLB export maps (x, y, z) to (x, z, -y)'))
    return report


def mesh_triangles(mesh):
    if hasattr(mesh, 'calc_loop_triangles'):
        mesh.calc_loop_triangles()
    F = np.empty((len(mesh.loop_triangles), 3), dtype=np.int64)
    mesh.loop_triangles.foreach_get('vertices', F.reshape(-1))
    return F


def geodesic_bind(mesh_obj, rig, radius, smooth_iterations=10):
    """Parent to the armature with empty groups, then fill in geodesic weights.

    Blender's own ARMATURE_AUTO is deliberately not used: in attempt-03 its
    envelope fallback for the short hand bones reached about 0.3 m through open
    air from the A-pose hands onto the thighs and knees, so arm motion tore
    ribbons of leg skin. skin_weights.solve only propagates along the surface.
    """
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    rig.select_set(True)
    bpy.context.view_layer.objects.active = rig
    bpy.ops.object.parent_set(type='ARMATURE_NAME')
    for group in list(mesh_obj.vertex_groups):
        mesh_obj.vertex_groups.remove(group)

    P = positions(mesh_obj.data)
    F = mesh_triangles(mesh_obj.data)
    segments = [(bone.name, np.asarray(bone.head_local, dtype=np.float64),
                 np.asarray(bone.tail_local, dtype=np.float64))
                for bone in rig.data.bones if bone.name != 'Root']
    names = [name for name, _, _ in segments]
    W, report = sw.solve(P, F, segments, radius=radius,
                         smooth_iterations=smooth_iterations)
    for column, name in enumerate(names):
        group = mesh_obj.vertex_groups.new(name=name)
        weights = W[:, column]
        for index in np.nonzero(weights > 0.0)[0]:
            group.add([int(index)], float(weights[index]), 'REPLACE')
    report['discontinuity'] = sw.weight_discontinuity(P, F, W, names)
    report['bind_parenting'] = 'ARMATURE_NAME (empty groups, no automatic weights)'
    return report


def bone_segments(rig):
    segments = dict()
    for bone in rig.data.bones:
        if bone.name == 'Root':
            continue
        segments[bone.name] = (Vector(bone.head_local), Vector(bone.tail_local))
    return segments


def distance_to_segment(point, a, b):
    ab = b - a
    length = ab.length_squared
    if length < 1e-12:
        return (point - a).length
    t = max(0.0, min(1.0, (point - a).dot(ab) / length))
    return (point - (a + ab * t)).length


def weight_coverage(mesh_obj, rig):
    deform = set(bone.name for bone in rig.data.bones if bone.name != 'Root')
    covered = 0
    for vertex in mesh_obj.data.vertices:
        for group in vertex.groups:
            if mesh_obj.vertex_groups[group.group].name in deform and group.weight > 1e-5:
                covered += 1
                break
    total = len(mesh_obj.data.vertices)
    return covered / total if total else 0.0


def normalise_weights(mesh_obj, rig, max_influences=4):
    """Guarantee every vertex is skinned to at most four deform bones summing to 1."""
    groups = dict((g.name, g) for g in mesh_obj.vertex_groups)
    for bone in rig.data.bones:
        if bone.name not in groups and bone.name != 'Root':
            groups[bone.name] = mesh_obj.vertex_groups.new(name=bone.name)
    segments = bone_segments(rig)
    repaired = 0
    clipped = 0
    histogram = dict()
    for vertex in mesh_obj.data.vertices:
        entries = []
        for group in vertex.groups:
            name = mesh_obj.vertex_groups[group.group].name
            if name in segments and group.weight > 1e-5:
                entries.append([name, float(group.weight)])
        if not entries:
            point = Vector(vertex.co)
            best = min(segments.items(),
                       key=lambda item: distance_to_segment(point, item[1][0], item[1][1]))
            entries = [[best[0], 1.0]]
            repaired += 1
        entries.sort(key=lambda item: -item[1])
        if len(entries) > max_influences:
            entries = entries[:max_influences]
            clipped += 1
        total = sum(weight for _, weight in entries)
        kept = set(entry[0] for entry in entries)
        for name, weight in entries:
            groups[name].add([vertex.index], weight / total, 'REPLACE')
        for group in list(vertex.groups):
            name = mesh_obj.vertex_groups[group.group].name
            if name not in kept:
                mesh_obj.vertex_groups[group.group].remove([vertex.index])
        histogram[len(entries)] = histogram.get(len(entries), 0) + 1
    return dict(vertices=len(mesh_obj.data.vertices), repaired_unweighted=repaired,
                clipped_to_four=clipped, max_influences=max_influences,
                influence_histogram=dict((str(k), v) for k, v in sorted(histogram.items())))


def hand_tips(mesh_obj, marks, quantile=0.97, weight_floor=0.5):
    """Measured fingertip point of each hand, in the armature's rest space.

    The Hand bone tail sits inside the palm, so aiming an action at it would stop
    the visible fingers well short of a target. This takes the vertices the skin
    solver actually gave to Hand.<side> and averages the ones furthest along the
    wrist-to-fingertip axis, which is the part of the mesh a viewer reads as the
    hand reaching something.
    """
    P = positions(mesh_obj.data)
    groups = dict((group.index, group.name) for group in mesh_obj.vertex_groups)
    columns = dict()
    for side in ('L', 'R'):
        columns['Hand.' + side] = np.zeros(len(P), dtype=np.float64)
    for vertex in mesh_obj.data.vertices:
        for entry in vertex.groups:
            name = groups.get(entry.group)
            if name in columns:
                columns[name][vertex.index] = entry.weight

    tips = dict()
    report = dict()
    for side in ('L', 'R'):
        wrist = np.array(marks['wrist_' + side], dtype=np.float64)
        hand = np.array(marks['hand_' + side], dtype=np.float64)
        axis = hand - wrist
        bone_length = float(np.linalg.norm(axis))
        axis = axis / bone_length
        owned = np.nonzero(columns['Hand.' + side] > weight_floor)[0]
        t = (P[owned] - wrist) @ axis
        cut = float(np.quantile(t, quantile))
        chosen = owned[t >= cut]
        tip = P[chosen].mean(axis=0)
        tips[side] = Vector([float(v) for v in tip])
        report[side] = dict(
            hand_vertices=int(len(owned)), tip_vertices=int(len(chosen)),
            tip=[round(float(v), 5) for v in tip],
            hand_bone_length_m=round(bone_length, 5),
            tip_along_bone_m=round(float(np.dot(tip - wrist, axis)), 5),
            reach_beyond_bone_tail_m=round(float(np.dot(tip - wrist, axis)) - bone_length, 5),
            selection='Hand.%s weight > %.2f, furthest %.0f%% along the bone axis'
                      % (side, weight_floor, (1.0 - quantile) * 100.0))
    return tips, report


class ArmIK:
    """Measured inverse kinematics for one arm, evaluated on the real armature.

    clips_data authors world-axis lower/swing/turn angles. Instead of guessing the
    angles that put a hand somewhere, a clip hands this solver a measured target
    point and gets the same kind of angle dictionary back. The Jacobian is sampled
    from the rig itself, so the solution obeys the exact angle convention, bone
    lengths, rest orientations and parent chain that the exported action will use.

    Five parameters (upper-arm lower/swing/turn, forearm swing/lower) chase a
    three-component position, so the surplus freedom is held near an authored hint
    by a small Tikhonov term. That keeps the elbow where the pose was designed to
    put it rather than letting it wander to an equally valid but ugly solution.
    """

    #: (name, lower bound, upper bound) in degrees, in clips_data's semantics.
    #: The bounds are human joint limits for this chain, so a solution that
    #: reaches the target with a dislocated shoulder is simply not available.
    PARAMETERS = (
        ('upper_lower', -80.0, 55.0),
        ('upper_swing', -120.0, 25.0),
        ('upper_turn', -42.0, 42.0),
        ('lower_swing', -142.0, 0.0),
        ('lower_lower', -25.0, 42.0),
    )

    def __init__(self, rig, mesh_obj, marks, hand_pose=None):
        self.rig = rig
        self.tips, self.tip_report = hand_tips(mesh_obj, marks)
        self.hand_pose = dict(hand_pose or dict())
        self.low = np.array([item[1] for item in self.PARAMETERS], dtype=np.float64)
        self.high = np.array([item[2] for item in self.PARAMETERS], dtype=np.float64)
        self.log = []

    def clamp(self, theta):
        return np.minimum(np.maximum(theta, self.low), self.high)

    def arm_pose(self, side, theta, hand_scale=1.0):
        from clips_data import limb
        pose = dict()
        pose['UpperArm.' + side] = limb(side, lower=float(theta[0]),
                                        swing=float(theta[1]), turn=float(theta[2]))
        pose['LowerArm.' + side] = limb(side, lower=float(theta[4]),
                                        swing=float(theta[3]))
        hand = self.hand_pose.get(side)
        if hand is not None:
            pose['Hand.' + side] = dict((axis, value * hand_scale)
                                        for axis, value in hand.items())
        return pose

    def tip_world(self, side, base_pose, theta):
        pose = dict((name, dict(spec)) for name, spec in base_pose.items())
        pose.update(self.arm_pose(side, theta))
        apply_pose(self.rig, pose)
        bpy.context.view_layer.update()
        pose_bone = self.rig.pose.bones['Hand.' + side]
        local = pose_bone.bone.matrix_local.inverted() @ self.tips[side]
        world = self.rig.matrix_world @ (pose_bone.matrix @ local)
        return np.array([world.x, world.y, world.z], dtype=np.float64)

    def jacobian(self, side, base_pose, theta, tip, probe):
        """Finite-difference d(fingertip)/d(angle) in metres per degree."""
        J = np.zeros((3, len(theta)), dtype=np.float64)
        for index in range(len(theta)):
            step = probe if theta[index] + probe <= self.high[index] else -probe
            probed = theta.copy()
            probed[index] = float(np.clip(theta[index] + step,
                                          self.low[index], self.high[index]))
            delta = probed[index] - theta[index]
            if abs(delta) < 1e-9:
                continue
            J[:, index] = (self.tip_world(side, base_pose, probed) - tip) / delta
        return J

    def solve(self, side, target, base_pose, hint, label='', iterations=30,
              tolerance=3e-4, pull=0.03, probe=1.0, max_step=25.0, trials=6):
        """Return the pose dict whose measured fingertip is closest to `target`.

        Levenberg-Marquardt with the damping scaled by the Jacobian's own
        magnitude: the parameters are degrees and the residual is metres, so a
        fixed absolute damping term would freeze the solver at its starting guess.
        """
        target = np.asarray(target, dtype=np.float64)
        hint = self.clamp(np.asarray(hint, dtype=np.float64))
        theta = hint.copy()
        tip = self.tip_world(side, base_pose, theta)
        distance = float(np.linalg.norm(target - tip))
        best = (distance, theta.copy())
        start = distance
        lam = 1e-3
        evaluations = 1
        used = 0
        for _ in range(iterations):
            used += 1
            if distance < tolerance:
                break
            J = self.jacobian(side, base_pose, theta, tip, probe)
            evaluations += len(theta)
            JTJ = J.T @ J
            scale = float(np.max(np.diag(JTJ)))
            if scale <= 1e-14:
                break
            gradient = J.T @ (target - tip) - pull * scale * (theta - hint)
            improved = False
            for _ in range(trials):
                A = JTJ + (lam + pull) * scale * np.eye(len(theta))
                try:
                    move = np.linalg.solve(A, gradient)
                except np.linalg.LinAlgError:
                    break
                candidate = self.clamp(theta + np.clip(move, -max_step, max_step))
                probe_tip = self.tip_world(side, base_pose, candidate)
                evaluations += 1
                probe_distance = float(np.linalg.norm(target - probe_tip))
                if probe_distance < distance:
                    theta, tip, distance = candidate, probe_tip, probe_distance
                    lam = max(lam * 0.4, 1e-6)
                    improved = True
                    break
                lam = min(lam * 4.0, 1e4)
            if distance < best[0]:
                best = (distance, theta.copy())
            if not improved:
                break
        distance, theta = best
        tip = self.tip_world(side, base_pose, theta)
        self.log.append(dict(
            label=label, side=side,
            target=[round(float(v), 5) for v in target],
            solved_fingertip=[round(float(v), 5) for v in tip],
            residual_m=round(distance, 5),
            start_residual_m=round(start, 5),
            angles=dict((self.PARAMETERS[i][0], round(float(theta[i]), 3))
                        for i in range(len(theta))),
            hint=[round(float(v), 2) for v in hint],
            iterations_used=used, rig_evaluations=evaluations))
        return self.arm_pose(side, theta), theta


def world_axis_rotation(pose_bone, pitch=0.0, yaw=0.0, roll=0.0):
    """Compose a bone-local quaternion from world-axis angles given in degrees."""
    basis = pose_bone.bone.matrix_local.to_3x3().inverted()
    result = Quaternion((1.0, 0.0, 0.0), 0.0)
    for axis, angle in ((Vector((1.0, 0.0, 0.0)), pitch),
                        (Vector((0.0, 1.0, 0.0)), roll),
                        (Vector((0.0, 0.0, 1.0)), yaw)):
        if abs(angle) < 1e-9:
            continue
        result = result @ Quaternion((basis @ axis).normalized(), math.radians(angle))
    return result


def apply_pose(rig, pose):
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        spec = pose.get(bone.name)
        if spec is None:
            bone.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
            bone.location = Vector((0.0, 0.0, 0.0))
            continue
        bone.rotation_quaternion = world_axis_rotation(
            bone, spec.get('pitch', 0.0), spec.get('yaw', 0.0), spec.get('roll', 0.0))
        bone.location = Vector(spec.get('loc', (0.0, 0.0, 0.0)))


def action_fcurves(action):
    curves = getattr(action, 'fcurves', None)
    if curves is not None:
        return list(curves)
    found = []
    for layer in getattr(action, 'layers', []):
        for strip in getattr(layer, 'strips', []):
            for channelbag in getattr(strip, 'channelbags', []):
                found.extend(channelbag.fcurves)
    return found


def action_frame_bounds(action, fallback):
    if hasattr(action, 'frame_start') and hasattr(action, 'frame_end'):
        start = float(action.frame_start)
        end = float(action.frame_end)
        if end > start:
            return int(start), int(end)
    return fallback


def set_interpolation(action, mode):
    """Bezier easing for sparse authored keys, linear for per-frame solved cycles."""
    for fcurve in action_fcurves(action):
        for keyframe in fcurve.keyframe_points:
            keyframe.interpolation = mode
            keyframe.easing = 'AUTO'
            if hasattr(keyframe, 'handle_left_type'):
                keyframe.handle_left_type = 'AUTO_CLAMPED'
                keyframe.handle_right_type = 'AUTO_CLAMPED'


def make_action(rig, clip):
    action = bpy.data.actions.new(clip['name'])
    action.use_fake_user = True
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot'):
        slot = action.slots.new(id_type='OBJECT', name=clip['name'])
        rig.animation_data.action_slot = slot

    animated = set()
    for _, pose in clip['poses']:
        animated.update(pose.keys())
    animated = sorted(animated)

    for frame, pose in clip['poses']:
        apply_pose(rig, pose)
        for name in animated:
            bone = rig.pose.bones[name]
            bone.keyframe_insert(data_path='rotation_quaternion', frame=frame)
            bone.keyframe_insert(data_path='location', frame=frame)
    set_interpolation(action, clip.get('interpolation', 'BEZIER'))
    if hasattr(action, 'use_frame_range'):
        action.use_frame_range = True
        action.frame_start = float(clip['poses'][0][0])
        action.frame_end = float(clip['poses'][-1][0])
    rig.animation_data.action = None
    return action, animated


def rest_pose(rig):
    for bone in rig.pose.bones:
        bone.rotation_mode = 'QUATERNION'
        bone.rotation_quaternion = Quaternion((1.0, 0.0, 0.0, 0.0))
        bone.location = Vector((0.0, 0.0, 0.0))


def deformation_probe(rig, mesh_obj, clip_actions, steps=12):
    """Sample every clip and record triangle collapse, ground contact and drift."""
    def evaluate():
        evaluated = mesh_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
        mesh = evaluated.to_mesh()
        areas = np.array([polygon.area for polygon in mesh.polygons], dtype=np.float64)
        P = np.empty((len(mesh.vertices), 3), dtype=np.float64)
        mesh.vertices.foreach_get('co', P.reshape(-1))
        evaluated.to_mesh_clear()
        return areas, P

    rest_pose(rig)
    bpy.context.view_layer.update()
    base_areas, base_P = evaluate()
    total_base = float(base_areas.sum())
    base_centroid = base_P.mean(axis=0)

    report = []
    for action, animated in clip_actions:
        if rig.animation_data is None:
            rig.animation_data_create()
        rig.animation_data.action = action
        if hasattr(rig.animation_data, 'action_slot') and len(action.slots):
            rig.animation_data.action_slot = action.slots[0]
        start, end = action_frame_bounds(action, (0, 30))
        worst_ratio = 1.0
        worst_frame = start
        total_ratio_min = 1.0
        lowest_z = 0.0
        lowest_frame = start
        travel = 0.0
        for frame in range(start, end + 1, max(1, (end - start) // steps)):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            areas, P = evaluate()
            total_ratio_min = min(total_ratio_min, float(areas.sum()) / total_base)
            ratios = np.divide(areas, base_areas, out=np.ones_like(areas),
                               where=base_areas > 1e-9)
            index = int(ratios.argmin())
            if float(ratios[index]) < worst_ratio:
                worst_ratio = float(ratios[index])
                worst_frame = frame
            z = float(P[:, 2].min())
            if z < lowest_z:
                lowest_z = z
                lowest_frame = frame
            travel = max(travel, float(np.abs(P.mean(axis=0)[:2] - base_centroid[:2]).max()))
        report.append(dict(clip=action.name, animated_bones=len(animated),
                           frames=[start, end],
                           min_face_area_ratio=round(worst_ratio, 5),
                           min_face_area_frame=worst_frame,
                           min_total_area_ratio=round(total_ratio_min, 5),
                           lowest_vertex_z_m=round(lowest_z, 5),
                           lowest_vertex_frame=lowest_frame,
                           max_horizontal_centroid_travel_m=round(travel, 5)))
        rig.animation_data.action = None
    rest_pose(rig)
    bpy.context.view_layer.update()
    return report


def export(path, actions):
    bpy.context.scene.render.fps = FPS
    bpy.ops.object.select_all(action='SELECT')
    keywords = dict(
        filepath=str(path), export_format='GLB', use_selection=False,
        export_materials='EXPORT', export_normals=True, export_texcoords=True,
        export_yup=True, export_apply=False, export_skins=True,
        export_animations=True, export_animation_mode='ACTIONS',
        export_frame_range=False, export_force_sampling=True,
        export_bake_animation=False, export_optimize_animation_size=False,
        export_anim_slide_to_zero=False, export_all_influences=False,
        export_def_bones=False, export_rest_position_armature=True,
        export_influence_nb=4, export_image_format='AUTO')
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    filtered = dict((k, v) for k, v in keywords.items() if k in supported)
    dropped = sorted(set(keywords) - set(filtered))
    bpy.ops.export_scene.gltf(**filtered)
    return dict(exported_actions=[a.name for a in actions], dropped_options=dropped, fps=FPS)


def foot_mask_from_rest(mesh_obj, limit=0.26):
    """Rest-pose vertices belonging to the boots, used for ground contact."""
    return positions(mesh_obj.data)[:, 2] < limit


def hips_world_to_local(rig):
    """Inverse of the map from a Hips local location to its world displacement."""
    rest_pose(rig)
    bpy.context.view_layer.update()
    pose_bone = rig.pose.bones['Hips']
    base = (rig.matrix_world @ pose_bone.matrix).to_translation()
    columns = []
    for axis in range(3):
        vector = [0.0, 0.0, 0.0]
        vector[axis] = 1.0
        pose_bone.location = Vector(vector)
        bpy.context.view_layer.update()
        columns.append((rig.matrix_world @ pose_bone.matrix).to_translation() - base)
    pose_bone.location = Vector((0.0, 0.0, 0.0))
    bpy.context.view_layer.update()
    matrix = Matrix((
        (columns[0].x, columns[1].x, columns[2].x),
        (columns[0].y, columns[1].y, columns[2].y),
        (columns[0].z, columns[1].z, columns[2].z)))
    return matrix.inverted()


def evaluated_positions(mesh_obj):
    evaluated = mesh_obj.evaluated_get(bpy.context.evaluated_depsgraph_get())
    mesh = evaluated.to_mesh()
    P = np.empty((len(mesh.vertices), 3), dtype=np.float64)
    mesh.vertices.foreach_get('co', P.reshape(-1))
    evaluated.to_mesh_clear()
    return P


def solve_ground_deltas(policy, foot_low, all_low, stance, flight_rise, loop,
                        first=True):
    """Per-frame vertical correction that puts the character on z = 0.

    Refinement rounds keep the flight arc that the first round created and only
    check that nothing sank, so the ballistic rise is never added twice.
    """
    count = len(foot_low)
    deltas = [0.0] * count
    if not first:
        flight_rise = 0.0
    if policy == 'nonneg' or (policy == 'stance' and stance is None):
        for index in range(count):
            deltas[index] = max(0.0, -all_low[index])
        return deltas
    if policy != 'stance':
        for index in range(count):
            deltas[index] = max(-foot_low[index], -all_low[index])
        return deltas
    for index in range(count):
        if stance[index]:
            deltas[index] = max(-foot_low[index], -all_low[index])
    if not any(stance):
        for index in range(count):
            deltas[index] = max(0.0, -all_low[index])
        return deltas
    period = count - 1 if loop else count
    for index in range(count):
        if stance[index]:
            continue
        if not first:
            deltas[index] = max(0.0, -all_low[index])
            continue
        before = None
        after = None
        for step in range(1, count + 1):
            probe = (index - step) % period if loop else max(0, index - step)
            if stance[probe]:
                before = (step, deltas[probe])
                break
        for step in range(1, count + 1):
            probe = (index + step) % period if loop else min(count - 1, index + step)
            if stance[probe]:
                after = (step, deltas[probe])
                break
        if before is None or after is None:
            deltas[index] = max(0.0, -all_low[index])
            continue
        span = float(before[0] + after[0])
        t = before[0] / span
        blended = before[1] * (1.0 - t) + after[1] * t
        deltas[index] = max(blended + flight_rise * math.sin(math.pi * t),
                            -all_low[index])
    if loop:
        deltas[count - 1] = deltas[0]
    return deltas


def ground_lock(rig, mesh_obj, action, clip, feet, inverse, rounds=2):
    """Key the Hips height so the character stands on the ground in every frame.

    'plant' keeps the lower boot exactly on z = 0 on every frame. 'stance' does
    that inside each measured stance window and carries a smooth ballistic arc
    across the flight frames, so a run keeps an airborne phase. Both also refuse
    to let any other vertex sink below the ground.
    """
    if rig.animation_data is None:
        rig.animation_data_create()
    rig.animation_data.action = action
    if hasattr(rig.animation_data, 'action_slot') and len(action.slots):
        rig.animation_data.action_slot = action.slots[0]
    start = clip['poses'][0][0]
    end = clip['poses'][-1][0]
    policy = clip.get('contact', 'plant')
    loop = bool(clip.get('loop'))
    pose_bone = rig.pose.bones['Hips']
    stance = None
    if policy == 'stance' and clip.get('gait') is not None:
        windows = clip['gait'].stance_windows(end - start)
        stance = [bool(windows['L'][i] or windows['R'][i])
                  for i in range(end - start + 1)]

    history = []
    applied = [0.0] * (end - start + 1)
    for attempt in range(max(1, rounds)):
        foot_low = []
        all_low = []
        current = []
        for frame in range(start, end + 1):
            bpy.context.scene.frame_set(frame)
            bpy.context.view_layer.update()
            P = evaluated_positions(mesh_obj)
            foot_low.append(float(P[feet][:, 2].min()))
            all_low.append(float(P[:, 2].min()))
            current.append(pose_bone.location.copy())
        deltas = solve_ground_deltas(policy, foot_low, all_low, stance,
                                     float(clip.get('flight_rise', 0.0)), loop,
                                     first=(attempt == 0))
        # Every frame is keyed from the values sampled before any insertion, so
        # inserting a key never feeds back into a later frame's measurement.
        for index, frame in enumerate(range(start, end + 1)):
            pose_bone.location = current[index] + inverse @ Vector(
                (0.0, 0.0, deltas[index]))
            pose_bone.keyframe_insert(data_path='location', frame=frame)
            applied[index] += deltas[index]
        history.append(round(max(abs(v) for v in deltas), 6))
        if history[-1] < 5e-5:
            break

    set_interpolation(action, clip.get('interpolation', 'BEZIER'))
    rig.animation_data.action = None
    return dict(policy=policy, residual_per_round=history,
                stance_frames=int(sum(stance)) if stance else None,
                total_frames=end - start + 1,
                hips_offset_min_m=round(min(applied), 5),
                hips_offset_max_m=round(max(applied), 5),
                loop_endpoints_equal=bool(abs(applied[0] - applied[-1]) < 1e-6) if loop else None)


def main():
    args = parse_args(argv_after_dashes())
    low = Path(args['low'])
    out = Path(args['out'])
    out.parent.mkdir(parents=True, exist_ok=True)

    mesh_obj = import_mesh(low)
    topology = weld_and_shade(mesh_obj, angle_degrees=float(args.get('crease-angle', 44.0)))
    uv_report = unwrap(mesh_obj)
    size = int(args.get('texture-size', 2048))
    material, albedo, texture_report = bake_dense_albedo(
        mesh_obj, Path(args['dense']), Path(args['texture']), size)
    roughness_image, roughness_report = build_roughness_map(albedo, Path(args['roughness']))
    attach_roughness(material, roughness_image)

    alignment = apply_alignment(mesh_obj.data, load_alignment(args['alignment']))
    accent, accent_report = assign_tribe_accent(mesh_obj, albedo, roughness_image)

    marks, marks_detail = build_landmarks(mesh_obj)
    plan = bone_plan(marks)
    rig = build_armature(plan)
    sockets = add_grip_sockets(rig, marks)

    bind_method = 'ARMATURE_NAME parenting plus geodesic surface skinning'
    geodesic = geodesic_bind(mesh_obj, rig, float(args.get('skin-radius', 0.085)),
                             int(args.get('skin-smooth', 10)))
    coverage = weight_coverage(mesh_obj, rig)
    weights = normalise_weights(mesh_obj, rig)
    weights['deform_coverage'] = round(coverage, 5)
    weights['geodesic'] = geodesic
    weights['replaced'] = (
        "Blender ARMATURE_AUTO: its envelope fallback for the short hand bones "
        "reached about 0.3 m through the A-pose air gap and gave attempt-03 thigh "
        "and knee vertices up to 0.44 Hand.L/Hand.R weight")

    bpy.context.scene.render.fps = FPS
    solvers = dict((side, LegSolver(marks['hip_' + side], marks['knee_' + side],
                                    marks['ankle_' + side])) for side in ('L', 'R'))
    arm_ik = ArmIK(rig, mesh_obj, marks, hand_pose=EAT_HAND)
    clips = build_clips(solvers, arm_ik, marks['mouth'])
    rest_pose(rig)
    bpy.context.view_layer.update()
    feet = foot_mask_from_rest(mesh_obj)
    inverse = hips_world_to_local(rig)
    clip_actions = []
    locks = []
    for clip in clips:
        action, animated = make_action(rig, clip)
        lock = ground_lock(rig, mesh_obj, action, clip, feet, inverse)
        lock['clip'] = clip['name']
        locks.append(lock)
        clip_actions.append((action, animated))
    probe = deformation_probe(rig, mesh_obj, clip_actions)
    export_report = export(out, [a for a, _ in clip_actions])

    P = positions(mesh_obj.data)
    landmarks = dict()
    for key, value in marks.items():
        landmarks[key] = [round(float(c), 5) for c in value]
    report = dict(
        source_low_poly=str(low),
        output=str(out),
        fps=FPS,
        topology=topology,
        uv=uv_report,
        alignment=alignment,
        rest_bounds=dict(min=[round(float(v), 5) for v in P.min(axis=0)],
                         max=[round(float(v), 5) for v in P.max(axis=0)],
                         height_m=round(float(P[:, 2].max() - P[:, 2].min()), 5)),
        materials=dict(
            slots=[m.name for m in mesh_obj.data.materials],
            body=dict(name='NeanderthalHunter_Body', metallic=0.0,
                      roughness_default=0.66, base_color_texture=True,
                      roughness_texture=True),
            tribe_accent=accent_report,
            albedo_bake=texture_report,
            roughness_map=roughness_report),
        landmarks=landmarks,
        landmark_measurements=marks_detail,
        armature=dict(bones=[name for name, _, _, _, _ in plan], bone_count=len(plan),
                      bind_method=bind_method, weights=weights, sockets=sockets),
        clips=[dict(name=clip['name'], loop=clip['loop'],
                    frames=clip['poses'][-1][0] - clip['poses'][0][0],
                    duration_seconds=round((clip['poses'][-1][0] - clip['poses'][0][0]) / FPS, 4),
                    keyframes=len(clip['poses']), root_motion='in-place',
                    contact_policy=clip.get('contact'), solver=clip.get('solver'),
                    key_interpolation=clip.get('interpolation', 'BEZIER'),
                    gait=(dict(duty_factor=clip['gait'].duty,
                               half_step_m=clip['gait'].half_step,
                               stride_m=round(clip['gait'].stride(), 4),
                               speed_m_per_s=round(
                                   clip['gait'].stride()
                                   / ((clip['poses'][-1][0] - clip['poses'][0][0]) / FPS), 4),
                               mid_stance_reach_m=round(clip['gait'].reach_mid, 5),
                               reach_gain_m=round(clip['gait'].reach_gain, 5),
                               swing_lift_m=round(clip['gait'].swing_lift, 5))
                          if clip.get('gait') is not None else None))
               for clip in clips],
        leg_solvers=dict((side, dict(thigh_m=round(solvers[side].thigh, 5),
                                     shin_m=round(solvers[side].shin, 5),
                                     rest_reach_m=round(solvers[side].rest_reach, 5),
                                     rest_thigh_angle_deg=round(
                                         math.degrees(solvers[side].alpha_thigh0), 3),
                                     rest_knee_flexion_deg=round(
                                         math.degrees(solvers[side].flex0), 3)))
                         for side in ('L', 'R')),
        arm_ik=dict(
            method=('damped least squares on the real armature: five world-axis arm '
                    'angles chase the measured fingertip onto a measured target, with '
                    'a Tikhonov pull toward an authored elbow hint'),
            parameters=[dict(name=name, min_degrees=low, max_degrees=high)
                        for name, low, high in ArmIK.PARAMETERS],
            fingertip=arm_ik.tip_report,
            hand_attitude=dict((side, dict(spec))
                               for side, spec in EAT_HAND.items()),
            mouth_landmark=[round(float(v), 5) for v in marks['mouth']],
            nose_landmark=[round(float(v), 5) for v in marks['nose']],
            solves=arm_ik.log),
        ground_lock=locks,
        deformation_probe=probe,
        export=export_report)
    Path(args['report']).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print('WROTE', out)
    print('WROTE', args['report'])
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
