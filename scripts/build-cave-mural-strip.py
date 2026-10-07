"""Bake the cave friezes into one seamless 2D wall strip for the MMO title screen.

The six unmodified transparent friezes from public/models/camp-cave are laid in
one row over the cave's own limestone texture, composited with the same pigment
formula the cave shader uses. The strip width is a whole number of rock tiles,
so its right edge continues into its left edge and the title can loop it.

Usage: python scripts/build-cave-mural-strip.py
Writes public/title/cave-mural-strip.webp and assets/title-credits/cave-mural-strip.json.
"""

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
CAVE = ROOT / 'public/models/camp-cave'
BASE_HEIGHT = 724  # every frieze is 724 px tall
TILES = 19  # strip width = TILES rock tiles of BASE_HEIGHT x BASE_HEIGHT
OUTPUT_HEIGHT = 400
PREVIEW_HEIGHT = 36  # tiny blurred stand-in shown while the strip downloads
STRENGTH = 0.88  # pigment opacity, close to the cave's 0.82-0.86

# Order spreads the contributors' characters along the wall.
FRIEZES = [
    ('rimoFrieze', 'rimo-lascaux-frieze-r30.png'),
    ('roundBots', 'bot-round-lascaux-r31.png'),
    ('creature524', '524-lascaux-frieze-r32.png'),
    ('maruimoFrieze', 'maruimo-lascaux-r33.png'),
    ('shapeBots', 'bot-shapes-lascaux-r31.png'),
    ('maeKohaku', 'mae-kohaku-lascaux-r31.png'),
]
# Character bounds in each frieze's own pixels, measured on the unmodified PNGs.
CHARACTERS = {
    'rimoFrieze': [('rimo', 'りもねこ', (830, 180, 1285, 672))],
    'creature524': [('r524', '524', (1050, 350, 1335, 625))],
    'maruimoFrieze': [('maruimo', 'まるぃも', (1215, 280, 1610, 665))],
    'maeKohaku': [
        ('mae', 'mae', (585, 450, 875, 672)),
        ('kohaku', 'こはくちゃん', (1260, 285, 1665, 685)),
    ],
}


def sha256(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def seamless_rock(size):
    """Limestone tile cross-blended with its half-rolled copy so it wraps."""
    rock = Image.open(CAVE / 'limestone-r05.png').convert('RGB').resize((size, size), Image.LANCZOS)
    tile = np.asarray(rock).astype(np.float32) / 255
    # Soften only the finest grain: it costs most of the bytes and is lost at
    # title-screen sizes anyway. Pigments stay unfiltered.
    blurred = np.asarray(rock.filter(ImageFilter.GaussianBlur(1.4))).astype(np.float32) / 255
    tile = tile * 0.45 + blurred * 0.55
    rolled = np.roll(tile, size // 2, axis=1)
    x = np.linspace(0, 1, size, dtype=np.float32)
    # 1 at both edges (use the rolled copy's continuous centre), 0 in the middle.
    edge = np.clip(np.abs(x - 0.5) * 2, 0, 1)
    mask = np.clip((edge - 0.62) / 0.38, 0, 1)
    mask = mask * mask * (3 - 2 * mask)
    return tile * (1 - mask[None, :, None]) + rolled * mask[None, :, None]


def main():
    tile = seamless_rock(BASE_HEIGHT)
    width = TILES * BASE_HEIGHT
    rock = np.tile(tile, (1, TILES, 1))
    luma = rock @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    # Torch-lit limestone: mostly desaturated and lifted, a little warm.
    wall = rock * 0.45 + luma[..., None] * 0.55
    wall = np.clip(wall * np.array([1.12, 1.08, 1.0], dtype=np.float32) + 0.03, 0, 0.92)
    # Gentle periodic light variation keeps the long wall from looking flat.
    u = np.arange(width, dtype=np.float32) / width * 2 * np.pi
    variation = 0.94 + 0.04 * np.sin(u * 3 + 0.7) + 0.03 * np.sin(u * 7 + 2.1)
    wall *= variation[None, :, None]

    slot = width / len(FRIEZES)
    layout, spots = [], []
    for index, (motif, name) in enumerate(FRIEZES):
        path = CAVE / name
        frieze = Image.open(path).convert('RGBA')
        assert frieze.height == BASE_HEIGHT, name
        left = round(index * slot + (slot - frieze.width) / 2)
        paint = np.asarray(frieze).astype(np.float32) / 255
        region = wall[:, left : left + frieze.width]
        region_luma = luma[:, left : left + frieze.width]
        mineral = paint[..., :3] * (0.84 + 0.24 * region_luma[..., None])
        alpha = paint[..., 3:4] * STRENGTH
        wall[:, left : left + frieze.width] = region * (1 - alpha) + mineral * alpha
        layout.append({'motif': motif, 'file': f'public/models/camp-cave/{name}', 'sha256': sha256(path), 'left': left, 'width': frieze.width})
        for key, label, (x0, y0, x1, y1) in CHARACTERS.get(motif, []):
            spots.append(
                {
                    'subject': key,
                    'label': label,
                    'x': round((left + x0) / width, 5),
                    'y': round(y0 / BASE_HEIGHT, 5),
                    'w': round((x1 - x0) / width, 5),
                    'h': round((y1 - y0) / BASE_HEIGHT, 5),
                }
            )

    image = Image.fromarray(np.clip(wall * 255 + 0.5, 0, 255).astype(np.uint8), 'RGB')
    output_width = TILES * OUTPUT_HEIGHT
    image = image.resize((output_width, OUTPUT_HEIGHT), Image.LANCZOS)
    target = ROOT / 'public/title/cave-mural-strip.webp'
    image.save(target, 'WEBP', quality=72, method=6)
    preview = ROOT / 'public/title/cave-mural-strip-preview.webp'
    image.resize((TILES * PREVIEW_HEIGHT, PREVIEW_HEIGHT), Image.LANCZOS).save(preview, 'WEBP', quality=60, method=6)
    record = {
        'generator': 'scripts/build-cave-mural-strip.py',
        'rock': {'file': 'public/models/camp-cave/limestone-r05.png', 'sha256': sha256(CAVE / 'limestone-r05.png')},
        'output': {
            'file': 'public/title/cave-mural-strip.webp',
            'width': output_width,
            'height': OUTPUT_HEIGHT,
            'bytes': target.stat().st_size,
            'sha256': sha256(target),
        },
        'preview': {
            'file': 'public/title/cave-mural-strip-preview.webp',
            'width': TILES * PREVIEW_HEIGHT,
            'height': PREVIEW_HEIGHT,
            'bytes': preview.stat().st_size,
            'sha256': sha256(preview),
        },
        'baseWidth': width,
        'baseHeight': BASE_HEIGHT,
        'friezes': layout,
        'spots': spots,
    }
    (ROOT / 'assets/title-credits/cave-mural-strip.json').write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n'
    )
    print(json.dumps(record['output']), json.dumps(spots))


if __name__ == '__main__':
    main()
