"""A later revision's record from an adopted candidate record: the same production (reconstruction, textures,
skin material) and a new rig, motion folder and final GLB, every new file with its SHA-256.

  python scripts/remake/revise_record.py WORKSPACE RECORD.json OUT.json --revision c1-r02 --rig rig/r02
      --motion output/asset-remake/motion/<key>-r02 --final final-r02 --options "<rig options>"
      [--centred graft/merged-skin-centred.glb] --reason "<why>"

WORKSPACE is models/<key>; the paths after it are relative to WORKSPACE/work/candidate-NN (the record's folder).
"""
import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument('workspace')
ap.add_argument('record')
ap.add_argument('out')
ap.add_argument('--revision', required=True)
ap.add_argument('--rig', required=True)
ap.add_argument('--motion', required=True)
ap.add_argument('--final', required=True)
ap.add_argument('--options', required=True)
ap.add_argument('--centred', default='')
ap.add_argument('--reason', required=True)
args = ap.parse_args()
workspace = REPO / args.workspace
record_path = Path(args.record)
work = record_path.resolve().parent
record = json.loads(record_path.read_text(encoding='utf-8'))


def f(path):
    full = work / path
    data = full.read_bytes()
    return {'path': str(full.relative_to(workspace)).replace('\\', '/'), 'sha256': hashlib.sha256(data).hexdigest(),
            'bytes': len(data)}


previous = {'revision': record.get('revision', 'c1-r01'), 'final': record['final'], 'rig': record['rig']}
record['revision'] = args.revision
record['revisionReason'] = args.reason
if args.centred:
    centred = json.loads((work / Path(args.centred).with_suffix('.json')).read_text(encoding='utf-8'))
    record['centred'] = dict(f(args.centred), script='scripts/remake/centre_on_feet.py', shiftMetres=centred['shiftMetres'])
record['rig'] = dict(record['rig'], report=f(f'{args.rig}/rig-report.json'), candidate=f(f'{args.rig}/candidate.glb'),
                     options=args.options)
final_asset = json.loads((work / args.final / 'asset.json').read_text(encoding='utf-8'))
record['motion'] = dict(record.get('motion', {}), folder=args.motion, locomotion=final_asset['locomotion'])
record['final'] = dict(record['final'], glb=f(f'{args.final}/model.glb'), asset=f(f'{args.final}/asset.json'),
                       lodUnused=f(f'{args.final}/lod-performance-unused.glb'))
record['previousRevision'] = previous
Path(args.out).write_text(json.dumps(record, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
data = Path(args.out).read_bytes()
print(json.dumps({'out': args.out, 'sha256': hashlib.sha256(data).hexdigest()}))
