"""Compose render_poses.py output into one sheet per view: rows = clips, columns = phases.

python sheet_poses.py <dir> [view=front]
"""
import sys
from pathlib import Path

from PIL import Image, ImageDraw

d = Path(sys.argv[1])
view = sys.argv[2] if len(sys.argv) > 2 else 'front'
clips = ['Idle_Loop', 'Walk_Loop', 'Run_Loop', 'Pet', 'Happy', 'Hit', 'Wave', 'Bow']
phases = ['00', '25', '50', '75']
size = 256
sheet = Image.new('RGB', (size * len(phases) + 90, size * len(clips)), (205, 210, 216))
draw = ImageDraw.Draw(sheet)
for r, clip in enumerate(clips):
    draw.text((4, r * size + size // 2), clip, fill=(0, 0, 0))
    for c, ph in enumerate(phases):
        f = d / f'{clip}-{ph}-{view}.png'
        if not f.exists():
            continue
        im = Image.open(f).convert('RGBA').resize((size, size))
        tile = Image.new('RGBA', (size, size), (205, 210, 216, 255))
        tile.alpha_composite(im)
        sheet.paste(tile.convert('RGB'), (90 + c * size, r * size))
out = d / f'sheet-{view}.png'
sheet.save(out)
print(out)
