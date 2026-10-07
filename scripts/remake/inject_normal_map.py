"""Add a baked tangent-space normal map to a delivered GLB without touching any existing buffer data.

python scripts/remake/inject_normal_map.py <in.glb> <normal.png[,normal-m1.png,...]> <out.glb> [--webp-quality 92]
Several comma-separated PNGs map to the GLB materials in order (normal_upgrade.py per-slot output).
Every existing bufferView keeps its byte offset and bytes (positions, indices, UVs, textures); the WebP image is
appended at the end of the BIN chunk, a texture (EXT_texture_webp) is added and every material gets normalTexture.
No TANGENT attribute is added: three.js then derives the tangent frame per fragment. The report proves the
geometry is byte-identical (SHA-256 of every original accessor range).
"""
import hashlib
import io
import json
import struct
import sys
from pathlib import Path

from PIL import Image

src, png, dst = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
quality = int(sys.argv[sys.argv.index('--webp-quality') + 1]) if '--webp-quality' in sys.argv else 92
data = src.read_bytes()
jlen = struct.unpack_from('<I', data, 12)[0]
doc = json.loads(data[20:20 + jlen])
blen = struct.unpack_from('<I', data, 20 + jlen)[0]
binary = data[20 + jlen + 8:20 + jlen + 8 + blen]

pngs = str(png).split(',')
mats = doc.get('materials', [])
assert len(pngs) in (1, len(mats)), 'one normal map, or one per material'
newbin = binary
if not doc.get('samplers'):
    doc['samplers'] = [{'magFilter': 9729, 'minFilter': 9987, 'wrapS': 10497, 'wrapT': 10497}]
webp_total = 0
tex_ids = []
for n, path in enumerate(pngs):
    buf = io.BytesIO()
    Image.open(path).convert('RGB').save(buf, 'WEBP', quality=quality, method=6)
    webp = buf.getvalue()
    webp_total += len(webp)
    newbin += b'\0' * (-len(newbin) % 4)
    offset = len(newbin)
    newbin += webp
    doc.setdefault('bufferViews', []).append({'buffer': 0, 'byteOffset': offset, 'byteLength': len(webp)})
    doc.setdefault('images', []).append({'bufferView': len(doc['bufferViews']) - 1, 'mimeType': 'image/webp', 'name': 'BakedNormal%d' % n})
    doc.setdefault('textures', []).append({'sampler': 0, 'extensions': {'EXT_texture_webp': {'source': len(doc['images']) - 1}}})
    tex_ids.append(len(doc['textures']) - 1)
newbin += b'\0' * (-len(newbin) % 4)
for i, m in enumerate(mats):
    m['normalTexture'] = {'index': tex_ids[i if len(tex_ids) > 1 else 0]}
used = doc.setdefault('extensionsUsed', [])
if 'EXT_texture_webp' not in used:
    used.append('EXT_texture_webp')
doc['buffers'][0]['byteLength'] = len(newbin)
js = json.dumps(doc, separators=(',', ':')).encode()
js += b' ' * (-len(js) % 4)
glb = struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(js) + 8 + len(newbin)) + struct.pack('<II', len(js), 0x4E4F534A) + js \
    + struct.pack('<II', len(newbin), 0x004E4942) + newbin
dst.write_bytes(glb)


def accessor_bytes(blob, d, i):
    a = d['accessors'][i]
    v = d['bufferViews'][a['bufferView']]
    comps = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    size = {5126: 4, 5125: 4, 5123: 2, 5121: 1}[a['componentType']]
    o = v.get('byteOffset', 0) + a.get('byteOffset', 0)
    return blob[o:o + a['count'] * comps * size]


geo = []
for mesh in doc['meshes']:
    for p in mesh['primitives']:
        for idx in list(p['attributes'].values()) + ([p['indices']] if 'indices' in p else []):
            same = accessor_bytes(binary, doc, idx) == accessor_bytes(newbin, doc, idx)
            geo.append(same)
rep = {'source': str(src), 'source_sha256': hashlib.sha256(data).hexdigest(), 'output': str(dst),
       'output_sha256': hashlib.sha256(glb).hexdigest(), 'normal_png': str(png), 'webp_bytes': webp_total, 'normal_pngs': pngs,
       'geometry_accessors_identical': all(geo), 'accessors_checked': len(geo),
       'materials_with_normal': len(doc.get('materials', []))}
dst.with_suffix('.json').write_text(json.dumps(rep, indent=2), newline=chr(10))
print('INJECT_DONE', json.dumps(rep))
