"""Contact sheet: python sheet.py <out.jpg> <cols> <png...> (labels = file stems)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw

out, cols, files = sys.argv[1], int(sys.argv[2]), [Path(p) for p in sys.argv[3:]]
ims = [Image.open(p).convert('RGB') for p in files]
w = max(i.width for i in ims)
h = max(i.height for i in ims)
rows = (len(ims) + cols - 1) // cols
sheet = Image.new('RGB', (w * cols, (h + 18) * rows), (30, 30, 30))
d = ImageDraw.Draw(sheet)
for k, (p, im) in enumerate(zip(files, ims)):
    x, y = (k % cols) * w, (k // cols) * (h + 18)
    sheet.paste(im, (x, y + 18))
    d.text((x + 4, y + 3), f'{p.parent.name}/{p.stem}', fill=(230, 230, 230))
sheet.save(out, quality=88)
print(out, sheet.size)
