"""Serial TRELLIS-2 queue for the 2026-10 asset remake (one GPU job at a time).

Jobs are JSON files in output/asset-remake/trellis-queue/pending/*.json:
  {"key": "woolly-mammoth", "candidate": 2, "reference": "<abs png>", "seed": 42,
   "res": 1024, "texRes": 1024, "tag": "ref2b"}
Each job: BiRefNet matte -> square conditioning -> TRELLIS dense GLB under
models/<key>/work/candidate-02/trellis/. Provenance JSON next to every output.
The runner exits after IDLE_EXIT seconds without pending jobs.
"""
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from PIL import Image

REMAKE = Path(__file__).resolve().parents[2]  # repository root
MODELS = Path(r'C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models')
STUDIO = Path(r'C:/Users/yurin/Desktop/projects/threed-model-creation/trellis-studio')
CLI = STUDIO / 'runtime/trellis-cli.exe'
QUEUE = REMAKE / 'output/asset-remake/trellis-queue'
LOCK = MODELS / 'world-trellis.lock'
IDLE_EXIT = int(os.environ.get('IDLE_EXIT', '1800'))


def sha(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def write(path, data):
    Path(path).write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def run(command, log):
    started = time.monotonic()
    with open(log, 'w', encoding='utf-8') as stream:
        result = subprocess.run([str(x) for x in command], stdout=stream, stderr=subprocess.STDOUT,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if result.returncode:
        raise RuntimeError(f'{Path(log).stem} failed ({result.returncode}); see {log}')
    return round(time.monotonic() - started, 2)


def prepare(job, cand):
    tag = job['tag']
    prepared = cand / f'source/prepared-{tag}'
    prepared.mkdir(parents=True, exist_ok=True)
    conditioning = prepared / 'conditioning.png'
    if conditioning.exists():
        return conditioning
    source = Path(job['reference'])
    rgba_in = Image.open(source)
    if rgba_in.mode == 'RGBA' and np.asarray(rgba_in)[:, :, 3].min() < 250 and job.get('useAlpha', True):
        cutout = prepared / 'supplied-alpha.png'
        rgba_in.save(cutout)
    else:
        raw = prepared / 'birefnet.glb'
        run([CLI, '--image', source, '--output', raw, '--models', STUDIO / 'models', '--bg-removal', 'birefnet',
             '--bg-only', '--dump-bg'], prepared / 'birefnet.log')
        cutout = next(prepared.glob('*cutout*.png'))
    rgba = Image.open(cutout).convert('RGBA')
    alpha = np.asarray(rgba)[:, :, 3]
    ys, xs = np.nonzero(alpha > 8)
    assert len(xs) > 100, 'Empty or nearly empty source matte'
    bounds = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject = rgba.crop(bounds)
    span = round(max(subject.size) / .89)
    canvas = Image.new('RGBA', (span, span), (255, 255, 255, 0))
    canvas.paste(subject, ((span - subject.width) // 2, (span - subject.height) // 2))
    canvas = canvas.resize((1024, 1024), Image.Resampling.LANCZOS)
    canvas.save(conditioning)
    canvas.getchannel('A').save(prepared / 'matte.png')
    write(prepared / 'preparation.json', {
        'source': str(source), 'source_sha256': sha(source), 'conditioning_sha256': sha(conditioning),
        'cutout_sha256': sha(cutout), 'bbox': bounds, 'margin_fraction': .055, 'size': [1024, 1024],
        'method': 'Local BiRefNet alpha matte (or supplied alpha), crop, uniform fit, transparent square padding.'})
    return conditioning


def process(job_path):
    job = json.loads(job_path.read_text(encoding='utf-8'))
    key, cnum = job['key'], int(job.get('candidate', 2))
    cand = MODELS / key / f'work/candidate-{cnum:02d}'
    (cand / 'trellis').mkdir(parents=True, exist_ok=True)
    res, tex, seed, tag = job.get('res', 1024), job.get('texRes', 1024), job.get('seed', 42), job['tag']
    dense = cand / f'trellis/dense-{tag}-res{res}-tex{tex}-seed{seed:04d}.glb'
    if dense.exists():
        return {'status': 'exists', 'dense': str(dense)}
    conditioning = prepare(job, cand)
    command = [CLI, '--image', conditioning, '--output', dense, '--models', STUDIO / 'models', '--seed', seed,
               '--res', res, '--gpu', 0, '--require-gpu', '--xatlas', '--webp', 'off', '--tex-res', tex]
    for extra in job.get('extraArgs', []):
        command.append(extra)
    seconds = run(command, dense.with_suffix('.log'))
    assert dense.read_bytes()[:4] == b'glTF'
    record = {'author': 'Claude Code (Opus 5.5)', 'claude_used': True, 'seed': seed, 'resolution': res,
              'texture_resolution': tex, 'reference': job['reference'], 'reference_sha256': sha(job['reference']),
              'conditioning': {'path': str(conditioning.relative_to(MODELS / key)), 'sha256': sha(conditioning)},
              'output': {'path': str(dense.relative_to(MODELS / key)), 'sha256': sha(dense), 'bytes': dense.stat().st_size},
              'seconds': seconds, 'command': [str(x).replace(str(MODELS / key), '<model>').replace(str(STUDIO), '<trellis-studio>') for x in command],
              'finished': datetime.now(timezone.utc).isoformat()}
    write(dense.with_suffix('.json'), record)
    return {'status': 'dense-ready', 'dense': str(dense), 'seconds': seconds}


def main():
    for sub in ('pending', 'running', 'done', 'failed'):
        (QUEUE / sub).mkdir(parents=True, exist_ok=True)
    idle_since = time.monotonic()
    while True:
        jobs = sorted((QUEUE / 'pending').glob('*.json'))
        if not jobs:
            if time.monotonic() - idle_since > IDLE_EXIT:
                break
            time.sleep(10)
            continue
        while LOCK.exists():  # another session owns the GPU
            time.sleep(20)
        job = jobs[0]
        running = QUEUE / 'running' / job.name
        shutil.move(job, running)
        LOCK.write_text(json.dumps({'pid': os.getpid(), 'job': job.name, 'owner': 'asset-remake',
                                    'started': datetime.now(timezone.utc).isoformat()}))
        try:
            result = process(running)
            target = QUEUE / 'done' / job.name
        except Exception as error:  # keep failure evidence, continue the queue
            result = {'status': 'failed', 'error': str(error)}
            target = QUEUE / 'failed' / job.name
        finally:
            LOCK.unlink(missing_ok=True)
        data = json.loads(running.read_text(encoding='utf-8'))
        data['result'] = result
        write(target, data)
        running.unlink()
        idle_since = time.monotonic()
    write(QUEUE / 'runner-exit.json', {'exited': datetime.now(timezone.utc).isoformat()})


if __name__ == '__main__':
    sys.exit(main())
