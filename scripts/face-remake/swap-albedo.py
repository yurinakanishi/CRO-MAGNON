"""Write a copy of a single-primitive GLB whose base-colour image is replaced by a PNG (preview of projected albedo).

python scripts/face-remake/swap-albedo.py <in.glb> <albedo.png> <out.glb>
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from glbio import Builder, Glb  # noqa: E402

src, png, dst = sys.argv[1:4]
g = Glb(src)
doc = g.doc
old_views = doc['bufferViews']
mat = doc['materials'][doc['meshes'][0]['primitives'][0]['material']]
image_id = g.texture_image(mat['pbrMetallicRoughness']['baseColorTexture']['index'])
b = Builder(doc)
remap = {}
for i, v in enumerate(old_views):
    data = Path(png).read_bytes() if i == doc['images'][image_id]['bufferView'] else g.view_bytes(i)
    remap[i] = b.add_view(data, v.get('target'))
    if 'byteStride' in v:
        b.doc['bufferViews'][-1]['byteStride'] = v['byteStride']
b.doc['images'][image_id]['mimeType'] = 'image/png'
b.write(dst)
print('wrote', dst)
