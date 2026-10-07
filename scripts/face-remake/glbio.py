"""Minimal GLB reader/writer used by the 2026-10-07 face remake tools (numpy only)."""
import copy
import io
import json
import struct
from pathlib import Path

import numpy as np

COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
NORM = {5121: 255.0, 5123: 65535.0, 5120: 127.0, 5122: 32767.0}


class Glb:
    def __init__(self, path):
        raw = Path(path).read_bytes()
        json_len = struct.unpack_from('<I', raw, 12)[0]
        self.doc = json.loads(raw[20:20 + json_len])
        start = 20 + json_len + 8
        self.bin = raw[start:start + struct.unpack_from('<I', raw, 20 + json_len)[0]]
        self.path = str(path)

    def view_bytes(self, view_id):
        v = self.doc['bufferViews'][view_id]
        o = v.get('byteOffset', 0)
        return self.bin[o:o + v['byteLength']]

    def accessor(self, accessor_id, normalise=True):
        a = self.doc['accessors'][accessor_id]
        v = self.doc['bufferViews'][a['bufferView']]
        dtype = np.dtype(COMP[a['componentType']])
        width = WIDTH[a['type']]
        stride = v.get('byteStride', dtype.itemsize * width)
        start = v.get('byteOffset', 0) + a.get('byteOffset', 0)
        if stride == dtype.itemsize * width:
            out = np.frombuffer(self.bin, dtype=dtype, count=a['count'] * width, offset=start).reshape(a['count'], width)
        else:
            rows = np.frombuffer(self.bin, dtype=np.uint8, count=stride * (a['count'] - 1) + dtype.itemsize * width, offset=start)
            out = np.lib.stride_tricks.as_strided(rows, shape=(a['count'], dtype.itemsize * width), strides=(stride, 1)).copy()
            out = out.view(dtype).reshape(a['count'], width)
        if normalise and a.get('normalized'):
            out = out.astype(np.float64) / NORM[a['componentType']]
        return out.copy()

    def image_bytes(self, image_id):
        return bytes(self.view_bytes(self.doc['images'][image_id]['bufferView']))

    def texture_image(self, texture_id):
        t = self.doc['textures'][texture_id]
        return t.get('extensions', {}).get('EXT_texture_webp', {}).get('source', t.get('source'))


class Builder:
    """Assemble a new GLB from a JSON document and a list of (bytes) buffer views."""

    def __init__(self, doc):
        self.doc = copy.deepcopy(doc)
        self.chunks = []
        self.length = 0
        self.doc['bufferViews'] = []
        self.doc['accessors'] = self.doc.get('accessors', [])

    def add_view(self, data, target=None):
        pad = (-self.length) % 4
        if pad:
            self.chunks.append(b'\0' * pad)
            self.length += pad
        view = {'buffer': 0, 'byteOffset': self.length, 'byteLength': len(data)}
        if target:
            view['target'] = target
        self.chunks.append(bytes(data))
        self.length += len(data)
        self.doc['bufferViews'].append(view)
        return len(self.doc['bufferViews']) - 1

    def add_accessor(self, array, component, kind, target=None, normalized=False, minmax=False):
        array = np.ascontiguousarray(array, dtype=COMP[component])
        view = self.add_view(array.tobytes(), target)
        acc = {'bufferView': view, 'componentType': component, 'count': int(array.shape[0]), 'type': kind}
        if normalized:
            acc['normalized'] = True
        if minmax:
            flat = array.reshape(array.shape[0], -1)
            acc['min'] = [float(x) for x in flat.min(0)]
            acc['max'] = [float(x) for x in flat.max(0)]
        self.doc['accessors'].append(acc)
        return len(self.doc['accessors']) - 1

    def write(self, path):
        body = b''.join(self.chunks)
        body += b'\0' * ((-len(body)) % 4)
        self.doc['buffers'] = [{'byteLength': len(body)}]
        text = json.dumps(self.doc, separators=(',', ':')).encode('utf-8')
        text += b' ' * ((-len(text)) % 4)
        out = io.BytesIO()
        out.write(struct.pack('<III', 0x46546C67, 2, 12 + 8 + len(text) + 8 + len(body)))
        out.write(struct.pack('<II', len(text), 0x4E4F534A))
        out.write(text)
        out.write(struct.pack('<II', len(body), 0x004E4942))
        out.write(body)
        Path(path).write_bytes(out.getvalue())
        return out.getvalue()
