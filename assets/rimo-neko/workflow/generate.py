"""Reconstruct the retained Rimo-neko reference with the installed TRELLIS-2.

One candidate; never overwrite a completed dense GLB. Heavy GPU work is serial.
"""
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
MODEL = ROOT / 'output/model-generation/models/rimo-neko'
SOURCE = ROOT / 'assets/rimo-neko/source/reference-v1.png'
STUDIO = ROOT.parent / 'threed-model-creation/trellis-studio'
CLI = STUDIO / 'runtime/trellis-cli.exe'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(args, log):
    started = time.monotonic()
    print(json.dumps({'stage': log.stem, 'log': str(log)}), flush=True)
    with log.open('w', encoding='utf-8') as output:
        result = subprocess.run([str(x) for x in args], stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{log.stem}: exit {result.returncode}; see {log}')
    return time.monotonic() - started

def main():
    prepared = MODEL / 'source/prepared'
    dense = MODEL / 'work/trellis/dense-res1024-seed0042.glb'
    prepared.mkdir(parents=True, exist_ok=True)
    dense.parent.mkdir(parents=True, exist_ok=True)
    if dense.exists():
        raise RuntimeError('A dense candidate already exists; inspect it without overwriting it.')
    cutout = prepared / 'reference_cutout.png'
    if not cutout.exists():
        run([CLI, '--image', SOURCE, '--output', prepared / 'reference.glb', '--models', STUDIO / 'models',
             '--bg-removal', 'birefnet', '--bg-only', '--gpu', 0, '--require-gpu', '--seed', 42], prepared / 'birefnet.log')
    command = [CLI, '--image', cutout, '--output', dense, '--models', STUDIO / 'models', '--model', 'trellis',
               '--seed', 42, '--res', 1024, '--tex-res', 1024, '--gpu', 0, '--require-gpu', '--xatlas', '--webp', 'off']
    seconds = run(command, dense.with_suffix('.log'))
    if dense.read_bytes()[:4] != b'glTF':
        raise RuntimeError('Invalid output header')
    record = dict(candidate=1, status='dense-generated; not rigged or adopted', provider='Codex, built-in imagegen and local TRELLIS-2',
                  claudeUsed=False, runtimeRelease='v0.8.1', runtimeSha256=sha(CLI), referenceSha256=sha(SOURCE),
                  conditioningSha256=sha(cutout), source=str(dense), sha256=sha(dense), bytes=dense.stat().st_size,
                  seed=42, resolution=1024, textureResolution=1024, seconds=seconds, command=[str(x) for x in command])
    dense.with_suffix('.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
