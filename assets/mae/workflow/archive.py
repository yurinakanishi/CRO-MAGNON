"""Copy this new model into its canonical library without overwriting any file."""
import hashlib
import json
import shutil
from pathlib import Path

ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
target=(ROOT.parent/'threed-model-creation/models/mae').resolve()
expected=(ROOT.parent/'threed-model-creation/models').resolve()
assert target.parent==expected and target.name=='mae'
if target.exists():raise RuntimeError('The mae archive already exists; do not overwrite it')
records=[]
sources=[(ROOT/'output/model-generation/models/mae',target),
         (ROOT/'assets/mae',target/'game-adoption'),
         (ROOT/'public/models/mae',target/'delivery')]
game=json.loads((ROOT/'assets/mae/game-qa.json').read_text(encoding='utf-8'))
assert game['passed']
sources.append((ROOT/'output/playwright/mae',target/'qa/game-runs'))
for source,dest in sources:
    for path in sorted(source.rglob('*')):
        if not path.is_file() or '__pycache__' in path.parts:continue
        rel=path.relative_to(source);out=dest/rel
        out.parent.mkdir(parents=True,exist_ok=True)
        with out.open('xb') as handle:handle.write(path.read_bytes())
        digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
        sha=digest(path)
        assert digest(out)==sha
        records.append(dict(path=str(out.relative_to(target)),bytes=path.stat().st_size,sha256=sha))
for source,name in [(ROOT/'scripts/qa-mae.mjs','qa-mae.mjs'),(ROOT/'scripts/qa-mae-contact.mjs','qa-mae-contact.mjs'),
                    (ROOT/'docs/mae-2026-10-03.md','README.md')]:
    out=target/name
    with out.open('xb') as handle:handle.write(source.read_bytes())
    assert out.read_bytes()==source.read_bytes()
    records.append(dict(path=name,bytes=out.stat().st_size,sha256=hashlib.sha256(out.read_bytes()).hexdigest()))
record=dict(target=str(target),verified=True,files=len(records),bytes=sum(r['bytes'] for r in records),records=records)
(target/'archive-manifest.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
asset=json.loads((ROOT/'public/models/mae/asset.json').read_text(encoding='utf-8'))
(target/'model.json').write_text(json.dumps(dict(modelKey='mae',candidate=1,revision='01',status='integrated-reviewed-prototype',
    sha256=asset['sha256'],reference='source/reference-v1.png',userReference='source/mae.jpg',
    candidateFile='work/rig/revision-01/candidate.glb',delivery='delivery/model-r01.glb',
    preview='qa/final-01/viewer.html',gameQa='game-adoption/game-qa.json'),ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(ROOT/'assets/mae/library-archive.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in record.items() if k!='records'},ensure_ascii=False))
