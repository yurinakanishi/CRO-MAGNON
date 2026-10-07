"""Codex built-in image_gen requests for the two contributor cave friezes.

python assets/friend-mascots/workflow/make_mural_requests.py [version]
Outputs land in output/model-generation/models/<frieze>/source/original/ like the mascots.
"""
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
VERSION = sys.argv[1] if len(sys.argv) > 1 else '1'
MODELS = ROOT / 'output/model-generation/models'
REF = lambda key: f'output/model-generation/models/{key}/source/original/reference-v1.png'
STYLE = 'public/models/camp-cave/mae-kohaku-lascaux-r31.png'

COMMON = (
    'Use case: style-transfer / compositing. Create a transparent pigment frieze for a limestone cave wall in a game, '
    'matching the style reference (the LAST attached image): charcoal-brown outlines, red and ochre earth palette, irregular '
    'rubbed mineral pigment, speckled transparent wear. Do not copy the style reference\'s mascots. The other attached images '
    'are character identities only; paint each of them as a small cute cave-painting figure in that same pigment style, easy '
    'to recognise by silhouette, hair, ears, hat and outfit colours, but modest in size: about 55-65% of the height of the '
    'largest animal. Animals in side profile with Lascaux-inspired shapes. Characters and animals alternate and lightly '
    'overlap at varied heights in one connected prehistoric procession; no empty halo around any character. A landscape 3:1 '
    'composition, every silhouette complete, small transparent margins. Real transparent background: pigment marks only, no '
    'rock photograph, no opaque rectangular background, no stickers or white outline, no glow, no shadows, no letters or '
    'names, no extra characters. All subjects share the same broken edges and thin weathered paint so the real rock shows '
    'through. ')

FRIEZES = {
    'friends-frieze-a': (
        [REF('saber-mascot'), REF('fairy-mascot'), REF('nukonuko-mascot'), REF('sagasa-mascot'), STYLE],
        'Characters, in this order from left to right, among a wild horse, an ibex and a red deer stag: (1) the blonde '
        'cat-eared girl in a wide straw sun hat and white sundress with a golden cat tail; (2) the brown-haired woman in a '
        'lavender blouse with a bow scarf, cream skirt and small lilac fairy wings; (3) the long-haired brown cat-eared girl '
        'with a brown pinafore dress, star collar and dark tail; (4) the curly-haired boy with black glasses, blue vest over a '
        'black hoodie and black cargo pants. Pigments: straw hat and blonde hair in pale ochre, lavender in a muted violet-grey '
        'earth tone, blue vest in a muted slate blue-grey, dark hair and glasses in charcoal. '),
    'friends-frieze-b': (
        [REF('otani-mascot'), REF('urata-mascot'), 'public/models/howkey-scientist/portrait.png', REF('howkey-flask'), STYLE],
        'Characters, in this order from left to right, among an aurochs, a bison and a running wild horse: (1) the white duck '
        'with a green knit cap, headset, green scarf and black vest, wings open; (2) the cheerful man with voluminous black '
        'curly hair, round glasses, black T-shirt and navy jeans; (3) the scientist girl with sage-green bob hair, round '
        'glasses and a long white lab coat (third identity image) holding up the teal Erlenmeyer flask (fourth image) in one '
        'hand. Pigments: duck and lab coat in pale chalky bone-white with charcoal outline, green cap, scarf and hair in a '
        'muted green earth, teal flask liquid in a muted blue-green earth, dark hair and glasses in charcoal. '),
    # r35: the river procession gains Rei-chan (怜ちゃん, @asahina_AIauto). The r34 painting is attached
    # so the composition, animals and the three existing characters stay recognisably the same.
    'friends-frieze-b2': (
        [REF('otani-mascot'), REF('urata-mascot'), 'public/models/howkey-scientist/portrait.png',
         REF('rei-mascot'), 'public/models/camp-cave/friends-river-lascaux-r34.png', STYLE],
        'Repaint the fifth attached image (the existing river procession) keeping its aurochs, bison and running horse and '
        'its three characters, now as FOUR characters among the same three animals, all slightly smaller so everyone fits: '
        '(1) the white duck with a green knit cap, headset, green scarf and black vest; (2) the cheerful man with black curly '
        'hair, round glasses, black T-shirt and navy jeans; (3) the sage-green-haired scientist girl with round glasses in a '
        'long white lab coat holding up a teal Erlenmeyer flask; (4) NEW: Rei-chan from the fourth identity image, a girl with '
        'very long straight black hair, amber eyes, a black high-collar jacket with thin orange circuit lines and hanging '
        'straps, black trousers and boots, holding a small open book. Pigments: duck and lab coat in pale chalky bone-white '
        'with charcoal outline, green cap, scarf and hair in a muted green earth, teal flask in a muted blue-green earth, '
        "Rei-chan's circuit lines in a muted orange ochre, dark hair, jacket and glasses in charcoal. "),
}

if __name__ == '__main__':
    for key, (attach, subject) in FRIEZES.items():
        orig = MODELS / key / 'source/original'
        orig.mkdir(parents=True, exist_ok=True)
        png = orig / f'reference-v{VERSION}.png'
        prompt = COMMON + subject
        text = (
            'Use your built-in image generation tool (image_gen) to create exactly ONE image with a transparent background. '
            'Do not write code, do not use Python/PIL or any drawing library, and do not create or edit any files other than '
            f'the PNG and the prompt text named below.\n\nPrompt:\n"{prompt}"\n\n'
            f'Save the generated image as a PNG exactly at:\n{png.as_posix()}\n'
            '(copy it from wherever the image tool stores its outputs). Then write the exact full prompt you sent to the image '
            f'tool to:\n{png.with_suffix(".prompt.txt").as_posix()}\nReply with the saved path.\n')
        (orig / f'codex-request-v{VERSION}.txt').write_text(text, encoding='utf-8')
        (orig / f'codex-attach-v{VERSION}.txt').write_text('\n'.join(str(ROOT / p) for p in attach) + '\n', encoding='utf-8')
        print('wrote', key)
