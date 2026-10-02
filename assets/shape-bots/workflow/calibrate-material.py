"""Match the reconstructed body's hue to its approved reference.

Preserve the original UV, geometric details, neutral eyes/accessories and local
texture variation. This is a 3D albedo correction; original images stay intact.
"""
import bpy
import numpy as np

def hsv(rgb):
    maximum=rgb.max(-1); minimum=rgb.min(-1); delta=maximum-minimum
    h=np.zeros_like(maximum); safe=np.maximum(delta,1e-8)
    for channel in [2,1,0]:
        selected=(rgb[:,channel]==maximum)&(delta>1e-8)
        if channel==0: h[selected]=((rgb[selected,1]-rgb[selected,2])/safe[selected])%6
        elif channel==1: h[selected]=(rgb[selected,2]-rgb[selected,0])/safe[selected]+2
        else: h[selected]=(rgb[selected,0]-rgb[selected,1])/safe[selected]+4
    return np.stack((h/6,delta/np.maximum(maximum,1e-8),maximum),axis=-1)

def rgb(hsv_values):
    h,s,v=hsv_values.T; sector=np.floor(h*6).astype(int)%6; f=h*6-np.floor(h*6)
    p=v*(1-s); q=v*(1-f*s); t=v*(1-(1-f)*s)
    out=np.empty_like(hsv_values)
    for i, values in enumerate([(v,t,p),(q,v,p),(p,v,t),(p,q,v),(t,p,v),(v,p,q)]):
        selected=sector==i
        out[selected]=np.stack(values,axis=-1)[selected]
    return out

def pixels(image):
    result=np.empty(len(image.pixels),dtype=np.float32)
    image.pixels.foreach_get(result)
    return result.reshape(-1,4)

def calibrate(obj, reference, kind, out):
    seed={'beret':215/360,'frog':75/360,'triangle':45/360,'heart':320/360}[kind]
    hue_distance=lambda h:np.abs((h-seed+.5)%1-.5)
    source=bpy.data.images.load(str(reference),check_existing=False)
    ref=pixels(source); ref_hsv=hsv(ref[:,:3])
    mask=(ref[:,3]>.98)&(ref_hsv[:,1]>.45)&(ref_hsv[:,2]>.12)&(hue_distance(ref_hsv[:,0])<.18)
    assert mask.sum()>1000
    target=np.median(ref_hsv[mask],axis=0)
    records=[]
    for mat in obj.data.materials:
        bsdf=next(n for n in mat.node_tree.nodes if n.type=='BSDF_PRINCIPLED')
        node=bsdf.inputs['Base Color'].links[0].from_node
        assert node.type=='TEX_IMAGE', 'Inspect nonstandard material wiring'
        image=node.image.copy(); image.name=f'{kind}-reference-calibrated-albedo'
        data=pixels(image); original=data.copy(); values=hsv(data[:,:3])
        mask=(values[:,1]>.45)&(values[:,2]>.12)&(hue_distance(values[:,0])<.18)
        assert mask.sum()>1000
        measured=np.median(values[mask],axis=0)
        shift=float((target[0]-measured[0]+.5)%1-.5)
        indices=np.flatnonzero((values[:,1]>.2)&(values[:,2]>.04)&(hue_distance(values[:,0])<.18))
        selected=values[indices].copy()
        strength=np.clip((selected[:,1]-.2)/.25,0,1)*np.clip((selected[:,2]-.04)/.08,0,1)
        selected[:,0]=(selected[:,0]+shift)%1
        selected[:,1]=np.clip(selected[:,1]*target[1]/max(measured[1],1e-6),0,1)
        selected[:,2]=np.clip(selected[:,2]*target[2]/max(measured[2],1e-6),0,1)
        data[indices,:3]=data[indices,:3]*(1-strength[:,None])+rgb(selected)*strength[:,None]
        assert np.array_equal(data[:,3],original[:,3])
        image.pixels.foreach_set(data.ravel());image.update()
        image.filepath_raw=str(out/f'{kind}-calibrated-albedo.png');image.file_format='PNG'
        image.save()
        # An image copy retains the original packed bytes. Reload the written
        # calibrated file so the glTF exporter cannot select that stale pack.
        fresh=bpy.data.images.load(image.filepath_raw,check_existing=False)
        fresh.name=image.name;fresh.colorspace_settings.name='sRGB';fresh.pack();node.image=fresh
        changed=np.any(data!=original,axis=1)
        records.append(dict(reference=str(reference),targetHsv=target.tolist(),denseHsv=measured.tolist(),hueShift=shift,
                            changedPixels=int(changed.sum()),unchangedPixels=int((~changed).sum()),alphaExact=True,originalUVsExact=True))
    return dict(method='Reference-derived body-colour calibration of source albedo; neutral white/black features retained',records=records)
