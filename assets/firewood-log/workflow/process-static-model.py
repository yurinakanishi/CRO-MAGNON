"""Preserve TRELLIS surfaces/UVs; choose QEM density by measured surface error.

Run in Blender. No primitive construction. All LODs descend from the same
reconstructed source, including small disconnected functional pieces.
"""
import argparse,hashlib,json,math,sys
from pathlib import Path
import bpy,bmesh,numpy as np
from mathutils import Vector,Matrix
from mathutils.bvhtree import BVHTree

ROOT=Path(__file__).resolve().parents[1]
if ROOT.name!='CRO-MAGNON':
    ROOT=next(p for p in Path(__file__).resolve().parents if (p/'assets/world-models.json').exists())

def sha(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def positions(mesh):
    p=np.empty((len(mesh.vertices),3),dtype=np.float64);mesh.vertices.foreach_get('co',p.ravel());return p
def faces(mesh):
    mesh.calc_loop_triangles();f=np.empty((len(mesh.loop_triangles),3),dtype=np.int32);mesh.loop_triangles.foreach_get('vertices',f.ravel());return f
def tree(p,f):return BVHTree.FromPolygons(p.tolist(),f.tolist(),all_triangles=True)
def samples(p,f,count=6000):
    rng=np.random.default_rng(81);t=p[f];area=np.linalg.norm(np.cross(t[:,1]-t[:,0],t[:,2]-t[:,0]),axis=1)
    take=rng.choice(len(f),min(count,len(f)*2),p=area/area.sum());uv=rng.random((len(take),2));flip=uv.sum(axis=1)>1;uv[flip]=1-uv[flip];tri=t[take]
    return tri[:,0]+uv[:,0,None]*(tri[:,1]-tri[:,0])+uv[:,1,None]*(tri[:,2]-tri[:,0])
def errors(points,bvh):
    values=np.asarray([bvh.find_nearest(Vector(p))[3] for p in points]);return {'rms_m':float(np.sqrt(np.mean(values**2))),'p95_m':float(np.percentile(values,95)),'max_m':float(values.max())}
def select(obj):
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
def shade(obj):
    bm=bmesh.new();bm.from_mesh(obj.data)
    bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces))
    for f in bm.faces:f.smooth=True
    for e in bm.edges:e.smooth=len(e.link_faces)==2 and e.calc_face_angle(0)<math.radians(48)
    bm.to_mesh(obj.data);bm.free();obj.data.update()
    # Imported custom normals refer to the pre-alignment coordinate frame.
    # Recompute them on the actual rotated, reduced surface before GLB export.
    if obj.data.has_custom_normals:
        obj.data.normals_split_custom_set([(0.0,0.0,0.0)]*len(obj.data.loops))
def trial(source,ratio):
    obj=source.copy();obj.data=source.data.copy();bpy.context.collection.objects.link(obj);select(obj)
    mod=obj.modifiers.new('SourceSurfaceQEM','DECIMATE');mod.ratio=ratio;mod.use_collapse_triangulate=True
    bpy.ops.object.modifier_apply(modifier=mod.name)
    obj.data.validate(clean_customdata=False);return obj
def remove(obj):
    mesh=obj.data;bpy.data.objects.remove(obj,do_unlink=True);bpy.data.meshes.remove(mesh)
def export(obj,path):
    select(obj);shade(obj)
    bpy.ops.export_scene.gltf(filepath=str(path),export_format='GLB',use_selection=True,export_yup=True,export_animations=False,export_apply=False,export_image_format='AUTO')
    return {'path':path.name,'sha256':sha(path),'bytes':path.stat().st_size,'triangles':len(faces(obj.data)),'vertices_before_export_splits':len(obj.data.vertices)}

