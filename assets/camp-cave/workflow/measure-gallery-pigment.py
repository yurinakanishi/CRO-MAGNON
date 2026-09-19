"""Read-only silhouette coverage against rays through the delivered cave."""
import hashlib
import json
from pathlib import Path
from PIL import Image

base=Path('assets/camp-cave')
records=json.loads((base/'qa/gallery-surfaces-r05.json').read_text(encoding='utf8'))
image_path=base/'source/mural-atlas-r05.png'
image=Image.open(image_path)
alpha=image.getchannel('A')
reports=[]
for record in records:
    x0,y0,x1,y1=record['rectangle']
    painted=[]
    rejected=[]
    for sample in record['samples']:
        x=min(image.width-1,round(x0+sample['u']*(x1-x0)))
        y=min(image.height-1,round(y1-sample['v']*(y1-y0)))
        if alpha.getpixel((x,y))<=32:
            continue
        painted.append(sample)
        point=sample.get('point')
        in_wall=point is not None and sample['facing']>.45
        if point:
            in_wall=in_wall and (point[0]<-2.4 if record['wall']=='east' else point[0]>2.2 if record['wall']=='west' else point[2]<-8.1)
        if not in_wall:
            rejected.append(sample)
    reports.append({'motif':record['motif'],'wall':record['wall'],'centre':record['centre'],
                    'paintedSamples':len(painted),'rejected':rejected})
result={'atlasSha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),
        'size':image.size,'alphaRange':alpha.getextrema(),
        'transparentFraction':alpha.histogram()[0]/(image.width*image.height),
        'placements':reports,'totalPaintedSamples':sum(r['paintedSamples'] for r in reports),
        'totalRejected':sum(len(r['rejected']) for r in reports)}
(base/'qa/gallery-pigment-coverage-r05.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps({**result,'placements':[ {**r,'rejected':len(r['rejected'])} for r in reports]}))
