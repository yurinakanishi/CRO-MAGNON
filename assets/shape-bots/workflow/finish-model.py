"""Sequential rig and exact-export checks after the dense mesh has been inspected.

Produces evidence only. Visual review and game adoption remain explicit later steps.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
BLENDER = Path('C:/Program Files/Blender Foundation/Blender 5.2/blender.exe')
p = argparse.ArgumentParser()
p.add_argument('kind', choices=['beret', 'frog', 'triangle', 'heart'])
p.add_argument('--revision', default='01')
p.add_argument('--attempt', default='01')
p.add_argument('--skip-prepare', action='store_true')
a = p.parse_args()
workflow = ROOT / 'assets/shape-bots/workflow'
model = ROOT / ('output/model-generation/models/orb-bot-' + a.kind)
qa = model / ('qa/final-' + a.revision)
qa.mkdir(parents=True, exist_ok=True)
candidate = model / f'work/rig/revision-{a.revision}/candidate.glb'
commands = []
def run(label, command):
    log = ROOT / f'output/shape-{a.kind}-{label}-r{a.revision}.log'
    assert not log.exists(), 'Keep earlier execution logs; resume with a new revision or inspect it'
    print(json.dumps(dict(kind=a.kind, step=label, log=str(log))), flush=True)
    with log.open('w', encoding='utf8') as stream:
        subprocess.run([str(v) for v in command], cwd=ROOT, stdout=stream, stderr=subprocess.STDOUT,
                       check=True, creationflags=0x08000000)
    commands.append(dict(label=label, command=[str(v) for v in command], log=str(log)))
    (qa / 'commands.json').write_text(json.dumps(commands, indent=2) + '\n')

if not a.skip_prepare:
    run('prepare', [BLENDER, '-b', '-t', '6', '--python-exit-code', '1', '--python', workflow / 'prepare.py', '--', a.kind, '--attempt', a.attempt, '--revision', a.revision])
run('numeric', [sys.executable, workflow / 'validate.py', a.kind, '--revision', a.revision])
run('preview', [sys.executable, workflow / 'make-preview.py', a.kind, '--revision', a.revision])
for mode in ['neutral', 'clay']:
    command = [BLENDER, '-b', '-t', '6', '--python-exit-code', '1', '--python', workflow / 'render-review.py', '--', candidate, qa / mode, '--size', '640']
    if mode == 'clay': command.append('--clay')
    run(mode, command)
run('viewer', ['node', workflow / 'qa-viewer.mjs', a.kind, a.revision])
run('motion-angles', ['node', workflow / 'qa-motion-angles.mjs', a.kind, a.revision])
print(json.dumps(dict(kind=a.kind, revision=a.revision, automatedChecks='passed; manual visual review still required')), flush=True)
