"""Join a processed body GLB and a processed (grafted) head GLB into one mesh with two materials,
matching the head albedo's skin tone to the body's measured skin colour (per-channel gain).

blender -b --python merge_head.py -- --body body.glb --head head.glb --out merged.glb [--no-tone]
Geometry is unchanged (both parts were placed by rigid similarity transforms). Report: merged.json.
"""
import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np

ap = argparse.ArgumentParser()
ap.add_argument('--body', required=True)
ap.add_argument('--head', required=True)
ap.add_argument('--out', required=True)
ap.add_argument('--no-tone', action='store_true')
ap.add_argument('--gain-max', type=float, default=1.25, help='upper clamp of the per-channel skin-tone gain (lower clamp is its reciprocal-ish 0.8 or 1/gain-max)')
ap.add_argument('--chin-band', default='', help='zlo,zhi: drop body faces in front of the new head throat within this band')
ap.add_argument('--body-islands', default='', help='zmin,maxfaces: drop body face islands (edge-connected) smaller than maxfaces whose centre is above zmin (fragments the neck cut leaves behind)')
ap.add_argument('--hair-band', default='', help='zlo,zhi,lum[,radius][;...]: drop body faces darker than lum (old hair left below the neck cut; lum 1 = all) within this band and radius of the head axis')
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:])

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=args.body)
body = [o for o in bpy.context.scene.objects if o.type == 'MESH'][0]
body.name = 'Body'
before = set(bpy.context.scene.objects)
bpy.ops.import_scene.gltf(filepath=args.head)
head = [o for o in bpy.context.scene.objects if o.type == 'MESH' and o not in before][0]
head.name = 'Head'
for o in (body, head):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)


def albedo_of(obj):
    for n in obj.data.materials[0].node_tree.nodes:
        if n.type == 'TEX_IMAGE' and n.image and n.image.colorspace_settings.name == 'sRGB':
            return n.image


def skin_pixels(obj, zmin, zmax):
    """sRGB albedo samples of skin-like faces (warm, moderately saturated, mid luminance) in a height band."""
    img = albedo_of(obj)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    mesh = obj.data
    uv = mesh.uv_layers.active.data
    out = []
    for poly in mesh.polygons:
        z = poly.center.z
        if not (zmin < z < zmax):
            continue
        u = sum(uv[i].uv[0] for i in poly.loop_indices) / poly.loop_total
        v = sum(uv[i].uv[1] for i in poly.loop_indices) / poly.loop_total
        c = px[min(h - 1, int(v * (h - 1))), min(w - 1, int(u * (w - 1)))]
        r, g, b = c
        if r > g > b and r - b > .12 and .25 < (r + g + b) / 3 < .8 and (r - g) < .25:
            out.append(c)
    return np.array(out), img, px


report = {}
if not args.no_tone:
    H = max(v.co.z for v in body.data.vertices)
    body_skin, _, _ = skin_pixels(body, .35 * H, .82 * H)  # arms, chest V, thighs
    head_skin, head_img, head_px = skin_pixels(head, -1e9, 1e9)  # whole grafted head (face, ears, neck)
    if len(body_skin) > 50 and len(head_skin) > 15:
        gain = np.median(body_skin, 0) / np.median(head_skin, 0)
        gain = np.clip(gain, min(.8, 1 / args.gain_max), args.gain_max)
        full = np.empty(len(head_img.pixels), dtype=np.float32)
        head_img.pixels.foreach_get(full)
        full = full.reshape(-1, 4)
        full[:, :3] = np.clip(full[:, :3] * gain, 0, 1)
        head_img.pixels.foreach_set(full.ravel())
        head_img.update()
        head_img.pack()
        report['tone'] = {'body_skin_median_srgb': np.median(body_skin, 0).round(4).tolist(),
                          'head_skin_median_srgb': np.median(head_skin, 0).round(4).tolist(),
                          'gain': gain.round(4).tolist(), 'samples': [int(len(body_skin)), int(len(head_skin))]}
    else:
        report['tone'] = {'skipped': 'too few skin samples', 'samples': [int(len(body_skin)), int(len(head_skin))]}
