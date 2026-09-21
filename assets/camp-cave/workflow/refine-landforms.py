"""Repair the accepted TRELLIS cave and resurface its measured mountain.
No primitive terrain is substituted: every hill sample is a ray projection onto
the retained r11 TRELLIS-derived skin, with hole repair and a low-pass finish.
Blender --background --python this-file -- cave|mountain REVISION
"""
import bpy, bmesh, math, pathlib, sys, json
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

kind, revision = sys.argv[sys.argv.index('--') + 1:]
key = 'camp-' + kind
out = pathlib.Path('assets') / key / 'work' / ('revision-' + revision)
out.mkdir(parents=True, exist_ok=True)
assert not (out / 'model.glb').exists(), 'Keep completed revisions'
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)

def load(path):
    before=set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(pathlib.Path(path).resolve()))
    objects=[o for o in bpy.context.scene.objects if o not in before and o.type=='MESH']
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0]
    bpy.ops.object.join()
    obj=bpy.context.object
    bpy.ops.object.transform_apply(location=True,rotation=True,scale=True)
    return obj

def ease(a,b,x):
    t=np.clip((x-a)/(b-a),0,1)
    return t*t*(3-2*t)

if kind=='cave':
    # r07 contained the accepted continuous TRELLIS shell plus a separate
    # valley-boulder used as a plug.  Keep only the largest connected shell:
    # its own back, side walls and ceiling already meet as one rock surface.
    obj=load('public/models/camp-cave/model-r07.glb')
    mesh=obj.data
    bm=bmesh.new();bm.from_mesh(mesh)
    material_counts={}
    for face in bm.faces:
        material_counts[face.material_index]=material_counts.get(face.material_index,0)+1
    shell_material=max(material_counts,key=material_counts.get)
    plug_faces=[face for face in bm.faces if face.material_index!=shell_material]
    removed_faces=len(plug_faces)
    bmesh.ops.delete(bm,geom=plug_faces,context='FACES')
    loose=[vertex for vertex in bm.verts if not vertex.link_faces]
    if loose:bmesh.ops.delete(bm,geom=loose,context='VERTS')
    bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=.0001)
    bm.to_mesh(mesh);bm.free();mesh.update()
    obj.name='Continuous cave shell'
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.material_slot_remove_unused()

    # Keep the actual rock mouth, not just the leading edge of its open floor.
    # Stretching the apron had pulled the arch 8 m behind the mountain face.
    # Restore the source mouth and blend back into the doubled inner chamber
    # before the gallery begins; the deep half and blind end stay in place.
    entrance_y=min(v.co.y for v in mesh.vertices)
    previous_depth=max(v.co.y for v in mesh.vertices)-entrance_y
    bend_metres=38.0
    for v in mesh.vertices:
        source_y=v.co.y
        stretched_y=entrance_y+(source_y-entrance_y)*2
        mouth_weight=1-float(ease(0,12,stretched_y))
        v.co.y=stretched_y+(source_y-stretched_y)*mouth_weight
        bend=ease(0,previous_depth*2,v.co.y)
        v.co.x+=bend_metres*bend

    # Only the final rock convergence receives another low-pass pass.  The
    # entrance, gallery walls and floor retain their accepted shape and UVs.
    group=obj.vertex_groups.new(name='Natural blind end')
    for v in mesh.vertices:
        weight=float(ease(previous_depth*.72,previous_depth*1.48,v.co.y))
        if weight>0:group.add([v.index],weight,'REPLACE')
    modifier=obj.modifiers.new('Natural blind-end transition','SMOOTH')
    modifier.factor=.16;modifier.iterations=4;modifier.vertex_group=group.name
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    # Open the measured source interior into a full-height gallery. Scale its
    # actual wall relief, retaining the floor and the outer rock envelope.
    # The mouth is untouched; the deformation reaches full strength 8 m in.
    mesh.update();bpy.context.view_layer.update()
    bvh=BVHTree.FromObject(obj,bpy.context.evaluated_depsgraph_get())
    sections=[]
    for depth in np.arange(0,25.01,.25):
        cx=bend_metres*float(ease(0,previous_depth*2,depth))
        origin=Vector((cx,float(depth),3.0))
        floor=bvh.ray_cast(origin,Vector((0,0,-1)))[0]
        ceiling=bvh.ray_cast(origin,Vector((0,0,1)))[0]
        left=bvh.ray_cast(origin,Vector((-1,0,0)))[0]
        right=bvh.ray_cast(origin,Vector((1,0,0)))[0]
        assert all(point is not None for point in [floor,ceiling,left,right])
        sections.append([float(depth),floor.z,ceiling.z,cx-left.x,right.x-cx])
    profile=np.array(sections)
    target_half_width=5.5;target_ceiling=6.6
    def stretch(value,old_edge,new_edge,outer_edge):
        if value<=old_edge:return value*new_edge/old_edge
        if value>=outer_edge:return value
        return new_edge+(value-old_edge)*(outer_edge-new_edge)/(outer_edge-old_edge)
    for vertex in mesh.vertices:
        x,y,z=vertex.co
        weight=float(ease(0,8,y))
        if weight==0:continue
        floor,ceiling,left,right=[float(np.interp(y,profile[:,0],profile[:,i])) for i in range(1,5)]
        cx=bend_metres*float(ease(0,previous_depth*2,y))
        side=left if x<cx else right
        expanded=stretch(abs(x-cx),side,target_half_width,max(9.2,side+.2))
        vertex.co.x=x*(1-weight)+(cx+math.copysign(expanded,x-cx))*weight
        if z>floor:
            raised=floor+stretch(z-floor,ceiling-floor,target_ceiling-floor,9.1-floor)
            vertex.co.z=z*(1-weight)+raised*weight
    mesh.update()

    # Cut the existing rock at a healthy cross-section and continue each of
    # its actual boundary loops. The interior, its thin outer skin and the
    # mountain envelope retain their exact seam vertices. No overlapping liner
    # or separate end boulder can leave a rim in the playable chamber.
    join_y=24.5
    bm=bmesh.new();bm.from_mesh(mesh)
    bmesh.ops.bisect_plane(bm,geom=list(bm.verts)+list(bm.edges)+list(bm.faces),
                          dist=.00001,plane_co=(0,join_y,0),plane_no=(0,1,0),clear_outer=True)
    edges=set(e for e in bm.edges if e.is_boundary and
              all(abs(v.co.y-join_y)<.0001 for v in e.verts))
    remaining=set(edges);boundaries=[]
    while remaining:
        edge=next(iter(remaining))
        # Follow the existing face winding; the adjacent extrusion uses the
        # shared edge in reverse, preserving both inward and outward skins.
        loop=next(loop for loop in edge.link_faces[0].loops if loop.edge==edge)
        first=loop.vert;current=edge.other_vert(first);ring=[first]
        remaining.remove(edge)
        while current!=first:
            ring.append(current)
            following=[e for e in current.link_edges if e in remaining]
            assert len(following)==1, 'The measured section must be one closed boundary'
            edge=following[0];remaining.remove(edge);current=edge.other_vert(current)
        boundaries.append(ring)
    assert len(boundaries)==3, 'Expected the inner wall, its skin and the outer rock envelope'
    boundaries.sort(key=lambda ring:max(v.co.z for v in ring)-min(v.co.z for v in ring))
    uv_layer=bm.loops.layers.uv.verify()
    centre_x=bend_metres*float(ease(0,previous_depth*2,join_y));centre_z=3.825
    boundary_report=[];new_faces=[]
    for boundary_index,base_ring in enumerate(boundaries):
        # Distinct depths retain the small wall thickness at the closed end.
        length=[8.8,8.9,14.1][boundary_index]
        offsets=[(v.co.x-centre_x,v.co.z-centre_z) for v in base_ring]
        if boundary_index<2:
            # Retain full width and headroom until the back of the chamber.
            # Roll only the last 1.2 m into a broad rear wall; the remaining
            # rings fill that wall in a shallow 0.3 m curve, not a long funnel.
            thickness=.1*boundary_index
            shape=[(7.3*i/12,1.0) for i in range(1,13)]
            for i in range(1,13):
                angle=(i/12)*math.pi*.5
                shape.append((7.3+(1.2+thickness)*math.sin(angle),1-.26*(1-math.cos(angle))))
            for i in range(1,13):
                t=i/13
                shape.append((8.5+thickness+.3*math.sin(t*math.pi*.5),.74*(1-t)))
        else:
            shape=[(length*i/40,math.sqrt(math.cos((i/40)*math.pi*.5))) for i in range(1,40)]
        previous_ring=base_ring
        for depth,shrink in shape:
            t=depth/length;y=join_y+depth
            cx=bend_metres*float(ease(0,previous_depth*2,y))
            cz=centre_z
            ring=[]
            for offset_x,offset_z in offsets:
                angle=math.atan2(offset_z,offset_x)
                organic=1+.018*math.sin(angle*5+t*.7)*math.sin(t*math.pi)
                ring.append(bm.verts.new((cx+offset_x*shrink*organic,y,
                                          cz+offset_z*shrink/organic)))
            for segment in range(len(base_ring)):
                next_segment=(segment+1)%len(base_ring)
                new_faces.append(bm.faces.new((previous_ring[segment],ring[segment],
                                                ring[next_segment],previous_ring[next_segment])))
            previous_ring=ring
        tip_y=join_y+length
        tip=bm.verts.new((bend_metres*float(ease(0,previous_depth*2,tip_y)),tip_y,centre_z))
        for segment in range(len(base_ring)):
            next_segment=(segment+1)%len(base_ring)
            new_faces.append(bm.faces.new((previous_ring[segment],tip,previous_ring[next_segment])))
        boundary_report.append({'vertices':len(base_ring),'length':length,'rings':len(shape)+1})
    for face in new_faces:
        face.material_index=0;face.smooth=True
        for loop in face.loops:
            loop[uv_layer].uv=(loop.vert.co.x/13,loop.vert.co.y/19)
    # Every seam edge now belongs to the original rock and its extension.
    assert all(len(edge.link_faces)==2 for edge in edges), 'Open terminal seam'
    bm.to_mesh(mesh);bm.free();mesh.update()
    report={'source':'public/models/camp-cave/model-r07.glb','lengthFromEntranceScale':2,
            'entranceRepair':{'preservedSourceMouth':True,'innerTransitionEnd':12,
                              'method':'retain source arch and apron positions, smoothly join the extended aisle before the gallery'},
            'removedPlugTriangles':removed_faces,'separateEndRock':False,
            'deepBendMetres':bend_metres,
            'gallery':{'width':target_half_width*2,'ceiling':target_ceiling,
                       'measuredSourceSections':sections,'fullSectionToDepth':31.8},
            'naturalEnd':{'join':join_y,'boundaries':boundary_report,'openSeamEdges':0,
                          'method':'full source cross-section to the back chamber, short rounded corners and a broad shallow rear wall; outer skin independently closed'},
            'finish':'retained TRELLIS-derived rock relief, full-height gallery and rounded back-wall joins; accepted entrance, floor and UVs retained'}

