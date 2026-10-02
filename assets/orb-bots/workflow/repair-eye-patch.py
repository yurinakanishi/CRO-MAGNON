"""Replace only erroneous recessed eye topology with a neighbourhood-derived patch.

The original reconstructed body stays byte-identical outside the cut. The patch
is constrained to the original boundary and interpolates that body's surface;
it is not a sphere or a primitive substitute. Re-baking the reference is required.
"""
from collections import Counter, defaultdict
import bpy
import numpy as np
from mathutils import Vector
from mathutils.geometry import delaunay_2d_cdt


def repair(obj, reference, base):
    original = base.positions_of(obj.data)
    faces = base.face_array(obj.data)
    height = float(np.ptp(original[:, 2]))
    centre = (original.min(0) + original.max(0)) * .5
    p = (original - centre) / height
    image = bpy.data.images.load(str(reference), check_existing=True)
    w, h = image.size
    pixels = np.empty(w*h*4, np.float32)
    image.pixels.foreach_get(pixels)
    pixels = pixels.reshape(h, w, 4)
    yy, xx = np.nonzero(pixels[:, :, 3] > .9)
    bounds = [xx.min(), xx.max(), yy.min(), yy.max()]
    dark = (pixels[:, :, :3].max(2) < .2) & (pixels[:, :, 3] > .9)
    boxes = []
    cut = np.zeros(len(p), dtype=bool)
    for left in [True, False]:
        side = np.arange(w)[None, :] < (bounds[0]+bounds[1])*.5
        y, x = np.nonzero(dark & (side if left else ~side))
        box = [(x.min()-bounds[0])/(bounds[1]-bounds[0])-.5,
               (x.max()-bounds[0])/(bounds[1]-bounds[0])-.5,
               (y.min()-bounds[2])/(bounds[3]-bounds[2])-.5,
               (y.max()-bounds[2])/(bounds[3]-bounds[2])-.5]
        boxes.append([float(v) for v in box])
        x0, x1, z0, z1 = box
        cut |= ((p[:, 0] > x0-.055) & (p[:, 0] < x1+.055)
                & (p[:, 2] > z0-.055) & (p[:, 2] < z1+.055) & (p[:, 1] < -.2))
    remove = cut[faces].any(1)
    assert remove.mean() < .18
    # Discard isolated scraps of the mistaken cavity within the repair mask.
    neighbours = defaultdict(set)
    for a, b, c in faces[~remove]:
        neighbours[a].update([b, c]); neighbours[b].update([a, c]); neighbours[c].update([a, b])
    unseen = set(neighbours); components = []
    while unseen:
        pending = [unseen.pop()]; component = []
        while pending:
            vertex = pending.pop(); component.append(vertex)
            fresh = neighbours[vertex] & unseen
            unseen.difference_update(fresh); pending.extend(fresh)
        components.append(component)
    components.sort(key=len, reverse=True)
    print('Remaining source components:', [(len(c), p[c].min(0).tolist(), p[c].max(0).tolist()) for c in components[:8]], flush=True)
    outside = p[components[0]]
    outer_mask = np.zeros(len(p), dtype=bool); outer_mask[components[0]] = True
    interior_triangles = 0
    for component in components[1:]:
        scrap = p[component]
        inside = (scrap.min(0) > outside.min(0)).all() and (scrap.max(0) < outside.max(0)).all()
        assert inside, 'Do not remove any exterior source component'
        selected = np.isin(faces, component).any(1)
        interior_triangles += int((selected & ~remove).sum())
        remove |= selected
    for _ in range(12):
        kept = faces[~remove]
        edge_count = Counter(tuple(sorted((int(a), int(b)))) for f in kept for a, b in zip(f, np.roll(f, -1)))
        removed_edges = {tuple(sorted((int(a), int(b)))) for f in faces[remove] for a, b in zip(f, np.roll(f, -1))}
        boundary = [edge for edge, count in edge_count.items() if count == 1 and edge in removed_edges]
        adjacency = defaultdict(list)
        for a, b in boundary:
            adjacency[a].append(b); adjacency[b].append(a)
        singular = [idx for idx, neighbours in adjacency.items() if len(neighbours) != 2]
        if not singular: break
        # Grow by one original face ring where a raster-like cut touches itself.
        remove |= np.isin(faces, singular).any(1)
    assert remove.sum()-interior_triangles < len(faces)*.18
    assert all(len(v) == 2 for v in adjacency.values()), 'A simple original boundary is required'
    unused = set(adjacency)
    loops = []
    while unused:
        start = min(unused); loop = [start]; prev = None; current = start
        while True:
            following = next(v for v in adjacency[current] if v != prev)
            if following == start: break
            assert following not in loop
            loop.append(following); prev, current = current, following
        unused.difference_update(loop); loops.append(loop)
    print('Eye patch boundaries:', [(len(loop), p[loop].min(0).tolist(), p[loop].max(0).tolist()) for loop in loops], flush=True)
    assert len(loops) == 2, f'Expected exactly two eye defects, got {len(loops)}'
    powers = [(i, degree-i) for degree in range(5) for i in range(degree+1)]
    def design(points):
        return np.column_stack([points[:, 0]**i * points[:, 2]**j for i, j in powers])
    surround = outer_mask & (~cut) & (p[:, 1] < -.22) & (np.abs(p[:, 0]) < .43) & (np.abs(p[:, 2]) < .28)
    matrix, values = design(p[surround]), p[surround, 1]
    coefficients = np.linalg.lstsq(matrix, values, rcond=None)[0]
    for _ in range(3):
        residual = matrix @ coefficients-values
        good = np.abs(residual) < max(.0015, np.quantile(np.abs(residual), .94))
        coefficients = np.linalg.lstsq(matrix[good], values[good], rcond=None)[0]
    vertices = list(original.copy())
    new_faces = [list(map(int, f)) for f in kept]
    patch_counts = []
    for loop in loops:
        boundary_points = p[loop]
        coords = boundary_points[:, [0, 2]]
        # CCW in x/z gives the outward -Y normal of this front surface.
        area = np.sum(coords[:, 0]*np.roll(coords[:, 1], -1)-coords[:, 1]*np.roll(coords[:, 0], -1))
        if area < 0: loop = loop[::-1]; boundary_points = p[loop]; coords = boundary_points[:, [0, 2]]
        lo, hi = coords.min(0), coords.max(0)
        grid = np.array([(x, z) for x in np.arange(lo[0]+.003, hi[0], .006)
                         for z in np.arange(lo[1]+.003, hi[1], .006)])
        inputs = [Vector(v) for v in np.vstack([coords, grid])]
        verts, edges, tris, origins, _, _ = delaunay_2d_cdt(inputs, [], [list(range(len(loop)))], 1, 1e-8, True)
        mapping = []
        residual = boundary_points[:, 1]-design(boundary_points)@coefficients
        for point, ids in zip(verts, origins):
            old = [idx for idx in ids if idx < len(loop)]
            if old:
                assert len(old) == 1
                mapping.append(loop[old[0]])
                continue
            x, z = point
            q = np.array([[x, 0, z]])
            d = np.linalg.norm(coords-np.array([x, z]), axis=1)
            nearest = np.argsort(d)[:4]
            weights = 1/np.maximum(d[nearest], 1e-7)**2
            correction = np.average(residual[nearest], weights=weights)*np.exp(-(d.min()/.016)**2)
            q[0, 1] = (design(q)@coefficients)[0]+correction
            mapping.append(len(vertices)); vertices.append(q[0]*height+centre)
        new_faces.extend([[mapping[v] for v in f] for f in tris])
        patch_counts.append(dict(boundaryVertices=len(loop), triangles=len(tris)))
    # Compact unused cavity vertices while retaining all other positions exactly.
    used = sorted({v for f in new_faces for v in f})
    remap = {old: new for new, old in enumerate(used)}
    mesh = bpy.data.meshes.new('SourceBodyWithLocalEyePatches')
    mesh.from_pydata([vertices[v] for v in used], [], [[remap[v] for v in f] for f in new_faces])
    for material in obj.data.materials: mesh.materials.append(material)
    mesh.update(); obj.data = mesh
    all_edges = Counter(tuple(sorted((int(a), int(b)))) for f in new_faces for a, b in zip(f, f[1:]+f[:1]))
    original_edges = Counter(tuple(sorted((int(a), int(b)))) for f in faces for a, b in zip(f, np.roll(f, -1)))
    assert sum(count != 2 for count in all_edges.values()) <= sum(count != 2 for count in original_edges.values()), 'Do not introduce open or non-manifold edges'
    return dict(method='Constrained local eye topology replacement; depth interpolated from unchanged TRELLIS neighbourhood',
                boxesNormalized=boxes, removedTriangles=int(remove.sum()), originalTriangles=len(faces),
                invisibleInteriorTrianglesRemoved=interior_triangles,
                patches=patch_counts, outsidePositionsExact=True, boundaryPositionsExact=True,
                newNonManifoldEdges=0, fittedPrimitive=False)
