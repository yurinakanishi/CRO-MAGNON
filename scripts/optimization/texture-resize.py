"""Resize embedded glTF and standalone runtime textures for CRO-MAGNON candidates.

Usage: python -I scripts/optimization/texture-resize.py jobs.json

Reads only the input files named in jobs.json and writes only their declared outputs.
Every output keeps the source format, alpha channel and colour metadata and is
strictly smaller than its source; nothing is ever upscaled, cropped or padded (the whole
image maps onto the whole output). Normal maps are box-filtered and renormalised, data
maps are box-filtered per channel, colour maps use the requested filter, and textures
sampled with repeat wrapping are filtered across their opposite edges. Prints one JSON
report on stdout.
"""
import io
import json
import math
import sys

import PIL
from PIL import Image, JpegImagePlugin, PngImagePlugin

RESAMPLING = getattr(Image, "Resampling", Image)
COLOR_FILTERS = {"lanczos": RESAMPLING.LANCZOS, "box": RESAMPLING.BOX}
PIL_FORMATS = {"png": "PNG", "jpeg": "JPEG", "webp": "WEBP"}
# iCCP is carried through icc_profile; these chunks are copied verbatim.
PNG_COLOR_CHUNKS = (b"sRGB", b"gAMA", b"cHRM")


def png_color_chunks(data):
    found = []
    position = 8
    while position + 12 <= len(data):
        length = int.from_bytes(data[position:position + 4], "big")
        kind = data[position + 4:position + 8]
        if kind in PNG_COLOR_CHUNKS:
            found.append((kind, data[position + 8:position + 8 + length]))
        position += 12 + length
        if kind == b"IEND":
            break
    return found


def resize_channels(image, size, resample):
    """Resize each channel on its own: no alpha premultiplication, RGB kept as authored."""
    if len(image.getbands()) == 1:
        return image.resize(size, resample)
    return Image.merge(image.mode, [band.resize(size, resample) for band in image.split()])


def wrapped(image, size, resize, wrap):
    """Resize as the texture is sampled. With repeat wrapping the filter must see the opposite
    edges: resize a 3x3 tiling by the same factor and keep the exact centre tile."""
    if wrap == "clamp":
        return resize(image, size)
    if wrap != "repeat":
        raise ValueError("unknown wrap %s" % wrap)
    width, height = image.size
    tiled = Image.new(image.mode, (3 * width, 3 * height))
    for column in range(3):
        for row in range(3):
            tiled.paste(image, (column * width, row * height))
    resized = resize(tiled, (3 * size[0], 3 * size[1]))
    return resized.crop((size[0], size[1], 2 * size[0], 2 * size[1]))


def unit_byte(value):
    return max(0, min(255, int(round((value + 1.0) * 127.5))))


def renormalize(image):
    """Restore unit length after averaging tangent-space normals; the mean direction is kept."""
    bands = list(image.split())
    red, green, blue = (bytearray(band.tobytes()) for band in bands[:3])
    for i in range(len(red)):
        x = red[i] / 127.5 - 1.0
        y = green[i] / 127.5 - 1.0
        z = blue[i] / 127.5 - 1.0
        length = math.sqrt(x * x + y * y + z * z)
        if length < 1e-6:
            continue
        red[i] = unit_byte(x / length)
        green[i] = unit_byte(y / length)
        blue[i] = unit_byte(z / length)
    bands[0] = Image.frombytes("L", image.size, bytes(red))
    bands[1] = Image.frombytes("L", image.size, bytes(green))
    bands[2] = Image.frombytes("L", image.size, bytes(blue))
    return Image.merge(image.mode, bands)


