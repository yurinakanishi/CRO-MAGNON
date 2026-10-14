"""Writes a candidate record (candidate.json) from a template whose file references are resolved to
their path, SHA-256 and size, so every hash in the record is computed from the files themselves.

  python scripts/remake/resolve_record.py TEMPLATE.json OUT.json --root <model workspace>

In the template, {"$file": "work/candidate-01/final/model.glb"} becomes {"path": ..., "sha256": ...,
"bytes": ...}; extra keys beside "$file" are kept ({"$file": "...", "note": "..."}). Paths are relative to
--root (the models/<key> workspace) unless they start with "output/" (repository-relative). {"$json":
"path", "pick": ["a", "b"]} inlines those keys of a JSON file (e.g. the locomotion of the final asset).
"""
import argparse
import hashlib
import json
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]

ap = argparse.ArgumentParser()
ap.add_argument('template')
ap.add_argument('out')
ap.add_argument('--root', required=True, help='the models/<key> workspace, repository-relative')
args = ap.parse_args()
root = REPO / args.root


def locate(path):
    return REPO / path if path.startswith('output/') else root / path


def resolve(value):
    if isinstance(value, dict):
        if '$file' in value:
            path = value['$file']
            data = locate(path).read_bytes()
            extra = {k: resolve(v) for k, v in value.items() if k != '$file'}
            return {'path': path, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data), **extra}
        if '$json' in value:
            data = json.loads(locate(value['$json']).read_text(encoding='utf-8'))
            for key in value.get('path', []):
                data = data[key]
            pick = value.get('pick')
            return {k: data[k] for k in pick} if pick else data
        return {k: resolve(v) for k, v in value.items()}
    if isinstance(value, list):
        return [resolve(v) for v in value]
    return value


record = resolve(json.loads(Path(args.template).read_text(encoding='utf-8')))
Path(args.out).write_text(json.dumps(record, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
data = Path(args.out).read_bytes()
print(json.dumps({'out': args.out, 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)}))
