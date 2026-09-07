"""Preserve the supplied image and prepare the replacement model workspace."""
from pathlib import Path
import hashlib, json, shutil

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / 'output/model-generation/models'
MODEL = MODELS / 'floppy-ear-mage'
SOURCE = Path('C:/Users/yurin/Downloads/ChatGPT Image Sep 8, 2026, 12_13_47 AM.png')
REFERENCE = Path('C:/Users/yurin/.codex/generated_images/01a07c6e-e5d6-7ee0-857d-b345a3aa2807/exec-63d8fb20-203c-44aa-95ea-63d3748085f5.png')
assert not MODEL.exists(), 'Inspect the existing candidate before resuming.'
for sub in ['source/original','source/prepared','work/trellis','work/low-poly','work/rig','workflow/current','workflow/candidate-01','qa']:
    (MODEL/sub).mkdir(parents=True, exist_ok=True)
shutil.copy2(SOURCE, MODEL/'source/original/user-original.png')
shutil.copy2(REFERENCE, MODEL/'source/original/reference-v1.png')
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
def save(p, data):
    p.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
prompt = '''Prepare ONLY the large left floppy-eared adventurer from the supplied image as a single full-body TRELLIS reference. Preserve cream face, peach drooping ears, dark eyes, pink cheeks, happy open mouth, red cape, cream embroidered tunic, gold fasteners, leather straps, satchel, gloves and boots. Translate to clean soft stylized 3D. Neutral A-pose, empty separate hands and separate legs, near-front 5-degree view, full margins, plain gray background. Omit the little companion, extra props, hat, weapons and effects. Keep identity and original clothing.'''
(MODEL/'source/original/prompt.txt').write_text(prompt+'\n', encoding='utf-8')
spec = dict(key='floppy-ear-mage', name='垂れ耳の魔法使い', kind='humanoid', height=.78, candidate=1,
    geometryResolution=1024, weapon='light-orb', referenceVersion=1,
    clips=['Idle_Loop','Walk_Loop','Run_Loop','Gather','Craft','Give','Eat','Wave','Attack'],
    replaces='bear-mage', gameplaySpecies='bear', originalImage=str(SOURCE), originalSHA256=sha(SOURCE),
    sourceSha256=sha(REFERENCE), selection='Main left subject assumed after optional clarification; user may correct before adoption.')
save(MODEL/'request-spec.json',spec)
save(MODEL/'model.json',dict(model_key=spec['key'], lifecycle_status='reference-ready', candidate=1, artifacts={'original':'source/original/user-original.png','reference':'source/original/reference-v1.png'}))
lineage=[]
for source in (MODELS/'bear-mage/workflow/candidate-01').glob('*.py'):
    target=MODEL/'workflow/candidate-01'/source.name
    shutil.copy2(source,target)
    lineage.append(dict(source=source.relative_to(ROOT).as_posix(),target=target.relative_to(MODEL).as_posix(),sha256=sha(target)))
save(MODEL/'workflow/candidate-01/tool-lineage.json',lineage)
for name in ['generate-playable-model.py','prepare-fantasy-surface.py','rig-fantasy-playable.py','validate-fantasy-glb.py','render-fantasy-qa.py','pack-fantasy-texture.py']:
    source=ROOT/'output'/name
    code=source.read_text(encoding='utf-8').replace("Path(__file__).resolve().parents[1]", "next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())")
    code=code.replace("=='bear-mage'", "=='floppy-ear-mage'").replace("== 'bear-mage'", "== 'floppy-ear-mage'")
    (MODEL/'workflow/current'/name).write_text(code,encoding='utf-8')
save(ROOT/'assets/floppy-ear-mage-request.json',dict(schemaVersion=1,userRequest='ダウンロードフォルダの最初の画像から3Dモデルを作り、小さい魔法の種族を置き換える。',
    key=spec['key'],replaces='bear-mage',candidate=1,originalImage=str(SOURCE),originalSHA256=sha(SOURCE),
    referenceImage=(MODEL/'source/original/reference-v1.png').relative_to(ROOT).as_posix(),referenceSHA256=sha(REFERENCE),
    generation='reference-ready',adoption='pending',gameQa='pending',claudeUsed=False))
print(json.dumps(dict(model=str(MODEL),status='reference-ready',candidate=1)))
