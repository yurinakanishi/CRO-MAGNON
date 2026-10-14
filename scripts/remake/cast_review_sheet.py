"""Review sheet of a chibi cast candidate: the design image, the model from three sides next to the
adopted chibi woman, the face, the routed in-game preview and six poses. It renders nothing: it composes
the chibi_views.mjs renders made by scripts/remake/cast_qa_renders.sh and the qa_candidate_actor.mjs
screenshots.

  python scripts/remake/cast_review_sheet.py WORK REFERENCE.png GAME_FOLDER "TITLE" "MODEL LABEL" [CLOSE FRONT]

WORK is the candidate work folder (its qa/ holds final, final-face, final-poses and woman-c5 renders).
Writes WORK/qa/review.jpg.
"""
import sys

from PIL import Image, ImageChops, ImageDraw, ImageFont

work, reference, game, title, label = sys.argv[1:6]
# the two in-game shots (a camera pulled in by a tent fades the player out of game-close and game-front)
close_shot, front_shot = (sys.argv[6:8] + ['game-close', 'game-front'][len(sys.argv[6:8]):])
Q = f'{work}/qa'
bold = ImageFont.truetype('C:/Windows/Fonts/meiryob.ttc', 26)
small = ImageFont.truetype('C:/Windows/Fonts/meiryo.ttc', 20)
sheet = Image.new('RGB', (2900, 1180), (245, 245, 245))
d = ImageDraw.Draw(sheet)

ref = Image.open(reference).convert('RGB')
bg = Image.new('RGB', ref.size, ref.getpixel((4, 4)))
box = ImageChops.difference(ref, bg).convert('L').point(lambda v: 255 if v > 28 else 0).getbbox()
x0, y0, x1, y1 = box
ref = ref.crop((max(0, x0 - 20), max(0, y0 - 20), min(ref.width, x1 + 20), min(ref.height, y1 + 20)))
ref = ref.resize((int(480 * ref.width / ref.height), 480), Image.LANCZOS)
d.text((20, 10), title, fill=(30, 30, 30), font=bold)
sheet.paste(ref, (20, 50))
left = 40 + ref.width
d.text((left, 10), label, fill=(30, 30, 30), font=bold)
for i, view in enumerate(['front', 'angle', 'rear']):
    sheet.paste(Image.open(f'{Q}/final/whole-colour-{view}.png').convert('RGB'), (left + i * 490, 50))
d.text((left + 1480, 10), '採用済みの女性と並べると', fill=(30, 30, 30), font=bold)
sheet.paste(Image.open(f'{Q}/woman-c5/whole-colour-front.png').convert('RGB'), (left + 1470, 50))
sheet.paste(Image.open(f'{Q}/final/whole-colour-front.png').convert('RGB').crop((80, 0, 400, 480)), (left + 1960, 50))

d.text((20, 555), '顔', fill=(30, 30, 30), font=bold)
for i, view in enumerate(['front', 'angle']):
    face = Image.open(f'{Q}/final-face/face-colour-{view}.png').convert('RGB').resize((460, 460))
    sheet.paste(face, (20 + i * 470, 590))
d.text((970, 555), 'ゲーム内（女性の枠に差し替えて確認）', fill=(30, 30, 30), font=bold)
close = Image.open(f'{game}/{close_shot}.png').convert('RGB').crop((320, 0, 960, 800)).resize((368, 460))
sheet.paste(close, (970, 590))
front = Image.open(f'{game}/{front_shot}.png').convert('RGB').crop((240, 0, 1040, 800)).resize((460, 460))
sheet.paste(front, (1348, 590))
d.text((1830, 555), '動き', fill=(30, 30, 30), font=bold)
poses = {'Walk_Loop-0.3': '歩く', 'Run_Loop-0.3': '走る', 'Attack-0.47': '攻撃', 'Eat-0.55': '食べる',
         'Wave-0.5': '手を振る', 'Gather-0.5': '拾う'}
for i, (clip, name) in enumerate(poses.items()):
    x, y = 1830 + (i % 3) * 350, 590 + (i // 3) * 290
    d.rectangle([x, y, x + 339, y + 279], fill=(190, 195, 199))
    pose = Image.open(f'{Q}/final-poses/whole-colour-angle-{clip}.png').convert('RGB').resize((280, 280))
    sheet.paste(pose, (x + 30, y))
    d.text((x + 6, y + 6), name, fill=(40, 40, 40), font=small)
sheet.save(f'{Q}/review.jpg', quality=90)
print(f'{Q}/review.jpg', sheet.size)
