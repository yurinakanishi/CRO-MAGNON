import sys
from pathlib import Path
from PIL import Image
qa = Path(sys.argv[1]); view = sys.argv[2]; clips = sys.argv[3].split(','); out = sys.argv[4]
rows = []
for c in clips:
    frames = sorted(qa.glob(f'{c}-{view}-*.png'))
    if frames: rows.append([Image.open(f).convert('RGB') for f in frames])
w, h = rows[0][0].size; s = .5
sheet = Image.new('RGB', (int(w*s)*max(len(r) for r in rows), int(h*s)*len(rows)), 'white')
for i, r in enumerate(rows):
    for j, im in enumerate(r): sheet.paste(im.resize((int(w*s), int(h*s))), (j*int(w*s), i*int(h*s)))
sheet.save(out)
