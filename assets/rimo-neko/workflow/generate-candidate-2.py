"""One new Rimo-neko reconstruction; retain every input and failed attempt.

Uses the locally installed CLI's --help contract. The C1 recipe belongs to a
different runtime and must not be silently reused (notably its --model flag).
"""
import hashlib
import json
import subprocess
import time
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
MODEL = ROOT / 'output/model-generation/models/rimo-neko/candidate-2'
SOURCE = ROOT / 'assets/rimo-neko/source/reference-v2.png'
STUDIO = ROOT.parent / 'threed-model-creation/trellis-studio'
CLI = STUDIO / 'runtime/trellis-cli.exe'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    dense = MODEL / 'work/trellis/dense-res1024-seed0042.glb'
    dense.parent.mkdir(parents=True, exist_ok=True)
    if dense.exists():
        raise RuntimeError('Preserve the completed dense candidate; do not overwrite.')
    attempt = 1
    while dense.with_suffix(f'.attempt-{attempt:02}.json').exists():
        attempt += 1
    log = dense.with_suffix(f'.attempt-{attempt:02}.log')
    record_path = dense.with_suffix(f'.attempt-{attempt:02}.json')
    command = [str(CLI), '--image', str(SOURCE), '--output', str(dense),
               '--models', str(STUDIO / 'models'), '--res', '1024', '--seed', '42',
               '--tex-res', '1024', '--atlas', '2048',
               '--gpu', '0', '--require-gpu', '--xatlas', '--webp', 'off', '--threads', '8']
    record = dict(candidate=2, attempt=attempt, status='running',
                  provider='Codex, built-in imagegen and local TRELLIS-2', claudeUsed=False,
                  runtimeSha256=sha(CLI), referenceSha256=sha(SOURCE),
                  originalSha256=sha(ROOT / 'assets/rimo-neko/source/user-reference.jpg'),
                  command=command, source=str(dense), resolution=1024,
                  textureResolution=1024, atlas=2048, seed=42,
                  preprocessing='Already transparent imagegen input; preserve its alpha',
                  simplification='Installed CLI default quadric reduction to 300K faces; further reduction measured separately')
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    started = time.monotonic()
    with log.open('w', encoding='utf-8') as output:
        result = subprocess.run(command, stdout=output, stderr=subprocess.STDOUT)
    record.update(seconds=time.monotonic()-started, exitCode=result.returncode,
                  status='failed' if result.returncode else 'dense-generated; not rigged or adopted')
    if result.returncode == 0 and dense.is_file():
        assert dense.read_bytes()[:4] == b'glTF'
        record.update(sha256=sha(dense), bytes=dense.stat().st_size)
    record_path.write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print(json.dumps(record, ensure_ascii=False), flush=True)
    if result.returncode:
        raise SystemExit(result.returncode)

if __name__ == '__main__':
    main()