else:
    source=load('public/models/camp-mountain/model-r11.glb')
    bvh=BVHTree.FromObject(source,bpy.context.evaluated_depsgraph_get())
    step=.8
    xs=np.arange(-140,140+step/2,step);ys=np.arange(-140,140+step/2,step)
    h=np.zeros((len(ys),len(xs)));valid=np.zeros_like(h)
    for j,y in enumerate(ys):
        for i,x in enumerate(xs):
            hit=bvh.ray_cast(Vector((x,y,70)),Vector((0,0,-1)))[0]
            if hit is not None:h[j,i]=max(0,hit.z);valid[j,i]=1
    def blur(a,r):
        p=np.pad(a,((0,0),(r,r)),mode='edge')
        a=sum(p[:,i:i+a.shape[1]] for i in range(2*r+1))/(2*r+1)
        p=np.pad(a,((r,r),(0,0)),mode='edge')
        return sum(p[i:i+a.shape[0]] for i in range(2*r+1))/(2*r+1)
    # Repair short source holes by normalized neighbours, then smooth relief.
    weights=blur(valid,4)
    fill=blur(h,4)/np.maximum(weights,.0001)
    h=np.where(valid>0,h,fill)
    for _ in range(3):h=blur(h,2)
    X,Y=np.meshgrid(xs,ys);wx=-75-X;wz=175+Y
    edge=np.maximum(abs(wx+70)-58,abs(wz-183)-67)
    foundation=1-ease(0,30,edge);h=h*(1-foundation)+35*foundation
    enclosure=(1-ease(7.5,25,abs(wx-35)))*ease(103,118,wz)*(1-ease(147,174,wz))
    h=np.maximum(h,22*enclosure)
    ledge=(1-ease(8,18,abs(wx-35)))*(1-ease(103,113,wz))*ease(88,100,wz)
    h=h*(1-ledge)+8*ledge
    trail=[(50,62,0),(49,73,.3),(45,84,2.5),(42,95,5),(35,104,8),
           (22,102,10.6),(8,97,13.8),(-10,91,17.8),(-30,87,22),
           (-50,90,26.5),(-68,96,29.6),(-68,116,35),(-68,123,35)]
    nearest=np.full_like(h,1e9);level=np.zeros_like(h)
    for a,b in zip(trail,trail[1:]):
        dx,dz=b[0]-a[0],b[1]-a[1];t=np.clip(((wx-a[0])*dx+(wz-a[1])*dz)/(dx*dx+dz*dz),0,1)
        distance=np.hypot(wx-a[0]-dx*t,wz-a[1]-dz*t)
        take=distance<nearest;level=np.where(take,a[2]+(b[2]-a[2])*t,level);nearest=np.minimum(nearest,distance)
    weight=1-ease(3.5,13,nearest);h=h*(1-weight)+level*weight
    # Do not leave a zero-height sheet over the river or the depressed shore.
    river=65+np.sin(wz*.065)*3.5
    h*=ease(7,20,river-wx)*ease(18,35,np.hypot(wx-50,wz-50))
    # Broad, walkable river-side foothill instead of a tall compressed turf wall.
    cap=np.maximum(0,(river-wx-6)*.72)
    h=np.minimum(h,cap)
    # The source cave has a long open floor apron before its rock arch.
    # Keep that approach below the floor rather than raising a soil ramp
    # through the doorway. The measured roof mask handles the arch itself.
    apron=(1-ease(4.8,10,abs(wx-35)))*ease(103,107,wz)*(1-ease(116,121,wz))
    h=h*(1-apron)+7.95*apron
    coverage=ease(.05,.8,weights)*ease(0,6,np.minimum(140-abs(X),140-abs(Y)))
    h=h*coverage-1.1*(1-ease(.015,.22,h*coverage))
    # Retopology of the source ray field: adjacent cells share the exact vertex.
    vertices=[(float(x),float(y),float(h[j,i])) for j,y in enumerate(ys) for i,x in enumerate(xs)]
    n=len(xs);faces=[]
    for j in range(len(ys)-1):
        for i in range(n-1):
            a=j*n+i;faces.extend([(a,a+1,a+n+1),(a,a+n+1,a+n)])
    mesh=bpy.data.meshes.new('Retopologized source envelope')
    mesh.from_pydata(vertices,[],faces);mesh.update()
    obj=bpy.data.objects.new('Source mountain continuous surface',mesh);bpy.context.collection.objects.link(obj)
    # Use the accepted meadow surface texture for a consistent adjoining soil.
    ground=load('public/models/meadow-ground/model.glb')
    mesh.materials.append(ground.data.materials[0])
    uv=mesh.uv_layers.new(name='Source meadow tiling')
    for face in mesh.polygons:
        for li in face.loop_indices:
            v=mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv=(( -75-v.x)/32,(175+v.y)/32)
    bpy.data.objects.remove(ground,do_unlink=True);bpy.data.objects.remove(source,do_unlink=True)
    report={'source':'public/models/camp-mountain/model-r11.glb','method':'ray-projected source-envelope retopology, normalized hole repair, 3 local smoothing passes',
            'step':step,'textureSource':'public/models/meadow-ground/model.glb','maximum':float(h.max()),'originalSamples':int(valid.sum())}

for polygon in obj.data.polygons:polygon.use_smooth=True
# Preserve original face winding; an open terrain sheet has no unambiguous
# outside for volume-based normal repair. Its measured upward winding is explicit.
obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
bpy.ops.export_scene.gltf(filepath=str((out/'model.glb').resolve()),export_format='GLB',use_selection=True,export_animations=False,export_yup=True)
bpy.ops.wm.save_as_mainfile(filepath=str((out/'source-derived.blend').resolve()))
report['triangles']=sum(len(p.vertices)-2 for p in obj.data.polygons)
(out/'process.json').write_text(json.dumps(report,indent=2))
print(json.dumps(report),flush=True)
