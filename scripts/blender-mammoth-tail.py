"""Local structural repair of the TRELLIS mammoth, operated in Blender 5.2.

Run with Blender --background --python this.py -- inspect|build|render.
The original r04 and the rejected r05 are always retained.
"""
import bpy, bmesh, json, math, sys
import numpy as np
from pathlib import Path
from mathutils import Vector
from mathutils.bvhtree import BVHTree
from mathutils.geometry import barycentric_transform

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'output/mammoth-tail/revision-11'
OUT.mkdir(parents=True, exist_ok=True)
mode = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else 'inspect'
source = ROOT / 'public/models/woolly-mammoth/model-motion-r04.glb'
if mode=='render':source=OUT/'model.glb'
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.fps = 30
bpy.ops.import_scene.gltf(filepath=str(source))
obj = next(o for o in scene.objects if o.type == 'MESH')
rig = next(o for o in scene.objects if o.type == 'ARMATURE')
rig.data.pose_position = 'REST'
bpy.context.view_layer.update()

def report():
    points = [obj.matrix_world @ v.co for v in obj.data.vertices]
    data = {'object': obj.name, 'matrix': [list(r) for r in obj.matrix_world],
            'bounds': [[min(p[i] for p in points),max(p[i] for p in points)] for i in range(3)],
            'bones': [{'name': b.name, 'head': list(rig.matrix_world @ b.head_local),
                       'tail': list(rig.matrix_world @ b.tail_local)} for b in rig.data.bones],
            'actions': [{'name': a.name, 'frames': list(a.frame_range)} for a in bpy.data.actions],
            'vertices': [{'id': v.index, 'p': list(p),
                'weights': {obj.vertex_groups[g.group].name:g.weight for g in v.groups}}
                for v,p in zip(obj.data.vertices,points) if p.y>1.95],
            'faces': [list(p.vertices) for p in obj.data.polygons]}
    (OUT/'inspection.json').write_text(json.dumps(data),encoding='utf8')
    print(json.dumps({k:v for k,v in data.items() if k not in ['vertices','faces']}))

def studio():
    if scene.camera:return scene.camera
    scene.render.engine='CYCLES'
    scene.cycles.device='CPU'
    scene.cycles.samples=16
    scene.cycles.use_denoising=True
    scene.render.resolution_x=1000
    scene.render.resolution_y=900
    scene.render.resolution_percentage=100
    scene.world=bpy.data.worlds.new('Neutral studio')
    scene.world.use_nodes=True
    scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.28,.28,.28,1)
    scene.world.node_tree.nodes['Background'].inputs[1].default_value=.65
    scene.view_settings.view_transform='Standard'
    for name,loc,power,size in [('Key',(4,7,8),1800,7),('Fill',(-5,4,5),1100,6),('Front',(0,-6,7),1600,6)]:
        light=bpy.data.lights.new(name,'AREA');light.energy=power;light.shape='DISK';light.size=size
        ob=bpy.data.objects.new(name,light);scene.collection.objects.link(ob);ob.location=loc
        ob.rotation_euler=(Vector((0,0,1.7))-ob.location).to_track_quat('-Z','Y').to_euler()
    camera=bpy.data.cameras.new('Review camera');cam=bpy.data.objects.new('Review camera',camera)
    scene.collection.objects.link(cam);scene.camera=cam;camera.type='ORTHO';camera.ortho_scale=5.6
    return cam

def render_views(prefix):
    cam=studio()
    for name,loc,target,scale in [('rear',(0,10,2.8),(0,1.1,1.8),4.5),
            ('quarter',(6,9,4),(0,.5,1.8),6.3),('side',(10,0,3),(0,0,1.8),6.7),
            ('close',(2.8,8,3.2),(0,2.2,1.6),3.1)]:
        cam.location=loc;cam.rotation_euler=(Vector(target)-cam.location).to_track_quat('-Z','Y').to_euler()
        cam.data.ortho_scale=scale
        scene.render.filepath=str(OUT/f'{prefix}-{name}.png')
        bpy.ops.render.render(write_still=True)

if mode=='inspect':
    report()
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'source-r04.blend'))
    render_views('source')
elif mode=='render':
    render_views('final-rest')
    rig.data.pose_position='POSE'
    for track in rig.animation_data.nla_tracks:track.mute=True
    for name,fraction in [('Idle_Loop',.25),('Graze_Loop',.5),('Walk_Loop',.3),('Run_Loop',.5),('Death',1)]:
        action=next(a for a in bpy.data.actions if a.name==name)
        rig.animation_data.action=action;rig.animation_data.action_slot=action.slots[0]
        scene.frame_set(int(action.frame_range[1]*fraction))
        bpy.context.view_layer.update()
        render_views('final-'+name)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'final-glb.blend'))