def encode(image, source, data, job):
    output = io.BytesIO()
    options = {}
    if source.info.get("icc_profile"):
        options["icc_profile"] = source.info["icc_profile"]
    if source.info.get("exif"):
        options["exif"] = source.info["exif"]
    kind = job["format"]
    if kind == "png":
        info = PngImagePlugin.PngInfo()
        for chunk, payload in png_color_chunks(data):
            info.add(chunk, payload)
        image.save(output, format="PNG", optimize=True, pnginfo=info, **options)
    elif kind == "jpeg":
        if image.mode not in ("RGB", "L"):
            raise ValueError("%s: JPEG output cannot store mode %s" % (job["id"], image.mode))
        # Reuse the source quantisation tables and chroma sampling: same quality settings.
        image.save(
            output,
            format="JPEG",
            qtables=source.quantization,
            subsampling=JpegImagePlugin.get_sampling(source),
            optimize=True,
            progressive=bool(source.info.get("progressive") or source.info.get("progression")),
            **options
        )
    elif kind == "webp":
        webp = job["webp"]
        if webp["lossless"]:
            image.save(output, format="WEBP", lossless=True, quality=100, method=6, exact=True, **options)
        else:
            image.save(
                output,
                format="WEBP",
                lossless=False,
                quality=int(webp["quality"]),
                alpha_quality=100,
                method=6,
                exact=True,
                **options
            )
    else:
        raise ValueError("%s: unknown output format %s" % (job["id"], kind))
    return output.getvalue()


def process(job):
    name = job["id"]
    with open(job["input"], "rb") as handle:
        data = handle.read()
    source = Image.open(io.BytesIO(data))
    if source.format != PIL_FORMATS[job["format"]]:
        raise ValueError("%s: expected %s data, found %s" % (name, job["format"], source.format))
    if getattr(source, "n_frames", 1) != 1:
        raise ValueError("%s: animated images are not supported" % name)
    if source.size != (job["sourceWidth"], job["sourceHeight"]):
        raise ValueError("%s: source is %dx%d, the job expects %dx%d"
                         % (name, source.size[0], source.size[1], job["sourceWidth"], job["sourceHeight"]))
    size = (job["width"], job["height"])
    if size[0] > source.size[0] or size[1] > source.size[1] or size == source.size:
        raise ValueError("%s: refusing to upscale or to re-encode an image that needs no resize" % name)
    source.load()
    image = source
    notes = []
    if image.mode == "P":
        image = image.convert("RGBA" if "transparency" in image.info else "RGB")
        notes.append("palette expanded to " + image.mode)
    elif image.mode in ("RGB", "L") and "transparency" in image.info:
        image = image.convert("RGBA" if image.mode == "RGB" else "LA")
        notes.append("colour-key transparency expanded to an alpha channel")
    if image.mode not in ("RGB", "RGBA", "L", "LA"):
        raise ValueError("%s: unsupported image mode %s" % (name, image.mode))
    treatment = job["treatment"]
    wrap = job.get("wrap", "clamp")
    if treatment == "normal":
        if image.mode not in ("RGB", "RGBA"):
            raise ValueError("%s: a normal map must be RGB or RGBA, not %s" % (name, image.mode))
        image = renormalize(wrapped(image, size, lambda i, s: resize_channels(i, s, RESAMPLING.BOX), wrap))
    elif treatment in ("data", "unreferenced"):
        image = wrapped(image, size, lambda i, s: resize_channels(i, s, RESAMPLING.BOX), wrap)
    elif treatment == "color-opaque":
        image = wrapped(image, size, lambda i, s: resize_channels(i, s, COLOR_FILTERS[job["filter"]]), wrap)
    elif treatment == "color-alpha":
        # Pillow premultiplies RGBA/LA while resampling, so hidden texels do not bleed colour.
        image = wrapped(image, size, lambda i, s: i.resize(s, COLOR_FILTERS[job["filter"]]), wrap)
    else:
        raise ValueError("%s: unknown treatment %s" % (name, treatment))
    encoded = encode(image, source, data, job)
    with open(job["output"], "wb") as handle:
        handle.write(encoded)
    return {"id": name, "width": image.size[0], "height": image.size[1], "mode": image.mode,
            "bytes": len(encoded), "notes": notes}


def main():
    if len(sys.argv) != 2:
        sys.stderr.write("usage: texture-resize.py jobs.json\n")
        return 2
    with open(sys.argv[1], "r", encoding="utf-8") as handle:
        jobs = json.load(handle)["jobs"]
    results = [process(job) for job in jobs]
    try:
        from PIL import features
        webp = features.version("webp")
    except Exception:
        webp = None
    sys.stdout.write(json.dumps({"python": sys.version.split()[0], "pillow": PIL.__version__,
                                 "webp": webp, "results": results}))
    return 0


if __name__ == "__main__":
    sys.exit(main())
