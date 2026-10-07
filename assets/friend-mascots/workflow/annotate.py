"""Overlay height-fraction grids on the orthographic surface renders for landmark picking.

python annotate.py <surface revision dir>
Writes landmarks-sheet.png: front | side | back with lines every 0.05 H (labelled every 0.1).
"""
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw

d = Path(sys.argv[1])
r = json.loads((d / 'surface.json').read_text())
H, span, px = r['heightMetres'], r['render']['spanMetres'], r['render']['pixels']
m = px / span  # pixels per metre; image centre = (0, H/2)
tiles = []
for name in ['front', 'side', 'back']:
    im = Image.open(d / f'{name}.png').convert('RGBA')
    bg = Image.new('RGBA', im.size, (210, 214, 220, 255))
    bg.alpha_composite(im)
    draw = ImageDraw.Draw(bg)
    for i in range(0, 21):
        f = i * 0.05
        y = px / 2 - (f * H - H / 2) * m
        draw.line([(0, y), (px, y)], fill=(255, 0, 0, 120) if i % 2 == 0 else (0, 0, 255, 70), width=1)
        if i % 2 == 0:
            draw.text((4, y - 12), f'{f:.1f}', fill=(200, 0, 0, 255))
    for i in range(-12, 13):
        x = px / 2 + i * 0.05 * H * m
        draw.line([(x, 0), (x, px)], fill=(0, 140, 0, 90) if i % 2 == 0 else (0, 140, 0, 40), width=1)
        if i % 2 == 0:
            draw.text((x + 2, px - 14), f'{i * 0.05:+.1f}', fill=(0, 110, 0, 255))
    draw.text((8, 8), name, fill=(0, 0, 0, 255))
    tiles.append(bg)
sheet = Image.new('RGBA', (px * 3, px), (255, 255, 255, 255))
for i, t in enumerate(tiles):
    sheet.paste(t, (i * px, 0))
sheet.convert('RGB').save(d / 'landmarks-sheet.png')
print(d / 'landmarks-sheet.png')