def main():
    parser=argparse.ArgumentParser();parser.add_argument('key');parser.add_argument('--revision',default='01');parser.add_argument('--yaw',type=float,default=0);parser.add_argument('--p95',type=float);parser.add_argument('--pca',action='store_true');parser.add_argument('--solid',action='store_true');parser.add_argument('--stone-tip',action='store_true');parser.add_argument('--water-surface',action='store_true');parser.add_argument('--width',type=float);parser.add_argument('--height',type=float)
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:]);catalog=json.loads((ROOT/'assets/world-models.json').read_text(encoding='utf-8'));spec=next((x for x in catalog['assets'] if x['key']==args.key),None)
    model=ROOT/'output/model-generation/models'/args.key
    if spec is None:spec=json.loads((model/'request-spec.json').read_text(encoding='utf-8'))
    # 2026-09-12 ruin rebuild: the delivered catalog entry records the old castle's
    # height; the new reference is sized by its width instead.
    if args.width or args.height:
        spec={k:v for k,v in spec.items() if k not in ('width','height')}
        if args.width:spec['width']=args.width
        if args.height:spec['height']=args.height
    selected=model/'work/trellis/selected-dense.json'
    dense=model/json.loads(selected.read_text(encoding='utf-8'))['path'] if selected.exists() else model/'work/trellis/dense-res1024-seed0042.glb'
    out=model/f'work/low-poly/candidate-{args.revision}';out.mkdir(parents=True,exist_ok=True)
    assert not (out/'candidate.glb').exists(),'Preserving existing candidate'
    bpy.ops.wm.read_factory_settings(use_empty=True);bpy.ops.import_scene.gltf(filepath=str(dense));objects=[o for o in bpy.context.selected_objects if o.type=='MESH'];bpy.context.view_layer.objects.active=objects[0]
    if len(objects)>1:bpy.ops.object.join()
    source=bpy.context.view_layer.objects.active;bpy.ops.object.transform_apply(location=True,rotation=True,scale=True);source.name=args.key
    bm=bmesh.new();bm.from_mesh(source.data);before=len(bm.verts);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-6);bmesh.ops.triangulate(bm,faces=list(bm.faces));repairs={'closed_boundary_faces':0}
    if args.water_surface:
        assert args.key=='river-water', 'Surface extraction is specific to the reviewed water reconstruction'
        points=np.array([v.co[:] for v in bm.verts]);span=np.ptp(points,axis=0)
        threshold=float(points[:,2].max()-min(span[:2])*.016)
        bm.normal_update()
        unwanted=[face for face in bm.faces if min(v.co.z for v in face.verts)<threshold or face.normal.z<=0]
        repairs['water_surface']={'removed_faces':len(unwanted),'source_height_threshold':threshold,'method':'Retain the existing upward-facing water surface and UVs; remove the unrequested white underside mass and duplicate downward-facing underside. Identified by six views and source-albedo height classification. No replacement surface is constructed.'}
        bmesh.ops.delete(bm,geom=unwanted,context='FACES')
        bm.faces.ensure_lookup_table();bm.faces.index_update();surface_tree=BVHTree.FromBMesh(bm)
        hidden=[]
        for face in bm.faces:
            center=face.calc_center_median()
            hit=surface_tree.ray_cast(Vector((center.x,center.y,float(points[:,2].max()+.2))),Vector((0,0,-1)))[0]
            if hit is not None and hit.z>center.z+.00001:hidden.append(face)
        repairs['water_surface']['occluded_upper_faces_removed']=len(hidden)
        repairs['water_surface']['method']+=' Downward BVH rays remove occluded upward-facing fragments beneath the actual top.'
        bmesh.ops.delete(bm,geom=hidden,context='FACES')
        isolated=[v for v in bm.verts if not v.link_faces]
        if isolated:bmesh.ops.delete(bm,geom=isolated,context='VERTS')
    if args.solid:
        # Only use for reviewed solid objects, never tents, racks or bridges.
        boundary=[e for e in bm.edges if e.is_boundary]
        filled=bmesh.ops.holes_fill(bm,edges=boundary,sides=0)['faces'] if boundary else []
        repairs['closed_boundary_faces']=len(filled)
        uv=bm.loops.layers.uv.active
        if uv:
            for face in filled:
                neighbours=[l[uv].uv.copy() for v in face.verts for f in v.link_faces if f not in filled for l in f.loops if l.vert==v]
                if neighbours:
                    average=sum(neighbours,Vector((0,0)))/len(neighbours)
                    for loop in face.loops:loop[uv].uv=average
        bmesh.ops.triangulate(bm,faces=list(filled))
    bm.to_mesh(source.data);bm.free();source.data.validate(clean_customdata=False)
    p=positions(source.data);yaw=args.yaw
    if args.pca:
        # Fit only a rigid yaw; retain the source's actual surface and proportions.
        cov=np.cov(p[:,:2].T);v=np.linalg.eigh(cov)[1][:,-1];yaw-=math.degrees(math.atan2(v[1],v[0]))
    matrix=np.asarray(Matrix.Rotation(math.radians(yaw),3,'Z'));p=p@matrix.T
    lo=p.min(axis=0);hi=p.max(axis=0);span=hi-lo
    scale=(spec['height']/span[2]) if 'height' in spec else (spec['width']/span[0])
    p=(p-np.array([(hi[0]+lo[0])*.5,(hi[1]+lo[1])*.5,lo[2]]))*scale
    grip=None
    if spec['kind']=='equipment':
        grip_height=spec['height']*(.34 if args.key=='flint-spear' else .22)
        band=p[np.abs(p[:,2]-grip_height)<spec['height']*.035]
        grip=np.array([np.median(band[:,0]),np.median(band[:,1]),grip_height]);p-=grip
    source.data.vertices.foreach_set('co',p.ravel());source.data.update();f=faces(source.data);original_tree=tree(p,f);original_samples=samples(p,f)
    full_span=float(np.ptp(p,axis=0).max())
    factors={'tree':.0025,'foliage':.003,'static':.0015,'equipment':.001,'bridge':.001,'terrain':.0007,'water':.0006,'quadruped':.0012}
    tolerance=args.p95 or full_span*factors[spec['kind']]
    reports=[];chosen=None
    for ratio in [.02,.045,.085,.15,.27,.45,.7,1.0]:
        obj=trial(source,ratio);q=positions(obj.data);g=faces(obj.data);qtree=tree(q,g)
        forward=errors(original_samples,qtree);backward=errors(samples(q,g),original_tree)
        ok=max(forward['p95_m'],backward['p95_m'])<=tolerance and forward['max_m']<=tolerance*9
        reports.append({'ratio':ratio,'triangles':len(g),'dense_to_reduced':forward,'reduced_to_dense':backward,'within_error_budget':ok})
        if ok:chosen=obj;break
        remove(obj)
    assert chosen is not None
    if args.stone_tip:
        assert args.key=='flint-spear', 'Stone-tip correction is specific to the reviewed spear'
        original=chosen.data.materials[0];stone=original.copy();stone.name='FlintStone'
        bsdf=stone.node_tree.nodes.get('Principled BSDF');node=bsdf.inputs['Base Color'].links[0].from_node
        assert node.type=='TEX_IMAGE', 'Expected the original source albedo image'
        corrected=node.image.copy();corrected.name='FlintStoneSourceAlbedo'
        pixels=np.empty(len(corrected.pixels),dtype=np.float32);corrected.pixels.foreach_get(pixels);pixels=pixels.reshape((-1,4))
        gray=pixels[:,:3]@np.array([.2126,.7152,.0722],dtype=np.float32)
        pixels[:,:3]=np.clip((gray[:,None]*.9+pixels[:,:3]*.1)*1.15,0,1)
        corrected.pixels.foreach_set(pixels.ravel());corrected.update();corrected.pack();node.image=corrected
        chosen.data.materials.append(stone);material_index=len(chosen.data.materials)-1
        threshold=spec['height']*.87-(float(grip[2]) if grip is not None else 0)
        count=0
        for face in chosen.data.polygons:
            if sum(chosen.data.vertices[i].co.z for i in face.vertices)/len(face.vertices)>threshold:
                face.material_index=material_index;count+=1
        assert count>0
        repairs['stone_tip_material']={'faces':count,'height_threshold_grip_relative_m':threshold,'method':'Retain source albedo detail and UVs, reduce saturation to 10 percent and lift luminance by 15 percent on the stone tip only; geometry unchanged.'}
    # Keep original UV charts and albedo. Enforce dielectric rough materials.
    image_records=[];seen=set();texture_limit=1024 if full_span>1 else 512
    for mat in chosen.data.materials:
        if not mat or not mat.use_nodes:continue
        if args.water_surface:mat.use_backface_culling=False
        bsdf=mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            for name,value in [('Metallic',0),('Roughness',.87 if spec['kind']!='water' else .28)]:
                socket=bsdf.inputs[name]
                for link in list(socket.links):mat.node_tree.links.remove(link)
                socket.default_value=value
        for node in mat.node_tree.nodes:
            image=getattr(node,'image',None)
            if not image or image.as_pointer() in seen:continue
            seen.add(image.as_pointer());original_size=list(image.size)
            if max(image.size)>texture_limit:
                factor=texture_limit/max(image.size);image.scale(round(image.size[0]*factor),round(image.size[1]*factor))
            image.pack();image_records.append({'name':image.name,'original_size':original_size,'delivery_size':list(image.size)})
    chosen.name=args.key;chosen.data.name=args.key+'Surface'
    outputs=[export(chosen,out/'candidate.glb')]
    lod_reports=[]
    if spec['kind'] in ['tree','foliage','static','terrain']:
        for label,factors,lod_limit in [('lod1',[.14,.25,.4,.65,1],.008),('lod2',[.035,.07,.14,.25,.4,.7,1],.020)]:
            for factor in factors:
                lod=trial(chosen,factor);q=positions(lod.data);g=faces(lod.data);err=errors(original_samples,tree(q,g))
                if err['p95_m']<=full_span*lod_limit and err['max_m']<=full_span*lod_limit*7:break
                remove(lod)
            lod_reports.append({'lod':label,'source_ratio':factor,'dense_to_lod':err,'projected_use':'distance gated; visually inspect at transition distance'})
            outputs.append(export(lod,out/(label+'.glb')));remove(lod)
    result={'model':args.key,'author':'Codex','status':'candidate-awaiting-exact-glb-QA','dense':{'path':str(dense.relative_to(model)),'sha256':sha(dense),'triangles':len(f),'vertices_after_weld':len(p),'vertices_before_weld':before},'lineage':'TRELLIS source surface → weld and quadric collapse with retained source UV/albedo → rigid placement and uniform scale → dielectric material; no primitive replacement','alignment':{'yaw_degrees':yaw,'uniform_scale':float(scale),'pivot':'grip' if grip is not None else 'ground at horizontal bounds centre','grip_original_metres':grip.tolist() if grip is not None else None,'bounds_blender_z_up':{'min':p.min(axis=0).tolist(),'max':p.max(axis=0).tolist()}},'error_budget':{'p95_m':tolerance,'max_m':tolerance*9,'samples_per_direction':len(original_samples)},'reduction_probes':reports,'lods':lod_reports,'images':image_records,'outputs':outputs}
    result['source_repairs']=repairs
    (out/'process-report.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8');print(json.dumps(result),flush=True)
if __name__=='__main__':main()
