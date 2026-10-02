"""Resize embedded textures only. Keep geometry, UVs, skins and clips byte exact.

Usage: python scripts/optimize-public-glb.py input.glb output.glb maximum_edge
The caller records source/output SHA-256 and publishes content-addressed URLs.
"""
import io
import json
import pathlib
import struct
import sys
from PIL import Image

source, target, edge = sys.argv[1], sys.argv[2], int(sys.argv[3])
raw = pathlib.Path(source).read_bytes()
assert raw[:4] == b"glTF" and struct.unpack_from("<I", raw, 4)[0] == 2
json_size = struct.unpack_from("<I", raw, 12)[0]
doc = json.loads(raw[20:20 + json_size])
binary = raw[28 + json_size:]
assert len(doc["buffers"]) == 1
replacements, images = {}, []
for image in doc.get("images", []):
    assert "uri" not in image, "External images are forbidden"
    index = image["bufferView"]
    view = doc["bufferViews"][index]
    start = view.get("byteOffset", 0)
    original = binary[start:start + view["byteLength"]]
    with Image.open(io.BytesIO(original)) as pixels:
        before = pixels.size
        if max(before) <= edge:
            continue
        pixels.thumbnail((edge, edge), Image.Resampling.LANCZOS)
        encoded = io.BytesIO()
        pixels.save(encoded, format="PNG", optimize=True)
        replacements[index] = encoded.getvalue()
        image["mimeType"] = "image/png"
        images.append({"before": before, "after": pixels.size,
                       "beforeBytes": len(original), "afterBytes": len(replacements[index])})

# Repack views, retaining all non-image view bytes exactly and four-byte alignment.
packed = bytearray()
for i, view in enumerate(doc["bufferViews"]):
    packed.extend(b"\0" * (-len(packed) % 4))
    start = view.get("byteOffset", 0)
    value = replacements.get(i, binary[start:start + view["byteLength"]])
    if i not in replacements:
        assert value == binary[start:start + view["byteLength"]]
    view["byteOffset"], view["byteLength"] = len(packed), len(value)
    packed.extend(value)
doc["buffers"][0]["byteLength"] = len(packed)
packed.extend(b"\0" * (-len(packed) % 4))
metadata = json.dumps(doc, ensure_ascii=False, separators=(",", ":")).encode()
metadata += b" " * (-len(metadata) % 4)
result = (struct.pack("<4sII", b"glTF", 2, 28 + len(metadata) + len(packed))
          + struct.pack("<II", len(metadata), 0x4E4F534A) + metadata
          + struct.pack("<II", len(packed), 0x004E4942) + packed)
path = pathlib.Path(target)
path.parent.mkdir(parents=True, exist_ok=True)
path.write_bytes(result)
print(json.dumps({"sourceBytes": len(raw), "bytes": len(result), "images": images}))
