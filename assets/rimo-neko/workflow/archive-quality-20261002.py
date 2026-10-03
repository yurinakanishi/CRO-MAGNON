"""Append-only archive of the quality experiments; verify every copied byte."""
import hashlib,json,shutil
from pathlib import Path
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
library=ROOT.parent/'threed-model-creation/models/rimo-neko'
dest=library/'candidate-2'
def sha(p):
    h=hashlib.sha256()
    with p.open('rb') as f:
        for block in iter(lambda:f.read(8*1024*1024),b''):h.update(block)
    return h.hexdigest()
records=[]
def copy(src,target):
    assert target.resolve().is_relative_to(library.resolve())
    target.parent.mkdir(parents=True,exist_ok=True);digest=sha(src)
    if target.exists():assert sha(target)==digest,('Keep archive immutable',str(target))
    else:shutil.copy2(src,target)
    assert sha(target)==digest
    records.append(dict(path=str(target.relative_to(library)).replace('\\','/'),bytes=target.stat().st_size,sha256=digest))
def tree(src,target):
    for p in sorted(src.rglob('*')):
        if p.is_file() and '__pycache__' not in p.parts:copy(p,target/p.relative_to(src))
tree(ROOT/'output/model-generation/models/rimo-neko/candidate-2',dest)
tree(ROOT/'assets/rimo-neko/source',dest/'source')
tree(ROOT/'assets/rimo-neko/workflow',dest/'workflow')
tree(ROOT/'output/rimo-quality-20261002',library/'quality-review-20261002')
for p in ['assets/rimo-neko/quality-review-2026-10-02.md','docs/astra-creature-3d-quality-2026-10-02.md','scripts/adopt-rimo-candidate-2.mjs','scripts/qa-rimo-motion.mjs','scripts/qa-rimo-happy-contact.mjs']:
    copy(ROOT/p,dest/'documentation'/Path(p).name)
for name in ['model-r10.glb','asset.json','lod-low-spec-r01.glb']:
    copy(ROOT/'public/models/rimo-neko'/name,library/'candidate-1/available-delivery-20261002'/name)
record=dict(date='2026-10-02',candidate=2,decision='not-adopted; surface quality failed',files=len(records),bytes=sum(x['bytes'] for x in records),records=records,missingHistoricalSources='C1 dense and Blender source were absent on this host; only available delivery was retained')
manifest=dest/'archive-20261002.json';data=json.dumps(record,indent=2,ensure_ascii=False)+'\n'
if manifest.exists():assert manifest.read_text(encoding='utf8')==data
else:manifest.write_text(data,encoding='utf8')
(ROOT/'assets/rimo-neko/archive-quality-20261002.json').write_text(json.dumps({k:v for k,v in record.items() if k!='records'}|dict(archive=str(dest),manifestSha256=sha(manifest)),indent=2,ensure_ascii=False)+'\n',encoding='utf8')
print(json.dumps(dict(files=record['files'],bytes=record['bytes'],archive=str(dest),manifestSha256=sha(manifest))))
