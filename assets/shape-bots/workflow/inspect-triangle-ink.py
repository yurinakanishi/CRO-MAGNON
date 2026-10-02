"""Plot original UV samples against physical face coordinates for retouch QA."""
import io,sys,json
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
from glb_metrics import parse_glb,read_accessor
src=ROOT/'output/model-generation/models/orb-bot-triangle/work/trellis/dense-attempt-01-res512-seed0042.glb'
g,b=parse_glb(str(src));a=g['meshes'][0]['primitives'][0]
P=read_accessor(g,b,a['attributes']['POSITION']);UV=read_accessor(g,b,a['attributes']['TEXCOORD_0']);F=read_accessor(g,b,a['indices']).reshape(-1,3)
P=(P-(P.min(0)+P.max(0))*.5)/np.ptp(P,axis=0).max()
v=g['bufferViews'][g['images'][0]['bufferView']];texture=np.array(Image.open(io.BytesIO(b[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']])).convert('RGB'))/255
points=[];colours=[]
for i in range(5):
    for j in range(5-i):
        w=np.array([(i+.33)/5,(j+.33)/5,1-(i+j+.66)/5])
        q=(P[F]*w[None,:,None]).sum(1);uv=(UV[F]*w[None,:,None]).sum(1)
        selected=(abs(q[:,0])<.29)&(abs(q[:,1])<.18)&(q[:,2]>.14)
        q=q[selected];uv=uv[selected];pix=np.clip((uv*np.array(texture.shape[1::-1])).astype(int),0,np.array(texture.shape[1::-1])-1)
        c=texture[pix[:,1],pix[:,0]];points.append(q);colours.append(c)
points=np.concatenate(points);colours=np.concatenate(colours)
order=points[:,2].argsort();points=points[order];colours=colours[order]
plot=Image.new('RGB',(1300,770),'white');draw=ImageDraw.Draw(plot)
xy=lambda x,y:(round(650+x*2000),round(410-y*2000))
for p,c in zip(points,colours):
    x,y=xy(p[0],p[1]);draw.rectangle((x-1,y-1,x+1,y+1),fill=tuple((c*255).astype(int)))
for x in [-.108,.108]:draw.rectangle((*xy(x-.055,.047),*xy(x+.055,-.014)),outline='red',width=2)
for y in np.arange(-.14,.181,.02):
    start,end=xy(-.29,y),xy(.29,y);draw.line((start,end),fill='#bbbbbb');draw.text((start[0]-45,start[1]-4),f'{y:.3f}',fill='black')
draw.text((60,740),'Original UV ink vs physical face coordinates; red: proposed eye preservation',fill='black')
out=src.parents[2]/'qa/source-layers/ink-coordinate-plot.png';plot.save(out);print(out)
