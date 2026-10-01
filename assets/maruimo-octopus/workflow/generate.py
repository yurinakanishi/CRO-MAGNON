"""Reconstruct the retained Maruimo reference; keep every attempt and its log."""
import argparse
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
MODEL = ROOT / 'output/model-generation/models/maruimo-octopus'
STUDIO = ROOT.parent / 'threed-model-creation/trellis-studio'
CLI = STUDIO / 'runtime/trellis-cli.exe'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def run(command, log):
    started = time.monotonic()
    print(json.dumps(dict(stage=log.stem, log=str(log))), flush=True)
    with log.open('w', encoding='utf-8') as output:
        result = subprocess.run([str(x) for x in command], stdout=output, stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{log.stem}: exit {result.returncode}; see {log}')
    return time.monotonic() - started

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', default='03')
    parser.add_argument('--reference', default='assets/maruimo-octopus/source/reference-v2.png')
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    source = ROOT / args.reference
    required = ['dinov3','ss_flow','ss_dec','shape_flow_512','shape_flow_1024',
                'shape_dec','tex_flow_1024','tex_dec']
    missing = [name for name in required if not (STUDIO/'models'/(name+'.gguf')).is_file()]
    if missing and not args.prepare_only:
        raise RuntimeError('Missing runtime model files: ' + ', '.join(missing))
    prepared = MODEL / ('source/prepared-' + args.attempt)
    dense = MODEL / ('work/trellis/dense-attempt-' + args.attempt + '-res1024-seed0042.glb')
    prepared.mkdir(parents=True, exist_ok=True)
    dense.parent.mkdir(parents=True, exist_ok=True)
    if dense.exists():
        raise RuntimeError('A dense candidate exists; inspect it without overwriting it.')
    cutout = prepared / 'reference_cutout.png'
    if not cutout.exists():
        run([CLI, '--image', source, '--output', prepared / 'reference.glb', '--models', STUDIO / 'models',
             '--bg-only', '--gpu', 0, '--require-gpu', '--seed', 42], prepared / 'alpha-prepare.log')
    if args.prepare_only:
        print(str(cutout), flush=True)
        return
    command = [CLI, '--image', cutout, '--output', dense, '--models', STUDIO / 'models',
               '--seed', 42, '--res', 1024, '--tex-res', 1024, '--atlas', 4096,
               '--gpu', 0, '--require-gpu', '--xatlas', '--webp', 'off']
    seconds = run(command, dense.with_suffix('.log'))
    if dense.read_bytes()[:4] != b'glTF':
        raise RuntimeError('Invalid output header')
    record = dict(candidate=1, status='dense-generated; not rigged or adopted',
                  provider='Codex built-in imagegen and local TRELLIS-2', attempt=args.attempt,
                  runtimeSha256=sha(CLI), referenceSha256=sha(source), conditioningSha256=sha(cutout),
                  source=str(dense), sha256=sha(dense), bytes=dense.stat().st_size,
                  seed=42, resolution=1024, textureResolution=1024, atlasResolution=4096,
                  modelFiles={name:sha(STUDIO/'models'/(name+'.gguf')) for name in required},
                  seconds=seconds, command=[str(x) for x in command])
    dense.with_suffix('.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False), flush=True)

if __name__ == '__main__':
    main()
