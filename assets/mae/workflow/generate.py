"""One retained TRELLIS candidate for the mae companion."""
import argparse
import hashlib
import json
import shutil
import subprocess
import time
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
STUDIO = ROOT.parent / 'threed-model-creation/trellis-studio'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

parser = argparse.ArgumentParser()
parser.add_argument('--colour', default='mae')
parser.add_argument('--attempt', default='01')
parser.add_argument('--gpu', default='1', help='Vulkan enumeration: 1 is the verified NVIDIA RTX A1000')
parser.add_argument('--resolution', type=int, choices=[512,1024], default=512)
parser.add_argument('--runtime', default='output/orb-bots-runtime/v0.8.1-vulkan/runtime/trellis-cli.exe')
args = parser.parse_args()
model = ROOT / 'output/model-generation/models/mae'
source = ROOT / 'assets/mae/source/reference-v1.png'
cli = ROOT / args.runtime
dest = model / f'work/trellis/dense-attempt-{args.attempt}-res{args.resolution}-seed0042.glb'
dest.parent.mkdir(parents=True, exist_ok=True)
original = model / 'source'
original.mkdir(parents=True, exist_ok=True)
for src, name in [(source, 'reference-v1.png'), (ROOT / 'assets/mae/source/mae.jpg', 'mae.jpg')]:
    target = original / name
    if target.exists():
        assert sha(src) == sha(target), 'Keep original sources'
    else:
        shutil.copyfile(src, target)
assert not dest.exists(), 'Keep byte-valid attempts; use a new revision'
assert not dest.with_suffix('.log').exists(), 'Keep unsuccessful attempt logs too'
command = [str(cli), '--image', str(source), '--output', str(dest), '--models', str(STUDIO / 'models'),
           '--backend', 'Vulkan', '--gpu', args.gpu, '--require-gpu', '--seed', '42', '--res', str(args.resolution),
           '--bg-removal', 'threshold', '--tex-res', str(args.resolution), '--atlas', '4096', '--xatlas', '--webp', 'off', '--dump-bg', '--threads', '8']
record = dict(candidate=1, colour=args.colour, attempt=args.attempt, status='running',
              imageProvider='Codex built-in imagegen', geometryProvider='local TRELLIS-2 v0.8.1 official Vulkan',
              claudeUsed=False, referenceSha256=sha(source), runtimeSha256=sha(cli),
              command=command, seed=42, resolution=args.resolution, textureResolution=args.resolution, atlasResolution=4096)
dest.with_suffix('.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(dict(colour=args.colour, status='running', log=str(dest.with_suffix('.log')))), flush=True)
start = time.monotonic()
try:
    with dest.with_suffix('.log').open('w', encoding='utf-8') as log:
        result = subprocess.run(command, stdout=log, stderr=subprocess.STDOUT, creationflags=0x08000000)
except KeyboardInterrupt:
    record.update(status='interrupted; no-adoption',seconds=time.monotonic()-start)
    dest.with_suffix('.json').write_text(json.dumps(record,indent=2)+'\n')
    raise
record.update(seconds=time.monotonic()-start, exitCode=result.returncode)
if result.returncode == 0 and dest.exists() and dest.read_bytes()[:4] == b'glTF':
    record.update(status='dense-generated; visual-review-and-rig-required', sha256=sha(dest), bytes=dest.stat().st_size)
else:
    record['status'] = 'failed; no-adoption'
dest.with_suffix('.json').write_text(json.dumps(record, indent=2)+'\n')
print(json.dumps(record), flush=True)
raise SystemExit(result.returncode)
