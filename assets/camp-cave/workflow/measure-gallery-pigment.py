"""Read-only silhouette coverage against rays through the delivered cave."""
import hashlib
import json
import sys
from pathlib import Path
from PIL import Image

base=Path('assets/camp-cave')
revision=json.loads(Path('public/models/camp-cave/asset.json').read_text(encoding='utf8'))['revision']
records_path=Path(sys.argv[1]) if len(sys.argv)>1 else base/f'qa/gallery-surfaces-r{revision}.json'
output_path=Path(sys.argv[2]) if len(sys.argv)>2 else base/f'qa/gallery-pigment-coverage-r{revision}.json'
records=json.loads(records_path.read_text(encoding='utf8'))
image_path=base/'source/mural-atlas-r05.png'
image=Image.open(image_path)
alpha=image.getchannel('A')
character_path=base/'source/character-524-mural-r06.png'
character=Image.open(character_path)
reports=[]
for record in records:
    current=character if record.get('pigment')=='character524' else image
    current_alpha=current.getchannel('A')
    x0,y0,x1,y1=record['rectangle']
    painted=[]
    rejected=[]
    for sample in record['samples']:
        x=min(current.width-1,round(x0+sample['u']*(x1-x0)))
        y=min(current.height-1,round(y1-sample['v']*(y1-y0)))
        if current_alpha.getpixel((x,y))<=32:
            continue
        painted.append(sample)
        point=sample.get('point')
        in_wall=point is not None and sample['facing']>.38
        if point:
            t=max(0,min(1,-point[2]/72.64))
            centre_x=38*t*t*(3-2*t)
            in_wall=in_wall and (point[0]-centre_x<-1.1 if record['wall']=='east' else point[0]-centre_x>1.1)
        if not in_wall:
            rejected.append(sample)
    reports.append({'motif':record['motif'],'wall':record['wall'],'centre':record['centre'],
                    'paintedSamples':len(painted),'rejected':rejected})
result={'atlasSha256':hashlib.sha256(image_path.read_bytes()).hexdigest(),
        'characterSha256':hashlib.sha256(character_path.read_bytes()).hexdigest(),
        'size':image.size,'alphaRange':alpha.getextrema(),
        'transparentFraction':alpha.histogram()[0]/(image.width*image.height),
        'placements':reports,'totalPaintedSamples':sum(r['paintedSamples'] for r in reports),
        'totalRejected':sum(len(r['rejected']) for r in reports)}
output_path.write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps({**result,'placements':[ {**r,'rejected':len(r['rejected'])} for r in reports]}))