if args.chin_band:
    import bmesh
    zlo, zhi = map(float, args.chin_band.split(','))
    hv = np.array([v.co[:] for v in head.data.vertices])
    hz = float(hv[:, 2].min())  # the head's neck starts at its cut plane; measure the throat just above it
    # Long hair can be the lowest part of the head; take the front-most throat point over the 6 cm above the cut.
    throat = hv[(hv[:, 2] < hz + .06) & (np.abs(hv[:, 0] - np.median(hv[:, 0])) < .05)]
    front_y = float(np.percentile(throat[:, 1], 3))
    cx = float(np.median(hv[:, 0]))
    bm = bmesh.new()
    bm.from_mesh(body.data)
    doomed = [f for f in bm.faces if zlo < f.calc_center_median().z < zhi and abs(f.calc_center_median().x - cx) < .1
              and f.calc_center_median().y < front_y - .005]
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    report['chin_band'] = {'z': [zlo, zhi], 'head_throat_front_y': front_y, 'body_faces_removed': len(doomed)}
for band_spec in [b for b in args.hair_band.split(';') if b]:
    import bmesh
    vals = [float(x) for x in band_spec.split(',')]
    zlo, zhi, lum = vals[:3]
    radius = vals[3] if len(vals) > 3 else .16
    hv = np.array([v.co[:] for v in head.data.vertices])
    cx, cy = float(np.median(hv[:, 0])), float(np.median(hv[:, 1]))
    img = albedo_of(body)
    w, h = img.size
    px = np.empty(w * h * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    px = px.reshape(h, w, 4)[:, :, :3]
    bm = bmesh.new()
    bm.from_mesh(body.data)
    uvl = bm.loops.layers.uv.active
    doomed, lums = [], []
    for f in bm.faces:
        c = f.calc_center_median()
        if not (zlo < c.z < zhi) or (c.x - cx) ** 2 + (c.y - cy) ** 2 > radius ** 2:
            continue
        col = np.mean([px[min(h - 1, int(l[uvl].uv[1] * (h - 1))), min(w - 1, int(l[uvl].uv[0] * (w - 1)))] for l in f.loops], 0)
        y = float(col @ np.array([.2126, .7152, .0722]))
        lums.append(y)
        if y < lum:
            doomed.append(f)
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    report.setdefault('hair_band', []).append({'z': [zlo, zhi], 'luminance_below': lum, 'radius': radius, 'faces_in_band': len(lums),
                           'faces_removed': len(doomed),
                           'luminance_percentiles': np.percentile(lums, [5, 25, 50, 75, 95]).round(3).tolist() if lums else []})
if args.body_islands:
    import bmesh
    zmin, maxfaces = args.body_islands.split(',')
    zmin, maxfaces = float(zmin), int(maxfaces)
    bm = bmesh.new()
    bm.from_mesh(body.data)
    bm.faces.ensure_lookup_table()
    # Connectivity by shared vertex position: the body keeps TRELLIS UVs, so its vertices are split along chart
    # seams and edge links alone would cut the surface into UV charts.
    slot, key = {}, {}
    for v in bm.verts:
        key[v.index] = slot.setdefault(tuple(round(c, 5) for c in v.co), len(slot))
    parent = list(range(len(slot)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in bm.faces:
        ids = [key[v.index] for v in f.verts]
        for b in ids[1:]:
            ra, rb = find(ids[0]), find(b)
            if ra != rb:
                parent[rb] = ra
    groups = {}
    for f in bm.faces:
        groups.setdefault(find(key[f.verts[0].index]), []).append(f)
    doomed, islands = [], 0
    for comp in groups.values():
        if len(comp) < maxfaces:
            zc = sum(g.calc_center_median().z for g in comp) / len(comp)
            if zc > zmin:
                doomed += comp
                islands += 1
    bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bm.to_mesh(body.data)
    bm.free()
    report['body_islands'] = {'above_z': zmin, 'max_faces': maxfaces, 'islands_removed': islands, 'faces_removed': len(doomed)}
body.data.materials[0].name = 'BodySurface'
head.data.materials[0].name = 'HeadSurface'
bpy.ops.object.select_all(action='DESELECT')
body.select_set(True)
head.select_set(True)
bpy.context.view_layer.objects.active = body
bpy.ops.object.join()
merged = bpy.context.view_layer.objects.active
merged.name = 'Character'
bpy.ops.export_scene.gltf(filepath=args.out, export_format='GLB', use_selection=True, export_yup=True, export_apply=True,
                          export_animations=False, export_tangents=True, export_image_format='WEBP', export_image_quality=92)
report['triangles'] = sum(len(p.vertices) - 2 for p in merged.data.polygons)
report['materials'] = [m.name for m in merged.data.materials]
Path(args.out).with_suffix('.json').write_text(json.dumps(report, indent=2))
print('MERGE_DONE', json.dumps(report))