elif mode=='build':
    obj.data.calc_loop_triangles()
    old_positions=[v.co.copy() for v in obj.data.vertices]
    old_tris=[list(t.vertices) for t in obj.data.loop_triangles]
    old_uvs=[[obj.data.uv_layers.active.data[i].uv.copy() for i in t.loops] for t in obj.data.loop_triangles]
    tree=BVHTree.FromPolygons(old_positions,old_tris,all_triangles=True)
    # Bake a continuous fur patch from the original textured flank. Sampling
    # the source triangles per texel avoids interpolating across atlas islands.
    original_image=next(n.image for n in obj.data.materials[0].node_tree.nodes if n.type=='TEX_IMAGE')
    width,height=original_image.size
    pixels=np.asarray(original_image.pixels[:],dtype=np.float32).reshape(height,width,4)
    size=512;baked=np.ones((size,size,4),dtype=np.float32)
    for row in range(size):
        for col in range(size):
            origin=Vector((1.5,.55+1.2*col/(size-1),1.65+.95*row/(size-1)))
            loc,normal,i,dist=tree.ray_cast(origin,Vector((-1,0,0)))
            if i is None:loc,normal,i,dist=tree.find_nearest(origin)
            a,b,c=[old_positions[k] for k in old_tris[i]]
            u,v,w=[Vector((p.x,p.y,0)) for p in old_uvs[i]]
            tex=barycentric_transform(loc,a,b,c,u,v,w)
            px=max(0,min(width-2,tex.x*width-.5));py=max(0,min(height-2,tex.y*height-.5))
            ix,iy=int(px),int(py);dx,dy=px-ix,py-iy
            baked[row,col]=(pixels[iy,ix]*(1-dx)+pixels[iy,ix+1]*dx)*(1-dy)+(pixels[iy+1,ix]*(1-dx)+pixels[iy+1,ix+1]*dx)*dy
    fur=bpy.data.images.new('Mammoth repaired rump and tail fur',width=size,height=size)
    fur.pixels.foreach_set(baked.ravel());fur.filepath_raw=str(OUT/'fur-bake.png');fur.file_format='PNG';fur.save();fur.pack()
    material=obj.data.materials[0].copy();material.name='Mammoth repaired fur'
    for node in material.node_tree.nodes:
        if node.type=='TEX_IMAGE':node.image=fur
    obj.data.materials.append(material)
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.remove_doubles(bm,verts=[v for v in bm.verts if v.co.y>1.7 and v.co.z>.5],dist=.00001)
    before_boundary={e for e in bm.edges if e.is_boundary}
    upper_faces=[f for f in bm.faces if all(v.co.z>.5 for v in f.verts)]
    upper_edges={e for f in upper_faces for e in f.edges}
    upper_verts={v for e in upper_edges for v in e.verts}
    bmesh.ops.bisect_plane(bm,geom=list(upper_verts)+list(upper_edges)+upper_faces,
        plane_co=(0,2.25,0),plane_no=(0,1,0),dist=.000001,clear_outer=True,clear_inner=False)
    edges={e for e in bm.edges if e.is_boundary and e not in before_boundary}
    loops=[]
    while edges:
        todo=[edges.pop()];group=[]
        while todo:
            e=todo.pop();group.append(e)
            for v in e.verts:
                for n in v.link_edges:
                    if n in edges:edges.remove(n);todo.append(n)
        loops.append(group)
    print('PATCH LOOPS',[(len(g),[[min(v.co[i] for e in g for v in e.verts),max(v.co[i] for e in g for v in e.verts)] for i in range(3)]) for g in loops],flush=True)
    patched=[];tail_faces=[];tail_verts=[]
    uv=bm.loops.layers.uv.active
    deform=bm.verts.layers.deform.active
    vg={g.name:g.index for g in obj.vertex_groups}
    for v in bm.verts:
        old_tail=sum(v[deform].get(vg[n],0) for n in ['Tail1','Tail2'])
        if old_tail and v.co.y>1.7 and v.co.z>.5:
            for n in ['Tail1','Tail2']:
                if vg[n] in v[deform]:del v[deform][vg[n]]
            v[deform][vg['Hips']]=v[deform].get(vg['Hips'],0)+old_tail
    def weight(v,hips,one,two):
        v[deform].clear()
        for name,w in [('Hips',hips),('Tail1',one),('Tail2',two)]:
            if w>1e-8:v[deform][vg[name]]=w
    # Reuse the cut edge loop of the existing central tail attachment. The
    # successive extrusions replace the fork with one closed, rounded tail.
    root_edges=min(loops,key=lambda g:abs(len(g)-31))
    remaining=set(root_edges);e=min(remaining,key=lambda e:tuple(sum(v.co[i] for v in e.verts) for i in range(3)));remaining.remove(e)
    ring=sorted(e.verts,key=lambda v:tuple(v.co))
    while remaining:
        e=next(e for e in ring[-1].link_edges if e in remaining)
        remaining.remove(e);ring.append(e.other_vert(ring[-1]))
    assert ring[-1]==ring[0];ring.pop()
    if sum((ring[(i+1)%len(ring)].co.x-ring[i].co.x)*
           (ring[(i+1)%len(ring)].co.z+ring[i].co.z) for i in range(len(ring)))<0:ring.reverse()
    center=Vector((0,2.25,2.15))
    for v in ring:
        v.co=center+(v.co-center)*.58;v.co.y=2.17
        weight(v,1,0,0)
    first=math.atan2(ring[0].co.z-center.z,ring[0].co.x)
    angles=[first-math.tau*i/len(ring) for i in range(len(ring))]
    profiles=[(2.32,2.15,.12,0),(2.43,2.17,.10,.4),(2.51,2.09,.09,.85),
        (2.55,1.97,.088,1.1),(2.575,1.82,.078,1.4),(2.59,1.66,.068,1.5),
        (2.60,1.50,.061,1.55),(2.60,1.34,.054,1.60),(2.595,1.18,.049,1.61),
        (2.58,1.02,.046,1.65),(2.56,.90,.051,1.68),(2.54,.80,.080,1.70),
        (2.52,.69,.078,1.72),(2.495,.59,.045,1.75),(2.48,.54,.012,1.76)]
    for step,(y,z,radius,bend) in enumerate(profiles):
        nxt=[]
        for theta in angles:
            tuft=1+.10*math.cos(theta*7) if step>=10 else 1
            r=radius*tuft
            v=bm.verts.new((r*math.cos(theta),y+r*math.sin(theta)*math.sin(bend),z+r*math.sin(theta)*math.cos(bend)))
            t=max(0,min(1,(1.72-z)/.55));h=max(0,1-step/2)
            weight(v,h,(1-h)*(1-t),(1-h)*t)
            nxt.append(v);tail_verts.append(v)
        for i in range(len(ring)):
            f=bm.faces.new((ring[i],ring[(i+1)%len(ring)],nxt[(i+1)%len(ring)],nxt[i]))
            f.smooth=True;f.material_index=1;tail_faces.append(f)
            for l in f.loops:
                # One contiguous fur island from the original TRELLIS atlas.
                column=i if l.vert in (ring[i],nxt[i]) else i+1
                l[uv].uv=(.18+.60*column/len(ring),.03+.94*max(0,min(1,(l.vert.co.z-.5)/1.8)))
        ring=nxt
    tip=bm.faces.new(tuple(reversed(ring)));tip.smooth=True;tip.material_index=1;tail_faces.append(tip)
    for l in tip.loops:l[uv].uv=(.45,.04)
    for g in loops:
        if g is not root_edges:
            patched+=bmesh.ops.holes_fill(bm,edges=g,sides=0)['faces']
    print('FILLED',[(len(f.verts),list(f.calc_center_median())) for f in patched],flush=True)
    rim={v for g in loops for e in g for v in e.verts}
    for v in rim:
        t=max(0,min(1,(2.15-v.co.z)/.7));v.co.y-=.18*t*t*(3-2*t)
    # Give closure patches volume, and keep the old interior layers behind the
    # outer skin. They are cut and capped, never collapsed to zero-area faces.
    expanded=[]
    for face in patched:
        size=len(face.verts)
        result=bmesh.ops.poke(bm,faces=[face],offset=0,center_mode='MEAN_WEIGHTED')
        for v in result['verts']:
            v.co.y+=.06 if size>50 else .01
            weight(v,1,0,0)
        expanded+=result['faces']
    patched=expanded
    for f in patched:
        f.smooth=True;f.material_index=1
        for l in f.loops:
            l[uv].uv=(.03+.94*(l.vert.co.x+.6)/1.2,.03+.94*(l.vert.co.z-1.2)/1.4)
    patch_faces=set(patched)
    # Subdivide and relax the new closures in Blender, preserving their seams.
    patch_edges={e for f in patched for e in f.edges}
    sub=bmesh.ops.subdivide_edges(bm,edges=list(patch_edges),cuts=2,use_grid_fill=True)
    tail_set=set(tail_verts)
    soften=[v for v in bm.verts if v not in tail_set and v.co.y>1.94 and 1.27<v.co.z<2.6]
    for _ in range(12):
        bmesh.ops.smooth_vert(bm,verts=soften,factor=.38,use_axis_x=True,use_axis_y=True,use_axis_z=True)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    for f in bm.faces:
        if all(v.co.y>2.02 for v in f.verts) and f not in tail_faces and f.normal.y<0 and f in patch_faces:f.normal_flip()
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    for p in obj.data.polygons:p.use_smooth=True
    obj.data.normals_split_custom_set([(0,0,0)]*len(obj.data.loops))
    obj.data.calc_loop_triangles()
    payload={'vertices':[], 'triangles':[], 'groups':[g.name for g in obj.vertex_groups]}
    for v in obj.data.vertices:
        payload['vertices'].append({'p':[v.co.x,v.co.z,-v.co.y],
            'weights':[[g.group,g.weight] for g in v.groups if g.weight>1e-8]})
    for t in obj.data.loop_triangles:
        corners=[]
        for li in t.loops:
            normal=obj.data.corner_normals[li].vector;tex=obj.data.uv_layers.active.data[li].uv
            corners.append([obj.data.loops[li].vertex_index,[normal.x,normal.z,-normal.y],[tex.x,1-tex.y]])
        payload['triangles'].append({'material':t.material_index,'corners':corners})
    (OUT/'mesh.json').write_text(json.dumps(payload,separators=(',',':')),encoding='utf8')
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'mammoth-tail.blend'))
    render_views('rebuilt')
