"""Write the Codex built-in image_gen requests for the friend mascots and Howkey's flask.

python assets/friend-mascots/workflow/make_requests.py [version]
Each request asks Codex to save exactly one PNG and its prompt in the model workspace.
"""
import sys
from pathlib import Path

ROOT = next(p for p in Path(__file__).resolve().parents if (p / 'package.json').is_file())
VERSION = sys.argv[1] if len(sys.argv) > 1 else '1'
MODELS = ROOT / 'output/model-generation/models'

COMMON_POSE = (
    'Pose: standing upright, straight-on front view, full body. Both arms extend strongly sideways, about 15 degrees '
    'below horizontal from the shoulders, elbows straight, hands open with fingers together. Leave a LARGE CLEAR AIR GAP, at '
    'least the width of a whole hand, between each arm, sleeve and hand and the torso, hair, clothing and tail. Nothing connects '
    'the arms to the body below the armpit. Feet slightly apart and parallel with flat soles. ')
COMMON_STYLE = (
    'Render it as a real rounded-volume matte collectible 3D vinyl figure (cute chibi proportions, about 2.3 heads tall, '
    'big head, short limbs), continuous solid surfaces, crisp readable forms, soft even neutral studio light from all sides, '
    'no harsh highlights or cast shadows. The whole character centred inside the frame with a small margin; all ears, hair, '
    'hat, feet and tail inside the frame. Transparent background. No floor, base, pedestal, text, logo, watermark, props, '
    'second character or multiple views. This image is the input for single-image 3D reconstruction and skinning, so the '
    'separation of each arm from the body silhouette is essential.')

MASCOTS = {
    'saber-mascot': (['assets/friend-mascots/saber-mascot/source/user-reference.jpg'],
        'Identity-preserving 3D mascot of the cat-eared girl in the attached illustration. Keep: long wavy golden-blonde hair '
        'reaching the waist that falls behind the shoulders and down the back (not in front of the arms), golden-yellow cat ears '
        'with white inner fur, big bright blue eyes, a happy open-mouthed smile, a small white five-petal flower clip in her hair, '
        'a wide woven straw sun hat with a white ribbon band and a white bow (ears poke out), a white sleeveless sundress with thin '
        'straps, frilled neckline, small buttons down the bodice and a white sash tied in a bow at the waist, a knee-length skirt '
        'with frilled hem, simple white sandals, and one fluffy golden-yellow cat tail curving out to one side behind her. '
        'Do not include the ice cream, spoon, bench or scenery. '),
    'fairy-mascot': (['assets/friend-mascots/fairy-mascot/source/x-avatar-400.jpg'],
        'A cute stylised chibi mascot of the friendly adult woman in the attached profile photo, recognisably based on her '
        'hairstyle, colouring and outfit but clearly a stylised toy figure, not a photorealistic likeness. Shoulder-length layered '
        'chestnut-brown hair with soft side-swept bangs, warm brown eyes, a gentle closed-mouth smile, a soft lavender blouse with '
        'a draped lavender bow scarf at the neck, a knee-length cream skirt and lavender flat shoes. As a playful nod to her name '
        '"Fairy", give her one pair of small rounded opaque pale-lilac fairy wings on her upper back, compact and close behind the '
        'shoulders, never touching the arms. '),
    'sagasa-mascot': (['assets/friend-mascots/sagasa-mascot/source/user-reference.jpg'],
        'Identity-preserving 3D mascot of the chibi boy in the attached front/side/back turnaround sheet. Keep: voluminous '
        'dark-brown curly hair, black rectangular glasses, brown eyes, a big happy open-mouthed smile, a small silver bar earring, '
        'a black hoodie with white drawstrings and the hood down, a royal-blue zip-up vest with chest flap pockets, black baggy '
        'cargo pants with side pockets, and black-and-white high-top sneakers (plain, no brand logos). '),
    'nukonuko-mascot': (['assets/friend-mascots/nukonuko-mascot/source/x-avatar-400.jpg'],
        'Identity-preserving 3D mascot of the cat-eared girl in the attached profile illustration. Keep: long wavy dark-brown hair '
        'falling behind the shoulders (not in front of the arms), dark-brown cat ears with pink inner ears, warm amber-gold eyes, '
        'a gentle smile with rosy cheeks, a black choker collar with a round golden star medallion pendant, and one long '
        'dark-brown cat tail curving out to one side behind her. Her outfit is not visible in the portrait, so dress her to match '
        'its warm palette: a modest cream blouse with short puffed sleeves under a chocolate-brown pinafore dress with a small gold '
        'button, and brown ankle boots. '),
    'otani-mascot': (['assets/friend-mascots/otani-mascot/source/x-avatar-400.jpg'],
        'Identity-preserving 3D mascot of the duck character in the attached pixel-art profile icon, reinterpreted as a smooth '
        '3D figure (not pixel art, no pixel blocks). A cute chibi white duck standing upright on two orange webbed feet: round '
        'white body and head, a bright orange bill with a happy open smile, large green eyes, a green slouchy knit cap with a small '
        'square badge showing a white mouse-cursor arrow, a black headset with round green ear cups and a small microphone, a '
        'green scarf, and a black vest with a few small square green badges. Its two white wings are held out sideways like arms, '
        'ending in feathered tips. Do not include the small monitor robot. '),
    'urata-mascot': (['assets/friend-mascots/urata-mascot/source/x-avatar-400.jpg'],
        'Identity-preserving 3D mascot of the man shown as the gachapon keychain figure in the attached profile picture. Keep: '
        'voluminous black curly hair, round dark-brown glasses, a big cheerful open-mouthed smile, a black crew-neck short-sleeve '
        'T-shirt; add dark navy straight jeans and white sneakers. No keychain, ball chain, ring, packaging or background figures. '),
    'rei-mascot': (['assets/friend-mascots/rei-mascot/source/user-reference-sheet.png',
                    'assets/friend-mascots/rei-mascot/source/user-reference-illustration.jpg'],
        'Identity-preserving 3D mascot of Rei-chan (怜ちゃん), the AI writer girl in the attached character sheet and '
        'illustration. Keep: very long straight glossy black hair falling behind the shoulders and down the back (not in '
        'front of the arms) with side bangs, warm glowing amber-orange eyes, a calm gentle smile, a small black-and-orange '
        'tech hair clip, dangling orange geometric earrings, a glossy black high-collar techwear jacket with thin neon-orange '
        'circuit lines, orange binary-code patches on the sleeves and back, and hanging black straps with orange buckles, '
        'slim black trousers with orange circuit seams, and chunky black lace-up boots with glowing orange soles. Neon '
        'orange accents (#FF8C00) are painted on the surfaces, matte, not emissive. Do not include the book, pen, city, '
        'data streams or text. '),
}

