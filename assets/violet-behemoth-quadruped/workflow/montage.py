"""Labelled sheets of exact-GLB QA renders (no changes to the source image)."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw
qa=Path(sys.argv[1]); view=sys.argv[2]; clips=sys.argv[3].split(',')
tile_w,tile_h=252,288
sheet=Image.new('RGB',(tile_w*5, (tile_h+26)*len(clips)),(246,246,246)); draw=ImageDraw.Draw(sheet)
for i,clip in enumerate(clips):
    draw.text((8,i*(tile_h+26)+7),clip,fill=(20,20,20))
    for j,path in enumerate(sorted(qa.glob(f'{clip}-{view}-*.png'))[:5]):
        im=Image.open(path).convert('RGB'); im.thumbnail((tile_w,tile_h))
        sheet.paste(im,(j*tile_w,i*(tile_h+26)+26))
sheet.save(qa/f'sheet-{view}.png')
