"""Build local profile QR assets. Tooling only: qrcode 8.2, Pillow, zxing-cpp 2.3.0.

Install optional generation/verification packages in output/title-credits/tools;
the game itself has no new runtime dependency or external QR service.
"""
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'output/title-credits/tools'))
import qrcode
import zxingcpp
from PIL import Image

PROFILES = [
    ('yuri', 'https://x.com/yurinakanishi33'),
    ('ryuichi', 'https://x.com/WabisukeTyper'),
    ('otani', 'https://x.com/otani_ai_memo'),
    ('urata', 'https://x.com/yuki_urata'),
    ('nukonuko', 'https://x.com/nukonuko'),
]
destination = ROOT / 'public/title'
destination.mkdir(parents=True, exist_ok=True)
results = []
for key, url in PROFILES:
    # Fixed version 3 gives all five codes 29 + 8 quiet-zone modules.
    # They display at 111px: exactly 3 CSS pixels per module.
    qr = qrcode.QRCode(version=3, error_correction=qrcode.constants.ERROR_CORRECT_M,
                       box_size=8, border=4)
    qr.add_data(url)
    qr.make(fit=False)
    path = destination / f'qr-{key}.png'
    qr.make_image(fill_color='black', back_color='white').save(path)
    image = Image.open(path).convert('RGB')
    for size in [296, 111]:
        decoded = zxingcpp.read_barcode(image.resize((size, size), Image.Resampling.NEAREST))
        assert decoded and decoded.text == url, (key, size, decoded)
    results.append({'file': path.relative_to(ROOT).as_posix(), 'url': url,
                    'sha256': hashlib.sha256(path.read_bytes()).hexdigest(),
                    'decodedAtPixels': [296, 111], 'quietZoneModules': 4})

report = ROOT / 'assets/title-credits/qr-verification.json'
report.parent.mkdir(parents=True, exist_ok=True)
report.write_text(json.dumps(results, indent=2) + '\n', encoding='utf-8')
print(f'Generated and decoded all {len(results)} profile QR codes at source and display sizes.')
