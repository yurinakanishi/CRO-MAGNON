"""Write codex-request-v<N>.txt for each asset in a spec JSON (remake reference images).

python make_codex_requests.py specs.json
spec: {"version": 2, "assets": [{"key", "identity", "subject", "camera", "variants": ["..", ".."],
        "attach": ["abs png", ...] (optional)}]}
"""
import json
import sys
from pathlib import Path

MODELS = Path(r'C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models')
HEADER = ('Use case: single-object reconstruction reference for TRELLIS image-to-3D, for a prehistoric Ice Age '
          'third-person game. Style: grounded painterly realism, high-quality game asset sculpt, readable large forms '
          'with crisp secondary detail, natural non-metallic materials. ')
FOOTER = (' Lighting: soft even neutral studio light from all sides, no harsh highlights, no dark cast shadows on the '
          'object, only a faint contact shadow. Plain uniform off-white background. No text, logo, watermark, scenery, '
          'ground plane, base, pedestal, person, second object or multiple views.')

spec = json.loads(Path(sys.argv[1]).read_text(encoding='utf-8'))
version = spec.get('version', 2)
for a in spec['assets']:
    key = a['key']
    orig = MODELS / key / 'source/original'
    orig.mkdir(parents=True, exist_ok=True)
    variants = a.get('variants') or ['']
    letters = 'abc'[:len(variants)]
    prompt = HEADER + a['subject'] + ' Camera: ' + a['camera'] + FOOTER
    lines = [
        f'Use your built-in image generation tool (image_gen) to create {len(variants)} separate reference image(s). '
        'Do not write code, do not use Python/PIL or any drawing library, and do not edit any files other than '
        f'saving the PNGs and prompts-v{version}.json named below.', '',
    ]
    if a.get('styleNote'):
        lines += ['The attached image shows the character who will carry or wear this object in the game. Match its art '
                  'style, palette and material treatment, but draw ONLY the object itself, on its own: ' + a['styleNote'], '']
    elif a.get('identity'):
        lines += ['The attached image is the approved earlier reference of the same game asset (Candidate 1). '
                  'Keep its identity: ' + a['identity'], '']
    lines += ['Shared prompt:', f'"{prompt}"', '']
    if len(variants) > 1 or variants[0]:
        lines.append('Per-image variation appended:')
        for letter, v in zip(letters, variants):
            lines.append(f'- Image {letter.upper()}: "{v}"')
        lines.append('')
    lines.append('Save the generated image(s) as PNG files exactly at:')
    for letter in letters:
        lines.append(str(orig / f'candidate2-ref-{letter}.png').replace('\\', '/'))
    lines += ['(copy them from wherever the image tool stores its outputs). Then write '
              f'prompts-v{version}.json in the same folder listing, for each file, the exact full prompt you sent to '
              'the image tool. Reply with the saved paths.']
    (orig / f'codex-request-v{version}.txt').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    if a.get('attach'):
        (orig / f'codex-attach-v{version}.txt').write_text('\n'.join(a['attach']) + '\n', encoding='utf-8')
    print('wrote', key)
