"""Append a corrected revision while preserving the original model archive."""
import hashlib,json,shutil,sys
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
revision=sys.argv[1];target=(ROOT.parent/'threed-model-creation/models/kohaku').resolve()
if target.parent!=(ROOT.parent/'threed-model-creation/models').resolve() or not (target/'model.json').exists():raise RuntimeError('Missing canonical model archive')
records=[]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def copy(source,dest):
    hashed=digest(source)
    if dest.exists():
        if digest(dest)==hashed:return
        dest=target/f'updates/revision-{revision}'/dest.relative_to(target)
    dest.parent.mkdir(parents=True,exist_ok=True)
    with source.open('rb') as r,dest.open('xb') as w:shutil.copyfileobj(r,w)
    if digest(dest)!=hashed:raise RuntimeError('Archive copy mismatch')
    records.append(dict(path=str(dest.relative_to(target)),bytes=dest.stat().st_size,sha256=hashed))
for source,dest in [(ROOT/'output/model-generation/models/kohaku',target),(ROOT/'assets/kohaku',target/'game-adoption'),(ROOT/'public/models/kohaku',target/'delivery')]:
    for file in sorted(source.rglob('*')):
        if file.is_file() and '__pycache__' not in file.parts:copy(file,dest/file.relative_to(source))
copy(ROOT/'docs/kohaku-2026-10-04.md',target/'README.md')
readme=target/'README.md'
with (target/f'README-before-{revision}.md').open('xb') as w:w.write(readme.read_bytes())
readme.write_bytes((ROOT/'docs/kohaku-2026-10-04.md').read_bytes())
records.append(dict(path='README.md',bytes=readme.stat().st_size,sha256=digest(readme)))
asset=json.loads((ROOT/'public/models/kohaku/asset.json').read_text(encoding='utf8'))
meta=dict(modelKey='kohaku',candidate=1,revision=revision,status='integrated-unverified',sha256=asset['sha256'],reference='source/reference-v2.png',userReference='source/kohaku-poses.jpg',candidateFile=f'work/rig/revision-{revision}/candidate.glb',delivery=f'delivery/model-r{revision}.glb',preview=f'qa/final-{revision}/viewer.html',testsRun=False,browserValidationRun=False)
old=target/'model.json';old_copy=target/f'model-before-{revision}.json'
with old_copy.open('xb') as f:f.write(old.read_bytes())
old.write_text(json.dumps(meta,indent=2)+'\n',encoding='utf8')
manifest=dict(target=str(target),revision=revision,addedFiles=len(records),addedBytes=sum(r['bytes'] for r in records),records=records,copiedSha256Verified=True,testsRun=False,browserValidationRun=False)
(target/f'archive-revision-{revision}.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
(ROOT/f'assets/kohaku/library-revision-{revision}.json').write_text(json.dumps(manifest,indent=2)+'\n',encoding='utf8')
print(json.dumps({k:v for k,v in manifest.items() if k!='records'}),flush=True)
