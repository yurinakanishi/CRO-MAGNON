"""Append a complete new model archive; never overwrite another candidate."""
import hashlib,json,shutil
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
target=(ROOT.parent/'threed-model-creation/models/kohaku').resolve()
expected=(ROOT.parent/'threed-model-creation/models').resolve()
if target.parent!=expected or target.name!='kohaku' or target.exists():
    raise RuntimeError('Archive destination must be a new kohaku model directory')
records=[]
sources=[(ROOT/'output/model-generation/models/kohaku',target),(ROOT/'assets/kohaku',target/'game-adoption'),(ROOT/'public/models/kohaku',target/'delivery')]
def copy(source,dest):
    dest.parent.mkdir(parents=True,exist_ok=True)
    with source.open('rb') as r,dest.open('xb') as w:shutil.copyfileobj(r,w)
    digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
    hashed=digest(source)
    if digest(dest)!=hashed:raise RuntimeError('Archive copy mismatch: '+str(dest))
    records.append(dict(path=str(dest.relative_to(target)),bytes=dest.stat().st_size,sha256=hashed))
for source,dest in sources:
    for file in sorted(source.rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts:copy(file,dest/file.relative_to(source))
copy(ROOT/'docs/kohaku-2026-10-04.md',target/'README.md')
for file in (ROOT/'assets/rimo-neko/workflow/lib').glob('*.py'):copy(file,target/'workflow/lib'/file.name)
asset=json.loads((ROOT/'public/models/kohaku/asset.json').read_text(encoding='utf8'))
manifest=dict(target=str(target),files=len(records),bytes=sum(r['bytes'] for r in records),records=records,copiedSha256Verified=True,testsRun=False,browserValidationRun=False)
(target/'archive-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
(target/'model.json').write_text(json.dumps(dict(modelKey='kohaku',candidate=1,revision='01',status='integrated-unverified',sha256=asset['sha256'],reference='source/reference-v1.png',userReference='source/kohaku-poses.jpg',candidateFile='work/rig/revision-01/candidate.glb',delivery='delivery/model-r01.glb',preview='qa/final-01/viewer.html',testsRun=False,browserValidationRun=False),indent=2)+'\n',encoding='utf8')
(ROOT/'assets/kohaku/library-archive.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in manifest.items() if k!='records'}),flush=True)
