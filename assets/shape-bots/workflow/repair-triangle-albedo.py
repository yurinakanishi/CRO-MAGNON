"""Remove source-baked ghost spectacle rings from the original body UVs.

Retain the actual TRELLIS glasses and the existing closed-eye ink. Source body
texels around the erroneous ink supply the fill; no new geometry or eyes.
"""
import bpy,bmesh
import numpy as np

def repair(obj,out,base):
    P=base.positions_of(obj.data);F=base.face_array(obj.data)
    size=float(np.ptp(P,axis=0).max());centre=(P.min(0)+P.max(0))*.5
    Q=(P-centre)/size
    bm=bmesh.new();bm.from_mesh(obj.data);unseen=set(bm.verts);groups=[]
    while unseen:
        pending=[unseen.pop()];group=[]
        while pending:
            v=pending.pop();group.append(v.index)
            for e in v.link_edges:
                other=e.other_vert(v)
                if other in unseen:unseen.remove(other);pending.append(other)
        groups.append(group)
    bm.free()
    shells=[g for g in groups if np.ptp(Q[g],axis=0).min()>.75]
    assert len(shells)==2, 'Inspect source body layers before retouching'
    inner=min(shells,key=lambda g:np.prod(np.ptp(Q[g],axis=0)))
    member=np.zeros(len(P),bool);member[inner]=True
    tree=base.bvh_from_arrays(P,F[member[F].all(1)])
    distances=np.array([tree.find_nearest(tuple(v))[3] for v in P])
    body=(distances<.009*size)[F].all(1)
    # The detached lens rims and the forward frame/bridge have a larger depth
    # from the nested source body. They must keep the exact original black ink.
    candidates=np.flatnonzero(body & (Q[F,:,].min(1)[:,1]<-.14)
                             & (Q[F].min(1)[:,2]<.18)&(Q[F].max(1)[:,2]>-.14)
                             & (Q[F].min(1)[:,0]<.29)&(Q[F].max(1)[:,0]>-.29))
    assert len(obj.data.materials)==1
    material=obj.data.materials[0]
    bsdf=next(n for n in material.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
    node=bsdf.inputs['Base Color'].links[0].from_node;source=node.image
    width,height=source.size
    rgba=np.empty(width*height*4,np.float32);source.pixels.foreach_get(rgba);rgba=rgba.reshape(-1,4)
    original=rgba.copy()
    loops=np.empty(len(obj.data.loops)*2,np.float32)
    obj.data.uv_layers.active.data.foreach_get('uv',loops)
    uv=loops.reshape(-1,2)*np.array([width,height])
    region=np.zeros(width*height,bool);protected=np.zeros(width*height,bool)
    surface_points=np.empty((width*height,3),np.float32)
    for face in candidates:
        poly=obj.data.polygons[int(face)];T=uv[list(poly.loop_indices)]
        lo=np.maximum(np.floor(T.min(0)).astype(int),0)
        hi=np.minimum(np.ceil(T.max(0)).astype(int),[width-1,height-1])
        e1,e2=T[1]-T[0],T[2]-T[0];det=e1[0]*e2[1]-e1[1]*e2[0]
        if abs(det)<1e-8:continue
        yy,xx=np.mgrid[lo[1]:hi[1]+1,lo[0]:hi[0]+1]
        dx,dy=xx+.5-T[0,0],yy+.5-T[0,1]
        b1=(dx*e2[1]-dy*e2[0])/det;b2=(e1[0]*dy-e1[1]*dx)/det;b0=1-b1-b2
        inside=(b0>=0)&(b1>=0)&(b2>=0)
        xyz=b0[...,None]*Q[F[face,0]]+b1[...,None]*Q[F[face,1]]+b2[...,None]*Q[F[face,2]]
        inside &= (np.abs(xyz[:,:,0])<.29)&(xyz[:,:,1]<-.14)&(xyz[:,:,2]>-.14)&(xyz[:,:,2]<.18)
        ids=(yy[inside]*width+xx[inside]).astype(int);points=xyz[inside]
        # The source eyes sit slightly inward of the frame centres. Their
        # original UV ink was plotted against physical coordinates before
        # setting these bounds, including the full curved lower edge.
        eye_offset=np.abs(points[:,0])-.108
        lower_eye_boundary=-.014+.028*(eye_offset/.055)**2
        eyes=(np.abs(eye_offset)<.055)&(points[:,2]>lower_eye_boundary)&(points[:,2]<.047)
        region[ids]=True;protected[ids[eyes]]=True;surface_points[ids]=points
    # Exclude the eye boxes completely. Only the dark contamination elsewhere
    # in the face band changes; white/yellow texels and every accessory remain.
    value=rgba[:,:3].max(1)
    mask=region & ~protected & (value<.90)
    assert 100<mask.sum()<region.sum()*.55, (mask.sum(),region.sum())
    pending=np.flatnonzero(mask);known=region & (value>=.90)
    changed=int(len(pending));iterations=0
    for iterations in range(256):
        if not len(pending):break
        neighbours=np.stack([pending-1,pending+1,pending-width,pending+width],axis=1)
        valid=(neighbours>=0)&(neighbours<len(known))
        valid[:,0]&=pending%width>0;valid[:,1]&=pending%width<width-1
        neighbours=np.clip(neighbours,0,len(known)-1)
        valid &= known[neighbours]
        count=valid.sum(1);front=count>0
        if not front.any():break
        values=(rgba[neighbours[front],:3]*valid[front,:,None]).sum(1)/count[front,None]
        fill=pending[front];rgba[fill,:3]=values;known[fill]=True
        pending=pending[~front]
    isolated=int(len(pending))
    if isolated:
        # UV chart positions are arbitrary. For isolated charts, interpolate
        # from texels physically nearest on the original 3D body instead.
        from mathutils.kdtree import KDTree
        donors=np.flatnonzero(known)
        colour_tree=KDTree(len(donors))
        for i,idx in enumerate(donors):colour_tree.insert(tuple(surface_points[idx]),i)
        colour_tree.balance()
        for idx in pending:
            found=colour_tree.find_n(tuple(surface_points[idx]),4)
            weights=np.array([1/max(item[2],1e-6)**2 for item in found])
            assert min(item[2] for item in found)<.08, 'No nearby source body colour; inspect the surface'
            rgba[idx,:3]=np.average(rgba[[donors[item[1]] for item in found],:3],axis=0,weights=weights)
    assert np.array_equal(rgba[~mask],original[~mask])
    assert np.array_equal(rgba[protected],original[protected])
    repaired=source.copy();repaired.pixels.foreach_set(rgba.ravel());repaired.update()
    repaired.filepath_raw=str(out/'triangle-ghost-rings-removed.png');repaired.file_format='PNG';repaired.save()
    fresh=bpy.data.images.load(repaired.filepath_raw,check_existing=False);fresh.colorspace_settings.name='sRGB';fresh.pack();node.image=fresh
    assert np.array_equal(P,base.positions_of(obj.data))
    return dict(method='Geometry-masked interpolation from adjacent original body texels; duplicate baked rings only',
                changedPixels=changed,protectedEyePixels=int(protected.sum()),bodyRegionPixels=int(region.sum()),
                iterations=iterations,isolatedChartTexels=isolated,geometryExact=True,uvExact=True,closedEyeTexelsExact=True,
                pixelsOutsideMaskExact=True,bodyDepthToleranceMetres=.009*size,sourceOriginalRetained=True)
