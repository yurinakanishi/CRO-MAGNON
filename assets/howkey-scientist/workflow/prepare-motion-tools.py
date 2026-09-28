"""Create model-local derivatives of the game's measured-motion authoring tools."""
from pathlib import Path
import hashlib,json
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
OUT=Path(__file__).resolve().parent
def change(text,old,new):
    assert old in text,old[:80]
    return text.replace(old,new)
src=ROOT/'scripts/build-human-locomotion.mjs';s=src.read_text(encoding='utf8')
s=change(s,"from './motion-glb.mjs'","from '../../../scripts/motion-glb.mjs'")
s=change(s,"from './cmu-motion.mjs'","from '../../../scripts/cmu-motion.mjs'")
a=s.index('export const HUMAN_KEYS');b=s.index('const v =',a)
s=s[:a]+"const HUMAN_KEYS=['howkey-scientist'];\nconst revision=process.argv[2]||'02', input=process.argv[3]||'01';\nconst out=`output/model-generation/models/howkey-scientist/work/motion/revision-${revision}`;\n"+s[b:]
a=s.index("await mkdir('assets/human-locomotion/source-manifests'");b=s.index('  assert.equal(hash(g.bytes)',a)
s=s[:a]+"for (const key of HUMAN_KEYS) {\n  const asset=await json(`output/model-generation/models/howkey-scientist/work/rig/revision-${input}/asset.json`), g=await loadMotion(asset.url);\n"+s[b:]
# Body motion is measured. The six cloth/hair secondary joints only add a
# restrained periodic response; their parents still carry the actual motion.
s=change(s,'      updateSkin();\n      const height =',"""      const cycle=f/source.samples.length*Math.PI*2;
      for (const side of ['L','R']) {
        const sign=side==='L'?1:-1;
        for (const panel of ['Front','Back']) {
          const b=bone('Coat'+panel+side);
          b.quaternion.multiply(q().setFromAxisAngle(new T.Vector3(1,0,0),Math.sin(cycle+sign*.4)*(source.name==='Run_Loop'?.025:.012)));
        }
        bone('Hair'+side).quaternion.multiply(q().setFromAxisAngle(new T.Vector3(1,0,0),Math.sin(cycle-.6)*.022));
      }
      updateSkin();
      const height =""")
s=change(s,'  asset.sha256 = hash(bytes);','  asset.url = `${dir}/model.glb`;\n  asset.sha256 = hash(bytes);')
(OUT/'retarget-human.mjs').write_text(s,encoding='utf8')
lineage=[dict(source=str(src.relative_to(ROOT)),sha256=hashlib.sha256(src.read_bytes()).hexdigest(),derivative='retarget-human.mjs')]
src=ROOT/'scripts/build-downed-motion.mjs';s=src.read_text(encoding='utf8')
s=change(s,"from './motion-glb.mjs'","from '../../../scripts/motion-glb.mjs'")
s=change(s,"from '../dist/src/riding-pose.js'","from '../../../dist/src/riding-pose.js'")
s=change(s,"import { CHARACTER_MODELS } from '../dist/shared/characters.mjs';","const CHARACTER_MODELS=[{key:'howkey-scientist'}];\nconst revision=process.argv[2]||'03', sourceRevision=process.argv[3]||'02';")
s=change(s,"const base = 'output/downed-motion';","const base = `output/model-generation/models/howkey-scientist/work/final/revision-${revision}`;")
a=s.index('  const current =');b=s.index('  const gltf =',a)
s=s[:a]+"  const asset=JSON.parse(await readFile(`output/model-generation/models/howkey-scientist/work/motion/revision-${sourceRevision}/${key}/asset.json`,'utf8'));\n  const source=asset.url;\n"+s[b:]
s=change(s,'    url: `/models/${key}/model-downed-r01.glb`,','    url: `${folder}/model-downed-r01.glb`,')
s=change(s,"      review: 'assets/downed-motion/README.md',","      review: 'assets/howkey-scientist/README.md',")
s=change(s,"await writeFile(`${folder}/model-downed-r01.glb`, bytes);","await writeFile(`${folder}/model-downed-r01.glb`, bytes, {flag:'wx'});")
(OUT/'build-downed.mjs').write_text(s,encoding='utf8')
lineage.append(dict(source=str(src.relative_to(ROOT)),sha256=hashlib.sha256(src.read_bytes()).hexdigest(),derivative='build-downed.mjs'))
(OUT/'motion-tool-lineage.json').write_text(json.dumps(lineage,indent=2)+'\n',encoding='utf8')
src=ROOT/'scripts/verify-human-locomotion.mjs';s=src.read_text(encoding='utf8')
s=change(s,"from './motion-glb.mjs'","from '../../../scripts/motion-glb.mjs'")
s=change(s,"from '../dist/src/locomotion-grounding.js'","from '../../../dist/src/locomotion-grounding.js'")
a=s.index('const keys =');b=s.index('const v =',a)
s=s[:a]+"const keys=['howkey-scientist'];\n"+s[b:]
s=change(s,'`output/player-gaits/${revision}/${key}`','`output/model-generation/models/howkey-scientist/work/motion/revision-${revision}/${key}`')
s=change(s,"await loadMotion('public' + asset.humanLocomotion.sourceDelivery)","await loadMotion(asset.humanLocomotion.sourceDelivery)")
a=s.index('  const manifest =');b=s.index('  const feet =',a);s=s[:a]+s[b:]
s=change(s,'`output/player-gaits/${revision}/human-validation.json`','`output/model-generation/models/howkey-scientist/work/motion/revision-${revision}/human-validation.json`')
(OUT/'verify-human.mjs').write_text(s,encoding='utf8')
lineage.append(dict(source=str(src.relative_to(ROOT)),sha256=hashlib.sha256(src.read_bytes()).hexdigest(),derivative='verify-human.mjs'))
(OUT/'motion-tool-lineage.json').write_text(json.dumps(lineage,indent=2)+'\n',encoding='utf8')
print('Prepared source-preserving Howkey motion tools')
