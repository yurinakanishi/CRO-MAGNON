"""Repair baked tangent-space normal maps inside a GLB without touching anything else.

Selected-to-active bakes over overlapping fur/foliage/hide layers can hit the underside of a layer and store its
normal pointing away from the low surface (tangent z < 0), which shades black. Same post-process as
remake_process.py bake_into(): flip back-facing texels, then keep z >= 0.25 and renormalise. Only the images used as
normalTexture are re-encoded (WebP q92 / PNG kept as its mime type); every other byte range is copied unchanged.

python scripts/remake/repair_normal_maps.py <in.glb> <out.glb>   (writes <out>.json report)
"""
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image

src, dst = Path(sys.argv[1]), Path(sys.argv[2])
data = src.read_bytes()
jlen = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + jlen])
bin_start = 20 + jlen + 8
blen = struct.unpack_from('<I', data, 20 + jlen)[0]
binary = data[bin_start:bin_start + blen]

normal_images = set()
for m in doc.get('materials', []):
    if 'normalTexture' in m:
        t = doc['textures'][m['normalTexture']['index']]
        normal_images.add(t.get('extensions', {}).get('EXT_texture_webp', {}).get('source', t.get('source')))
views = doc['bufferViews']
replace, report = {}, []
for i in sorted(normal_images):
    im = doc['images'][i]
    v = views[im['bufferView']]
    raw = binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']]
    pil = Image.open(io.BytesIO(raw)).convert('RGB')
    px = np.asarray(pil).astype(np.float32) / 255
    n = px * 2 - 1
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    back = n[:, :, 2] < 0
    n[back] *= -1
    low = n[:, :, 2] < .25
    n[low, 2] = .25
    n /= np.maximum(np.linalg.norm(n, axis=2, keepdims=True), 1e-6)
    out = Image.fromarray(np.clip(np.round((n * .5 + .5) * 255), 0, 255).astype(np.uint8))
    buf = io.BytesIO()
    if im.get('mimeType') == 'image/webp':
        out.save(buf, 'WEBP', quality=92, method=6)
    else:
        out.save(buf, 'PNG')
    replace[im['bufferView']] = buf.getvalue()
    report.append({'image': i, 'name': im.get('name'), 'size': list(pil.size), 'flipped_texels': int(back.sum()),
                   'clamped_texels': int(low.sum()), 'bytes_before': v['byteLength'], 'bytes_after': len(buf.getvalue())})
# Rebuild the binary chunk: views in original order, 4-byte aligned.
chunks, off = [], 0
order = sorted(range(len(views)), key=lambda k: views[k].get('byteOffset', 0))
new_offsets = {}
for k in order:
    v = views[k]
    b = replace.get(k, binary[v.get('byteOffset', 0):v.get('byteOffset', 0) + v['byteLength']])
    pad = -off % 4
    chunks.append(b'\0' * pad)
    off += pad
    new_offsets[k] = (off, len(b))
    chunks.append(b)
    off += len(b)
for k, (o, n) in new_offsets.items():
    views[k]['byteOffset'] = o
    views[k]['byteLength'] = n
newbin = b''.join(chunks)
newbin += b'\0' * (-len(newbin) % 4)
doc['buffers'][0]['byteLength'] = len(newbin)
js = json.dumps(doc, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(newbin)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
    + struct.pack('<II', len(newbin), 0x004E4942) + newbin
dst.write_bytes(glb)
rep = {'source': str(src), 'source_sha256': hashlib.sha256(data).hexdigest(), 'output': str(dst),
       'output_sha256': hashlib.sha256(glb).hexdigest(), 'images': report,
       'method': 'flip tangent-space normals with z<0, clamp z>=0.25, renormalise; other buffers unchanged'}
dst.with_suffix('.json').write_text(json.dumps(rep, indent=2), newline='\n')
print('REPAIR_DONE', json.dumps(rep))
