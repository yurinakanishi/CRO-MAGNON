"""Check final GLB geometry, UV, skin and animation arrays against pre-padding GLB."""
import json, sys
from pathlib import Path
import numpy as np
ROOT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file())
sys.path.insert(0,str(ROOT.parent/'threed-model-creation/trellis.cpp/tools'))
from glb_metrics import parse_glb, read_accessor
revisions=json.loads((ROOT/'assets/orb-bots/revisions.json').read_text())
records=[]
for colour,revision in revisions.items():
    folder=ROOT/f'output/model-generation/models/orb-bot-{colour}/work/rig'
    new=folder/f'revision-{revision}'
    rig=json.loads((new/'rig.json').read_text())
    old=folder/f'revision-{rig["paddingRevisionFrom"]}'
    a,ab=parse_glb(str(old/'candidate.glb'));b,bb=parse_glb(str(new/'candidate.glb'))
    assert len(a['accessors'])==len(b['accessors'])
    for index in range(len(a['accessors'])):
        assert np.array_equal(read_accessor(a,ab,index),read_accessor(b,bb,index)),(colour,index)
    for key in ['meshes','nodes','skins','animations']:
        assert a[key]==b[key],(colour,key)
    assert (old/'lod.glb').read_bytes()==(new/'lod.glb').read_bytes()
    records.append(dict(colour=colour,revision=revision,previous=rig['paddingRevisionFrom'],
                        identicalAccessors=len(a['accessors']),meshesNodesSkinsAnimationsExact=True,lodBytesExact=True))
(ROOT/'assets/orb-bots/padding-preservation.json').write_text(json.dumps(records,indent=2)+'\n')
print(json.dumps(records))
