"""Compose the "OpenAI Dots" credit icon from the dots' own portraits.

The dots have no X profile, so their card in the contributors dialog cannot use a
profile photo like everyone else's. The icon instead groups three of the shipped,
unmodified dot portraits (public/models/orb-bot-*/portrait.png, the references the
in-game menu already shows) on the dialog's dark avatar backdrop, at the 200x200
JPEG size of the X icons. The dialog crops it to a circle, so every dot stays
inside the inscribed circle.

Usage: python scripts/build-dots-avatar.py
Writes public/title/avatar-dots.jpg and assets/title-credits/dots-avatar.json.
"""

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / 'public/title/avatar-dots.jpg'
RECORD = ROOT / 'assets/title-credits/dots-avatar.json'
SIZE = 200
SCALE = 4  # composed at 4x, then reduced once
ALPHA_CUT = 32  # the portraits carry faint alpha specks beyond the body
BACKDROP = ((51, 70, 58), (23, 34, 28))  # centre and rim; the rim is the avatar background
# (portrait, height as a share of the icon, centre x, centre y), back to front.
DOTS = [
    ('orb-bot-beret', 0.47, 0.30, 0.37),
    ('orb-bot-triangle', 0.43, 0.71, 0.39),
    ('orb-bot-white', 0.52, 0.50, 0.67),
]


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def body(path: Path) -> Image.Image:
    image = Image.open(path).convert('RGBA')
    mask = image.getchannel('A').point(lambda a: 255 if a > ALPHA_CUT else 0)
    return image.crop(mask.getbbox())


def main() -> None:
    side = SIZE * SCALE
    canvas = Image.new('RGBA', (side, side), BACKDROP[1] + (255,))
    # A soft lit centre fading to the dialog's avatar background.
    glow = Image.new('L', (side, side), 0)
    ImageDraw.Draw(glow).ellipse((side * 0.1, side * 0.05, side * 0.9, side * 0.85), fill=255)
    glow = glow.filter(ImageFilter.GaussianBlur(side * 0.12))
    canvas.paste(Image.new('RGBA', (side, side), BACKDROP[0] + (255,)), (0, 0), glow)
    sources = []
    for key, height, x, y in DOTS:
        path = ROOT / 'public/models' / key / 'portrait.png'
        dot = body(path)
        scale = height * side / dot.height
        dot = dot.resize((round(dot.width * scale), round(dot.height * scale)), Image.LANCZOS)
        # A faint contact shadow keeps the overlapping dots apart.
        shadow = Image.new('RGBA', dot.size, (0, 0, 0, 0))
        shadow.putalpha(dot.getchannel('A').point(lambda a: a * 0.45))
        shadow = shadow.filter(ImageFilter.GaussianBlur(side * 0.012))
        left = round(x * side - dot.width / 2)
        top = round(y * side - dot.height / 2)
        canvas.alpha_composite(shadow, (left + round(side * 0.008), top + round(side * 0.014)))
        canvas.alpha_composite(dot, (left, top))
        sources.append(
            {
                'file': str(path.relative_to(ROOT)).replace('\\', '/'),
                'sha256': sha256(path),
                'heightShare': height,
                'centre': [x, y],
            }
        )
    icon = canvas.convert('RGB').resize((SIZE, SIZE), Image.LANCZOS)
    icon.save(OUTPUT, 'JPEG', quality=90, optimize=True)
    RECORD.write_text(
        json.dumps(
            {
                'credit': 'dots',
                'name': 'OpenAI Dots',
                'reason': 'No X profile of their own; the card shows the dots instead of a profile photo.',
                'script': 'scripts/build-dots-avatar.py',
                'sources': sources,
                'output': {
                    'file': str(OUTPUT.relative_to(ROOT)).replace('\\', '/'),
                    'width': SIZE,
                    'height': SIZE,
                    'bytes': OUTPUT.stat().st_size,
                    'sha256': sha256(OUTPUT),
                },
            },
            ensure_ascii=False,
            indent=2,
        )
        + '\n',
        encoding='utf-8',
    )
    print(f'{OUTPUT.relative_to(ROOT)}: {OUTPUT.stat().st_size} bytes')


if __name__ == '__main__':
    main()
