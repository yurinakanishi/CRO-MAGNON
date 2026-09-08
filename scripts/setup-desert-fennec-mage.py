"""Start the user-selected original desert mage as a separate Candidate 1."""
from pathlib import Path
import json,shutil,hashlib
ROOT=Path(__file__).resolve().parents[1]
MODELS=ROOT/'output/model-generation/models';MODEL=MODELS/'desert-fennec-mage'
PREVIOUS=MODELS/'floppy-ear-mage/work/candidate-02'
assert not MODEL.exists()
for sub in ['source/original','source/prepared','work/trellis','work/low-poly','work/rig','workflow/current','workflow/candidate-01','qa']:(MODEL/sub).mkdir(parents=True,exist_ok=True)
source=ROOT/'output/imagegen/original-mage-candidates-20260908/02-desert-ear.png'
for name in ['reference-v1.png','user-original.png']:shutil.copy2(source,MODEL/'source/original'/name)
shutil.copy2(source.with_suffix('.prompt.txt'),MODEL/'source/original/prompt.txt')
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
def save(path,data):path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
spec=dict(key='desert-fennec-mage',name='砂耳の魔法使い',kind='humanoid',height=.78,candidate=1,geometryResolution=1024,weapon='light-orb',referenceVersion=1,
 clips=['Idle_Loop','Walk_Loop','Run_Loop','Gather','Craft','Give','Eat','Wave','Attack'],replaces='floppy-ear-mage',gameplaySpecies='bear',sourceSha256=sha(source),
 selection='User explicitly selected image candidate 2, 砂耳の旅人 / 砂漠の動物. Preserve sandy fur, upright triangular ears, fox muzzle, green irises, dark hide clothes, fur collar, bare paws and tail.')
save(MODEL/'request-spec.json',spec)
save(MODEL/'model.json',dict(model_key=spec['key'],lifecycle_status='reference-approved',candidate=1,artifacts={'reference':'source/original/reference-v1.png'}))
lineage=[]
for src in (PREVIOUS/'workflow/candidate-01').glob('*.py'):
 dst=MODEL/'workflow/candidate-01'/src.name;shutil.copy2(src,dst);lineage.append(dict(source=src.relative_to(ROOT).as_posix(),sha256=sha(dst)))
save(MODEL/'workflow/candidate-01/tool-lineage.json',lineage)
for name in ['generate-playable-model.py','prepare-fantasy-surface.py','rig-fantasy-playable.py','validate-fantasy-glb.py','render-fantasy-qa.py','pack-fantasy-texture.py','restore-source-pbr.py']:
 code=(PREVIOUS/'workflow/current'/name).read_text(encoding='utf-8')
 code=code.replace("/'work/candidate-02'",'').replace("/'work/candidate-02/request-spec.json'","/'request-spec.json'")
 code=code.replace('floppy-ear-mage','desert-fennec-mage').replace('candidate=2','candidate=1')
 code=code.replace('work/low-poly/revision-02/candidate.glb','work/low-poly/revision-01/candidate.glb')
 (MODEL/'workflow/current'/name).write_text(code,encoding='utf-8')
save(ROOT/'assets/desert-fennec-mage-request.json',dict(key=spec['key'],candidate=1,branch='codex/mage-prehistoric-clothing',userSelection='砂漠の動物 を採用',referenceImage=(MODEL/'source/original/reference-v1.png').relative_to(ROOT).as_posix(),referenceSHA256=sha(source),generation='reference-approved',adoption='pending',gameQa='pending',claudeUsed=False,cloudflareDeployment='not-performed; branch work',previous3DWork='cancelled by user; retained as unused draft'))
selectionPath=ROOT/'assets/original-mage-candidates-request.json';selection=json.loads(selectionPath.read_text(encoding='utf-8'));selection.update(status='candidate-2-selected',selected='02-desert-ear',threeDGenerationStartedForTheseCandidates=True);save(selectionPath,selection)
print(MODEL)
