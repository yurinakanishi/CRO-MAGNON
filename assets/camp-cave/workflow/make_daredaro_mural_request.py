"""Codex built-in image_gen request for the deepened cave's new mural (@daredaro_F, 2026-10-14).

python assets/camp-cave/workflow/make_daredaro_mural_request.py [version]
Same common style prompt as the contributor friezes (assets/friend-mascots/workflow/
make_mural_requests.py); the output lands in output/model-generation/models/daredaro-frieze/
source/original/ and is run with the newest Codex desktop CLI like the other references.
"""
import importlib.util
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
VERSION = sys.argv[1] if len(sys.argv) > 1 else '1'
spec = importlib.util.spec_from_file_location(
    'friend_murals', ROOT / 'assets/friend-mascots/workflow/make_mural_requests.py')
friend_murals = importlib.util.module_from_spec(spec)
spec.loader.exec_module(friend_murals)

IDENTITY = 'assets/camp-cave/source/daredaro-reference-user.png'
SUBJECT = (
    'One character among a woolly rhinoceros, a reindeer and an ibex: the chibi gentleman from the first attached '
    'image, with a big head of voluminous wavy silver-white hair falling to his shoulders, a calm small smile, and his '
    'eyes completely hidden behind a straight horizontal bar across the face (keep that bar: it is how he always '
    'appears), wearing a black suit jacket with thin gold trim on the lapels, a dark shirt and a purple tie, black '
    'trousers and black shoes, standing upright with his hands clasped behind his back. Pigments: silver hair in pale '
    'chalky bone-white with charcoal outline, suit and shoes in charcoal, lapel trim in ochre, the tie and the eye bar in '
    'a muted red-violet earth tone. ')

if __name__ == '__main__':
    orig = ROOT / 'output/model-generation/models/daredaro-frieze/source/original'
    orig.mkdir(parents=True, exist_ok=True)
    png = orig / f'reference-v{VERSION}.png'
    prompt = friend_murals.COMMON + SUBJECT
    text = (
        'Use your built-in image generation tool (image_gen) to create exactly ONE image with a transparent background. '
        'Do not write code, do not use Python/PIL or any drawing library, and do not create or edit any files other than '
        f'the PNG and the prompt text named below.\n\nPrompt:\n"{prompt}"\n\n'
        f'Save the generated image as a PNG exactly at:\n{png.as_posix()}\n'
        '(copy it from wherever the image tool stores its outputs). Then write the exact full prompt you sent to the image '
        f'tool to:\n{png.with_suffix(".prompt.txt").as_posix()}\nReply with the saved path.\n')
    (orig / f'codex-request-v{VERSION}.txt').write_text(text, encoding='utf-8')
    attach = [IDENTITY, friend_murals.STYLE]
    (orig / f'codex-attach-v{VERSION}.txt').write_text('\n'.join(str(ROOT / p) for p in attach) + '\n', encoding='utf-8')
    print('wrote', orig)
