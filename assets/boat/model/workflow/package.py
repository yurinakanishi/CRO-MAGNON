from pathlib import Path
import json,struct,io,hashlib,math
from PIL import Image,ImageChops,ImageStat
root=Path(__file__).resolve().parents[1];src=root/'work/revision-01/candidate.glb';out=root/'work/revision-02';out.mkdir(exist_ok=True)
dst=out/'candidate.glb'
if dst.exists():raise RuntimeError('Preserve revision')
b=src.read_bytes();n=struct.unpack_from('<I',b,12)[0];doc=json.loads(b[20:20+n]);binary=b[28+n:]
images={i['bufferView']:i for i in doc['images']};chunks=[];offset=0;report=[]
for index,v in enumerate(doc['bufferViews']):
    data=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];old=data
    if index in images:
        im=Image.open(io.BytesIO(data)).convert('RGB');mem=io.BytesIO();im.save(mem,'JPEG',quality=98,subsampling=0)
        candidate=mem.getvalue();decoded=Image.open(io.BytesIO(candidate)).convert('RGB');stat=ImageStat.Stat(ImageChops.difference(im,decoded));mse=sum(a*a for a in stat.rms)/3;psnr=10*math.log10(255**2/max(mse,1e-20))
        if psnr>=40:data=candidate;images[index]['mimeType']='image/jpeg'
        report.append(dict(view=index,psnr=psnr,originalBytes=len(old),bytes=len(data),converted=data!=old))
    else:report.append(dict(view=index,geometryPreserved=True,sha256=hashlib.sha256(data).hexdigest()))
    v['byteOffset']=offset;v['byteLength']=len(data);data+=b'\0'*((-len(data))%4);chunks.append(data);offset+=len(data)
for m in doc['materials']:m['pbrMetallicRoughness']['metallicFactor']=0
doc['buffers'][0]['byteLength']=offset
j=json.dumps(doc,separators=(',',':')).encode();j+=b' '*((-len(j))%4);bin=b''.join(chunks)
dst.write_bytes(struct.pack('<III',0x46546c67,2,28+len(j)+len(bin))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(bin),0x004e4942)+bin)
(out/'packaging.json').write_text(json.dumps(dict(sourceSha256=hashlib.sha256(b).hexdigest(),sha256=hashlib.sha256(dst.read_bytes()).hexdigest(),buffers=report,bytes=dst.stat().st_size),indent=2))
print((out/'packaging.json').read_text())
