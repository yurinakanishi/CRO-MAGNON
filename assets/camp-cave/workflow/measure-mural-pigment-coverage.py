"""Read-only image/geometry inspection; does not modify the generated PNG."""
import hashlib
import json
from pathlib import Path
from PIL import Image

base = Path('assets/camp-cave')
d = json.loads((base / 'qa/side-wall-coverage.json').read_text(encoding='utf8'))
image_path = base / 'source/mural-side-r04.png'
image = Image.open(image_path)
alpha = image.getchannel('A')
grid = [[alpha.getpixel((round((1-z/90)*(image.width-1)),
                        round((1-y/30)*(image.height-1))))
         for y in range(31)] for z in range(91)]
active = 0
clipped = []
delta = 0
for z in range(91):
    for y in range(31):
        x = d['patch'][z][y]
        if grid[z][y] <= 32:
            continue
        active += 1
        if x is None or x > -3.25 or x < -6.4:
            clipped.append([z, y, x])
        for dz, dy in [(0, -1), (-1, 0)]:
            if z+dz >= 0 and y+dy >= 0 and grid[z+dz][y+dy] > 32:
                delta = max(delta, abs(x-d['patch'][z+dz][y+dy]))
result = {
    'samples': d['samples'], 'paintedSamples': active, 'paintedClipped': clipped,
    'maxAdjacentPaintedDepthChange': delta, 'thresholdAlpha': 32,
    'note': 'The 5 clipped rectangle samples lie in the transparent top-right margin.',
    'image': {'size': image.size, 'mode': image.mode, 'alphaRange': alpha.getextrema(),
              'transparentFraction': alpha.histogram()[0] / (image.width*image.height),
              'sha256': hashlib.sha256(image_path.read_bytes()).hexdigest()},
}
(base / 'qa/side-wall-pigment-coverage.json').write_text(json.dumps(result, indent=2)+'\n', encoding='utf8')
print(json.dumps(result))
