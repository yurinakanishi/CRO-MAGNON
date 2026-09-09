"""Deterministic paper removal, explicitly authorized by the user on 2026-09-09.

Uses the approved surface-cleanup RGB artwork, never generated checkerboard results.
Pillow and NumPy are authoring tools only, not game dependencies.
"""
from pathlib import Path
import argparse
import hashlib
import json
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--variant', choices=['xi', 'mmo', 'duo'], default='xi')
variant = parser.parse_args().variant
source = ROOT / f'assets/title-credits/cro-magnon-{variant}-clean-source.png'
destination = ROOT / f'public/title/cro-magnon-{variant}-transparent.png'
original = Image.open(source).convert('RGB')
pixels = np.asarray(original, dtype=np.float32)
# The border contains unpainted paper. Estimate its warm color from all edges.
edge = np.concatenate([pixels[:12].reshape(-1, 3), pixels[-12:].reshape(-1, 3),
                       pixels[:, :12].reshape(-1, 3), pixels[:, -12:].reshape(-1, 3)])
paper = np.median(edge, axis=0)
ink = np.maximum(paper - pixels, 0).max(axis=2)
# Build an interior silhouette before removing paper-colored pixels. Closing tiny
# brush gaps preserves enclosed snow, fur and clothing highlights. Flood-fill only
# exterior paper; the lettering keeps its counters open via the color matte.
silhouette = Image.fromarray(np.uint8(ink > 28) * 255)
silhouette = silhouette.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.MinFilter(9))
mask = np.asarray(silhouette).copy()
mask[690:] = 0
exterior = Image.fromarray(mask).copy()
ImageDraw.floodfill(exterior, (0, 0), 128)
interior = np.asarray(exterior) != 128
interior[690:] = False
# Keep the closing operation away from the outer contour so its square kernel
# cannot create visible white steps around the original painted brushwork.
protected = Image.fromarray(np.uint8(interior) * 255)
protected = protected.filter(ImageFilter.MinFilter(13)).filter(ImageFilter.GaussianBlur(1.2))
alpha = np.clip((ink - 18) / 20, 0, 1)
alpha = alpha * alpha * (3 - 2 * alpha)
alpha = np.maximum(alpha, np.asarray(protected, dtype=np.float32) / 255)
# Preserve every original RGB pixel exactly. The previous unmatting darkened
# fine detail; only alpha changes now, at the original resolution.
rgba = np.dstack([np.uint8(pixels), np.uint8(np.rint(alpha * 255))])
result = Image.fromarray(rgba)
result.save(destination, optimize=True)

reopened = Image.open(destination)
channel = np.asarray(reopened.getchannel('A'))
assert reopened.mode == 'RGBA' and reopened.size == original.size
assert channel[0, 0] == channel[0, -1] == channel[-1, 0] == channel[-1, -1] == 0
assert (channel == 0).mean() > .25 and (channel == 255).mean() > .2
assert np.array_equal(np.asarray(reopened.convert('RGB')), np.asarray(original))

out = ROOT / 'output/title-credits'
out.mkdir(parents=True, exist_ok=True)
# Inspect against light and dark backgrounds, at UI size, before adoption.
preview = Image.new('RGB', (1536, 512))
for x, color in [(0, '#172820'), (768, '#ddd1b2')]:
    background = Image.new('RGBA', result.size, color)
    background.alpha_composite(result)
    preview.paste(background.convert('RGB').resize((768, 512), Image.Resampling.LANCZOS), (x, 0))
preview.save(out / f'{variant}-transparent-preview.jpg', quality=94)
report = {
    'method': 'built-in image edit, then protected-alpha paper extraction',
    'variant': variant,
    'revision': 4,
    'originalRgbPreservedExactly': False,
    'cleanedSourceRgbPreservedExactly': True,
    'surfaceEditRecord': 'assets/title-credits/' + ('surface-cleanup.json' if variant == 'xi' else f'{variant}-variant.json'),
    'userAuthorizedProgrammaticExtraction': True,
    'source': source.relative_to(ROOT).as_posix(),
    'sourceSha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'output': destination.relative_to(ROOT).as_posix(),
    'outputSha256': hashlib.sha256(destination.read_bytes()).hexdigest(),
    'mode': reopened.mode, 'size': list(reopened.size), 'estimatedPaperRgb': paper.tolist(),
    'transparentPixels': int((channel == 0).sum()),
    'partialAlphaPixels': int(((channel > 0) & (channel < 255)).sum()),
    'opaquePixels': int((channel == 255).sum()),
    'generatedCheckerboardUsed': False,
}
report_name = 'transparency.json' if variant == 'xi' else f'{variant}-transparency.json'
(ROOT / 'assets/title-credits' / report_name).write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
print(json.dumps(report, indent=2))