FLASK = (
    'Single-object reconstruction reference for TRELLIS image-to-3D: one stylised laboratory Erlenmeyer flask as a '
    'hand-held game prop for the attached scientist character (match her teal, cream and sage palette). Conical body with a flat '
    'round base, a narrow cylindrical neck with a rolled lip and a small cork stopper, filled about two-thirds with glowing '
    'teal-green liquid with a few round bubbles, and a few white graduation marks on the glass. Render the glass as a solid matte '
    'pale aqua surface with painted soft highlights (no real transparency or refraction) so its shape is fully solid. '
    'Camera: three-quarter front view from slightly above, the whole flask centred with margin. Soft even neutral studio light, '
    'no cast shadows. Transparent background. No hand, character, text, logo, table, base or second object.')


def write(key, attach, prompt, note):
    orig = MODELS / key / 'source/original'
    orig.mkdir(parents=True, exist_ok=True)
    png = orig / f'reference-v{VERSION}.png'
    text = (
        'Use your built-in image generation tool (image_gen) to create exactly ONE image. Do not write code, do not use '
        'Python/PIL or any drawing library, and do not create or edit any files other than the PNG and the prompt text named '
        f'below.\n\n{note}\n\nPrompt:\n"{prompt}"\n\n'
        f'Save the generated image as a PNG exactly at:\n{png.as_posix()}\n'
        '(copy it from wherever the image tool stores its outputs). Then write the exact full prompt you sent to the image '
        f'tool to:\n{png.with_suffix(".prompt.txt").as_posix()}\nReply with the saved path.\n')
    (orig / f'codex-request-v{VERSION}.txt').write_text(text, encoding='utf-8')
    (orig / f'codex-attach-v{VERSION}.txt').write_text('\n'.join(str(ROOT / p) for p in attach) + '\n', encoding='utf-8')
    print('wrote', key)


if __name__ == '__main__':
    for key, (attach, subject) in MASCOTS.items():
        write(key, attach, subject + COMMON_POSE + COMMON_STYLE, 'Use the attached image only as the identity reference.')
    write('howkey-flask', ['public/models/howkey-scientist/portrait.png'], FLASK,
          'The attached image shows the character who will hold this object; match its art style and palette but draw ONLY the object.')
