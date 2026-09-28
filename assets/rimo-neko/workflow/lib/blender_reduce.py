"""Stage 3: silhouette-preserving low-poly conversion of the TRELLIS dense mesh.

Order of operations:
  1. weld the UV-split render vertices back into one manifold surface;
  2. drop floating fragments that are not part of the character;
  3. remove only reconstruction-scale high-frequency speckle with a
     feature-weighted Taubin filter whose cumulative displacement is clamped;
  4. quadric-error collapse decimation to the requested triangle budget;
  5. measure the reduced surface against the untouched dense positions.

No organic form is authored here. Every surviving vertex is a TRELLIS vertex,
optionally moved by less than the recorded displacement clamp.
"""
import json
import sys
from pathlib import Path

import bmesh
import bpy
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree


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


def import_dense(path):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    if not meshes:
        raise SystemExit('no mesh in ' + str(path))
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


def weld(obj, distance=1e-5):
    mesh = obj.data
    before_v = len(mesh.vertices)
    before_f = len(mesh.polygons)
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=distance)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return dict(weld_distance=distance,
                vertices_before=before_v, vertices_after=len(mesh.vertices),
                faces_before=before_f, faces_after=len(mesh.polygons))


def drop_small_components(obj, keep_fraction=0.02):
    """Remove disconnected islands whose face count is a small fraction of the largest."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack = [face]
        seen.add(face.index)
        island = []
        while stack:
            current = stack.pop()
            island.append(current)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        islands.append(island)
    islands.sort(key=len, reverse=True)
    removed = []
    if len(islands) > 1:
        limit = len(islands[0]) * keep_fraction
        doomed = []
        for island in islands[1:]:
            if len(island) < limit:
                doomed.extend(island)
                removed.append(len(island))
        if doomed:
            bmesh.ops.delete(bm, geom=doomed, context='FACES')
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return dict(components=len(islands), largest_faces=len(islands[0]),
                removed_components=len(removed), removed_faces=int(sum(removed)),
                keep_fraction=keep_fraction)


def neighbour_arrays(mesh):
    """Undirected 1-ring adjacency as flat COO arrays."""
    edges = np.empty((len(mesh.edges), 2), dtype=np.int64)
    mesh.edges.foreach_get('vertices', edges.reshape(-1))
    both = np.vstack([edges, edges[:, ::-1]])
    counts = np.bincount(both[:, 0], minlength=len(mesh.vertices))
    return both[:, 0], both[:, 1], counts


def positions_of(mesh):
    P = np.empty((len(mesh.vertices), 3), dtype=np.float64)
    mesh.vertices.foreach_get('co', P.reshape(-1))
    return P


def laplacian(P, src, dst, counts):
    sums = np.zeros_like(P)
    np.add.at(sums, src, P[dst])
    safe = np.maximum(counts, 1)[:, None]
    return sums / safe - P


def mean_edge_length(P, src, dst):
    step = max(1, len(src) // 400000)
    sample = slice(None, None, step)
    return float(np.linalg.norm(P[src[sample]] - P[dst[sample]], axis=1).mean())


def feature_weighted_taubin(obj, iterations, lam, mu, sigma_edges, max_disp_units, height):
    """Remove low-amplitude reconstruction speckle only.

    The per-vertex weight exp(-(|L|/sigma)^2) is near 1 where the 1-ring is
    nearly flat (marching-cubes speckle) and near 0 at fur strands, hem
    serration, folds and creases, so real features keep their TRELLIS positions.
    Cumulative displacement is clamped afterwards, so no vertex can move further
    than the recorded limit.
    """
    mesh = obj.data
    src, dst, counts = neighbour_arrays(mesh)
    P0 = positions_of(mesh)
    edge = mean_edge_length(P0, src, dst)
    sigma = sigma_edges * edge
    max_disp = max_disp_units * height

    L0 = laplacian(P0, src, dst, counts)
    magnitude0 = np.linalg.norm(L0, axis=1)
    quantiles = [float(np.percentile(magnitude0 / edge, q)) for q in (50, 75, 90, 95, 99, 100)]

    P = P0.copy()
    for step in range(iterations * 2):
        L = laplacian(P, src, dst, counts)
        magnitude = np.linalg.norm(L, axis=1)
        weight = np.exp(-(magnitude / sigma) ** 2)
        factor = lam if step % 2 == 0 else mu
        P = P + (factor * weight)[:, None] * L

    delta = P - P0
    distance = np.linalg.norm(delta, axis=1)
    over = distance > max_disp
    if over.any():
        scale = np.ones_like(distance)
        scale[over] = max_disp / distance[over]
        P = P0 + delta * scale[:, None]
        delta = P - P0
        distance = np.linalg.norm(delta, axis=1)

    mesh.vertices.foreach_set('co', P.reshape(-1))
    mesh.update()
    labels = ['p50', 'p75', 'p90', 'p95', 'p99', 'max']
    return dict(
        method='feature-weighted Taubin lambda/mu smoothing with a hard displacement clamp',
        iterations=iterations, lam=lam, mu=mu,
        sigma_edge_lengths=sigma_edges,
        mean_edge_length=edge,
        sigma=sigma,
        clamp_model_height_fraction=max_disp_units,
        clamp_mm_at_1p80m=round(max_disp_units * 1800.0, 4),
        max_displacement_units=float(distance.max()),
        rms_displacement_units=float(np.sqrt((distance ** 2).mean())),
        mean_displacement_units=float(distance.mean()),
        max_displacement_mm_at_1p80m=round(float(distance.max()) / height * 1800.0, 4),
        rms_displacement_mm_at_1p80m=round(
            float(np.sqrt((distance ** 2).mean())) / height * 1800.0, 4),
        clamped_vertices=int(over.sum()),
        laplacian_quantiles_in_edge_lengths=dict(
            (labels[i], round(quantiles[i], 5)) for i in range(len(labels))),
    )


def height_group(obj, name, keep_above=None, keep_below=None):
    """Build a 0/1 collapse mask from a normalised-height band.

    Blender's collapse decimator refuses to collapse an edge that touches a
    zero-weight vertex, and a constant nonzero weight is a monotone scale on the
    quadric cost, so the surviving order inside the unlocked region is the same
    as an unweighted run. That makes region-specific budgets possible without
    distorting the error metric anywhere.
    """
    mesh = obj.data
    P = positions_of(mesh)
    zmin = float(P[:, 2].min())
    height = float(P[:, 2].max()) - zmin
    zn = (P[:, 2] - zmin) / height
    mask = np.ones(len(P), dtype=bool)
    if keep_above is not None:
        mask &= zn >= keep_above
    if keep_below is not None:
        mask &= zn < keep_below
    group = obj.vertex_groups.new(name=name)
    indices = np.nonzero(mask)[0].tolist()
    group.add(indices, 1.0, 'REPLACE')
    return dict(name=name, keep_above=keep_above, keep_below=keep_below,
                collapsible_vertices=int(mask.sum()), total_vertices=int(len(P)))


def region_face_counts(obj, split):
    mesh = obj.data
    P = positions_of(mesh)
    zmin = float(P[:, 2].min())
    height = float(P[:, 2].max()) - zmin
    zn = (P[:, 2] - zmin) / height
    F = face_array(mesh)
    head = (zn[F] >= split).all(axis=1)
    return int(head.sum()), int(len(F) - head.sum())


def head_detail_group(obj, low, high, src, dst, counts, smoothing=3, floor=0.08):
    """Protect the head band from uniform collapse.

    The face is a small share of a full-body surface, so a uniform ratio spends
    too few triangles there. The band is derived from the mesh's own bounding
    box, not from authored geometry, and it only changes how many TRELLIS
    triangles survive.
    """
    mesh = obj.data
    P = positions_of(mesh)
    zmin = float(P[:, 2].min())
    height = float(P[:, 2].max()) - zmin
    zn = (P[:, 2] - zmin) / height
    weight = np.clip((zn - low) / max(high - low, 1e-6), 0.0, 1.0)
    for _ in range(smoothing):
        sums = np.zeros_like(weight)
        np.add.at(sums, src, weight[dst])
        weight = 0.5 * weight + 0.5 * (sums / np.maximum(counts, 1))
    # In Blender's collapse decimator a higher group weight makes an edge
    # cheaper, so it is collapsed earlier; a zero weight makes it uncollapsible.
    # The head therefore gets the low (but nonzero) end of the range and the
    # body the high end, and no vertex is ever locked.
    weight = floor + (1.0 - floor) * (1.0 - weight)
    group = obj.vertex_groups.new(name='Detail')
    for index in range(len(weight)):
        group.add([index], float(weight[index]), 'REPLACE')
    return dict(name='Detail', band_low_height_fraction=low, band_high_height_fraction=high,
                smoothing_passes=smoothing, head_weight=floor, body_weight=1.0,
                vertices_below_half=int((weight < 0.5).sum()),
                vertices_total=int(len(weight)))


def decimate(obj, target_faces, group_name=None, group_factor=0.0, label='Reduce'):
    current = len(obj.data.polygons)
    ratio = min(1.0, target_faces / float(current))
    modifier = obj.modifiers.new(label, 'DECIMATE')
    modifier.decimate_type = 'COLLAPSE'
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    if hasattr(modifier, 'use_symmetry'):
        modifier.use_symmetry = False
    if group_name:
        modifier.vertex_group = group_name
        modifier.vertex_group_factor = group_factor
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=label)
    return dict(method='Blender quadric-error collapse decimation (triangulating)',
                pass_name=label,
                source_faces=current, requested_faces=target_faces,
                ratio=round(ratio, 6), vertex_group=group_name,
                vertex_group_factor=group_factor,
                result_faces=len(obj.data.polygons))


def triangulate(obj):
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return len(mesh.polygons)


def face_array(mesh):
    loops = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get('vertex_index', loops)
    counts = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get('loop_total', counts)
    starts = np.empty(len(mesh.polygons), dtype=np.int64)
    mesh.polygons.foreach_get('loop_start', starts)
    if not np.all(counts == 3):
        raise SystemExit('expected a triangulated mesh')
    return np.stack([loops[starts], loops[starts + 1], loops[starts + 2]], axis=1)


def bvh_from_arrays(P, F):
    vertices = [tuple(p) for p in P.tolist()]
    faces = [tuple(f) for f in F.tolist()]
    return BVHTree.FromPolygons(vertices, faces, all_triangles=True)


def sample_surface(P, F, count, seed):
    rng = np.random.default_rng(seed)
    tri = P[F]
    area = 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
    total = area.sum()
    picks = rng.choice(len(F), size=count, p=area / total)
    u = rng.random(count)
    v = rng.random(count)
    flip = u + v > 1.0
    u[flip] = 1.0 - u[flip]
    v[flip] = 1.0 - v[flip]
    tri = tri[picks]
    return tri[:, 0] + u[:, None] * (tri[:, 1] - tri[:, 0]) + v[:, None] * (tri[:, 2] - tri[:, 0])


def deviation(points, tree, height):
    values = np.empty(len(points), dtype=np.float64)
    for index, point in enumerate(points):
        location, normal, face, distance = tree.find_nearest(Vector(point))
        values[index] = distance if distance is not None else 0.0
    return dict(
        samples=int(len(values)),
        max_units=float(values.max()),
        rms_units=float(np.sqrt((values ** 2).mean())),
        mean_units=float(values.mean()),
        p95_units=float(np.percentile(values, 95)),
        max_mm_at_1p80m=round(float(values.max()) / height * 1800.0, 3),
        rms_mm_at_1p80m=round(float(np.sqrt((values ** 2).mean())) / height * 1800.0, 3),
        p95_mm_at_1p80m=round(float(np.percentile(values, 95)) / height * 1800.0, 3),
    )


def main():
    args = parse_args(argv_after_dashes())
    dense = Path(args['dense']).resolve()
    out = Path(args['out']).resolve()
    report_path = Path(args['report']).resolve()
    target = int(args['faces'])
    iterations = int(args.get('denoise-iterations', 6))
    lam = float(args.get('denoise-lambda', 0.55))
    mu = float(args.get('denoise-mu', -0.56))
    sigma_edges = float(args.get('denoise-sigma-edges', 0.16))
    max_disp_units = float(args.get('max-displacement', 0.0009))
    samples = int(args.get('samples', 20000))
    out.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    obj = import_dense(dense)
    weld_report = weld(obj)
    component_report = drop_small_components(obj)
    triangulate(obj)

    P_start = positions_of(obj.data)
    lo = P_start.min(axis=0)
    hi = P_start.max(axis=0)
    height = float(hi[2] - lo[2])

    P_dense = P_start.copy()
    F_dense = face_array(obj.data)

    if iterations > 0:
        denoise_report = feature_weighted_taubin(
            obj, iterations, lam, mu, sigma_edges, max_disp_units, height)
    else:
        denoise_report = dict(method='none', iterations=0,
                              note='no geometry denoising applied')

    P_denoised = positions_of(obj.data).copy()
    dense_tree = bvh_from_arrays(P_dense, F_dense)
    denoise_probe = deviation(sample_surface(P_denoised, F_dense, samples, 7), dense_tree, height)

    head_faces = int(args.get('head-faces', 0))
    if head_faces > 0:
        head_core = float(args.get('head-core', 0.875))
        body_core = float(args.get('body-core', 0.845))
        head_dense, body_dense = region_face_counts(obj, head_core)
        body_group = height_group(obj, 'BodyCollapsible', keep_below=head_core)
        first = decimate(obj, head_dense + target, body_group['name'], 1.0, 'ReduceBody')
        triangulate(obj)
        head_group = height_group(obj, 'HeadCollapsible', keep_above=body_core)
        second = decimate(obj, target + head_faces, head_group['name'], 1.0, 'ReduceHead')
        decimate_report = dict(
            strategy=('two-pass region-locked quadric collapse: the head keeps its own '
                      'budget because a full-body uniform ratio starves the face'),
            head_core_height_fraction=head_core,
            body_core_height_fraction=body_core,
            dense_head_faces=head_dense, dense_body_faces=body_dense,
            body_target_faces=target, head_target_faces=head_faces,
            passes=[dict(group=body_group, decimate=first),
                    dict(group=head_group, decimate=second)],
            result_faces=len(obj.data.polygons))
    else:
        decimate_report = decimate(obj, target)
    triangulate(obj)
    P_low = positions_of(obj.data)
    F_low = face_array(obj.data)

    low_tree = bvh_from_arrays(P_low, F_low)
    reduced_to_dense = deviation(sample_surface(P_low, F_low, samples, 11), dense_tree, height)
    dense_to_reduced = deviation(sample_surface(P_dense, F_dense, samples, 13), low_tree, height)

    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    obj.data.materials.clear()
    keywords = dict(filepath=str(out), export_format='GLB', use_selection=True,
                    export_materials='NONE', export_normals=True, export_texcoords=False,
                    export_yup=True, export_apply=False, export_animations=False)
    supported = set(bpy.ops.export_scene.gltf.get_rna_type().properties.keys())
    bpy.ops.export_scene.gltf(**dict((k, v) for k, v in keywords.items() if k in supported))

    report = dict(
        dense_source=str(dense),
        output=str(out),
        model_height_units=height,
        bounds_min=[float(v) for v in lo],
        bounds_max=[float(v) for v in hi],
        weld=weld_report,
        components=component_report,
        dense_after_weld=dict(vertices=int(len(P_dense)), triangles=int(len(F_dense))),
        denoise=denoise_report,
        denoise_surface_deviation_from_dense=denoise_probe,
        decimation=decimate_report,
        reduced=dict(vertices=int(len(P_low)), triangles=int(len(F_low))),
        reduced_to_dense_deviation=reduced_to_dense,
        dense_to_reduced_deviation=dense_to_reduced,
    )
    report_path.write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(report, indent=2))
    print('WROTE', out)
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
