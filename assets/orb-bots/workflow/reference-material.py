"""Reproject the immutable reference's ink into a new surface UV atlas.

The TRELLIS geometry is unchanged. Dark face features come from the source PNG,
never from generated eye meshes or analytic drawings. Baking removes studio
lighting and the reconstruction's duplicated features. Back colour is inferred.
"""
import math
from pathlib import Path
import bpy
import numpy as np

def bake_reference(obj,reference,colour,out,keep_existing_uv=False):
    image=bpy.data.images.load(str(reference),check_existing=True)
    w,h=image.size
    pixels=np.empty(w*h*4,dtype=np.float32);image.pixels.foreach_get(pixels);pixels=pixels.reshape(h,w,4)
    yy,xx=np.nonzero(pixels[:,:,3]>.8)
    uv_box=(float(xx.min()/w),float(xx.max()/w),float(yy.min()/h),float(yy.max()/h))
    coords=np.array([v.co[:] for v in obj.data.vertices]);lo=coords.min(0);hi=coords.max(0)
    if not keep_existing_uv:
        for uv in list(obj.data.uv_layers):obj.data.uv_layers.remove(uv)
    else:
        assert [uv.name for uv in obj.data.uv_layers] == ['BotAtlas']
    projected=obj.data.uv_layers.new(name='ReferenceProjection')
    for loop in obj.data.loops:
        point=coords[loop.vertex_index]
        projected.data[loop.index].uv=(uv_box[0]+(point[0]-lo[0])/(hi[0]-lo[0])*(uv_box[1]-uv_box[0]),uv_box[2]+(point[2]-lo[2])/(hi[2]-lo[2])*(uv_box[3]-uv_box[2]))
    atlas_uv=obj.data.uv_layers.get('BotAtlas') or obj.data.uv_layers.new(name='BotAtlas')
    obj.data.uv_layers.active=atlas_uv;atlas_uv.active_render=True
    bpy.ops.object.select_all(action='DESELECT');obj.select_set(True);bpy.context.view_layer.objects.active=obj
    if not keep_existing_uv:
        bpy.ops.object.mode_set(mode='EDIT');bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=math.radians(72),island_margin=.015)
        bpy.ops.object.mode_set(mode='OBJECT')
    material=bpy.data.materials.new('ReferenceInk');material.use_nodes=True
    nodes=material.node_tree.nodes;nodes.clear();links=material.node_tree.links
    def node(kind,name):
        value=nodes.new(kind);value.name=name;return value
    uv=node('ShaderNodeUVMap','SourceProjection');uv.uv_map='ReferenceProjection'
    tex=node('ShaderNodeTexImage','ImmutableReference');tex.image=image;tex.extension='CLIP';links.new(uv.outputs['UV'],tex.inputs['Vector'])
    bw=node('ShaderNodeRGBToBW','SourceInk');links.new(tex.outputs['Color'],bw.inputs['Color'])
    ink_value=bw.outputs[0]
    if colour!='white':
        # Saturated blue has low luminance but is not black. Separate its ink by
        # the brightest channel, retaining the exact reference edges.
        rgb=node('ShaderNodeSeparateColor','ReferenceRGB');rgb.mode='RGB';links.new(tex.outputs['Color'],rgb.inputs[0])
        rg=node('ShaderNodeMath','MaxRG');rg.operation='MAXIMUM';links.new(rgb.outputs[0],rg.inputs[0]);links.new(rgb.outputs[1],rg.inputs[1])
        rgbmax=node('ShaderNodeMath','MaxRGB');rgbmax.operation='MAXIMUM';links.new(rg.outputs[0],rgbmax.inputs[0]);links.new(rgb.outputs[2],rgbmax.inputs[1]);ink_value=rgbmax.outputs[0]
    ink=node('ShaderNodeMapRange','SeparateBlackInk');ink.clamp=True;ink.inputs['From Min'].default_value=.015;ink.inputs['From Max'].default_value=.05;ink.inputs['To Min'].default_value=1;ink.inputs['To Max'].default_value=0
    links.new(ink_value,ink.inputs['Value'])
    normal=node('ShaderNodeNewGeometry','ActualSurfaceNormal');xyz=node('ShaderNodeSeparateXYZ','FrontNormal');links.new(normal.outputs['Normal'],xyz.inputs[0])
    front=node('ShaderNodeMapRange','FrontOnly');front.clamp=True;front.inputs['From Min'].default_value=-.10;front.inputs['From Max'].default_value=-.45
    links.new(xyz.outputs['Y'],front.inputs['Value'])
    mul=node('ShaderNodeMath','FrontInk');mul.operation='MULTIPLY';links.new(ink.outputs[0],mul.inputs[0]);links.new(front.outputs[0],mul.inputs[1])
    mask=node('ShaderNodeMath','SourceAlpha');mask.operation='MULTIPLY';links.new(mul.outputs[0],mask.inputs[0]);links.new(tex.outputs['Alpha'],mask.inputs[1])
    palette={'white':'f5f3ee','blue':'1172ef','green':'18b653','purple':'a23ee8','orange':'f58b28'}
    srgb=[int(palette[colour][i:i+2],16)/255 for i in [0,2,4]]
    linear=lambda n:n/12.92 if n<=.04045 else ((n+.055)/1.055)**2.4
    mix=node('ShaderNodeMixRGB','ReferenceColours');mix.blend_type='MIX';mix.inputs[1].default_value=(*[linear(v) for v in srgb],1);mix.inputs[2].default_value=(.0035,.0035,.004,1);links.new(mask.outputs[0],mix.inputs[0])
    emission=node('ShaderNodeEmission','UnlitBake');links.new(mix.outputs[0],emission.inputs['Color'])
    output=node('ShaderNodeOutputMaterial','Output');links.new(emission.outputs[0],output.inputs['Surface'])
    atlas=bpy.data.images.new('BotReferenceAlbedo',width=4096,height=4096,alpha=False)
    # Generated image pixels use this image's sRGB storage; shader inputs above
    # use linear light. Keep the unused area equal to baked body texels.
    atlas.generated_color=(*srgb,1)
    target=node('ShaderNodeTexImage','BakeTarget');target.image=atlas;nodes.active=target;target.select=True
    obj.data.materials.clear();obj.data.materials.append(material)
    for poly in obj.data.polygons:poly.material_index=0
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.device='CPU';scene.cycles.samples=1
    scene.render.bake.margin=16;scene.render.bake.use_clear=False
    bpy.ops.object.bake(type='EMIT',use_selected_to_active=False,margin=16,uv_layer='BotAtlas',use_clear=False)
    atlas.filepath_raw=str(Path(out)/'reference-albedo.png');atlas.file_format='PNG';atlas.save();atlas.pack()
    nodes.clear();tex=node('ShaderNodeTexImage','ReferenceAlbedo');tex.image=atlas
    uv=node('ShaderNodeUVMap','AtlasUV');uv.uv_map='BotAtlas';links.new(uv.outputs['UV'],tex.inputs['Vector'])
    bsdf=node('ShaderNodeBsdfPrincipled','Surface');links.new(tex.outputs['Color'],bsdf.inputs['Base Color']);bsdf.inputs['Roughness'].default_value=.57;bsdf.inputs['Metallic'].default_value=0
    output=node('ShaderNodeOutputMaterial','Output');links.new(bsdf.outputs[0],output.inputs['Surface'])
    # Edit-mode UV unwrap reallocates mesh data; reacquire layers by name.
    # Keeping RNA references across that operation can remove the wrong layer.
    obj.data.uv_layers.remove(obj.data.uv_layers['ReferenceProjection'])
    obj.data.uv_layers.active=obj.data.uv_layers['BotAtlas']
    obj.data.uv_layers['BotAtlas'].active_render=True
    assert [layer.name for layer in obj.data.uv_layers] == ['BotAtlas']
    return dict(method='Source-PNG ink projection on the source-derived TRELLIS surface, lighting removed, front-normal mask; Cycles emission bake',source=str(reference),sourceAlphaBounds=uv_box,atlas=4096,inferredBackColour=palette[colour],unusedAtlasColour=palette[colour],sourcePngUnmodified=True,analyticEyes=False)
