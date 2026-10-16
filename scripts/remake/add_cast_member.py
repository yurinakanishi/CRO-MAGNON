"""Adds an adopted chibi cast member to the game's tables (docs/chibi-cast-2026-10-13.md), after its model
was adopted with adopt_candidate_character.mjs --new and its portrait placed:

  python scripts/remake/add_cast_member.py --key cro-magnon-girl-bear --gender female \
      --variant 子グマずきんの女の子 --english "Bear-Cub Hood Girl" --dye-height 0.93 \
      --world-after cro-magnon-girl-feather --reference-version cast1-g2 --prompt-file cast1-g2.png [--dye-keep H0,H1,S0,S1,V0,V1]

Edits (each exactly once, failing if the key is already there): the profile after the last entry of
shared/character-profiles.mts (the chibi body plan of the woman), the English names, the HUD portrait
crop and its hidden pixel face in src/style.css, the clothing dye rule, the assets/world-models.json entry
(the design prompt from prompts-cast1.json), the rigid-face list (CHIBI_FACE_KEYS of
scripts/face-remake/stabilize-chibi-heads.mjs, tested by tests/character-face-rigidity.test.mjs) and the
character counts of the tests and the Cloudflare character privacy check. The English names include the
picker's single name (子グマずきんのクロマニョン人女の子). Files are LF.
"""
import argparse
import json
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
ap = argparse.ArgumentParser()
ap.add_argument('--key', required=True)
ap.add_argument('--gender', required=True, choices=['female', 'male'])
ap.add_argument('--variant', required=True, help='Japanese name after "クロマニョン人 "')
ap.add_argument('--english', required=True)
ap.add_argument('--dye-height', type=float, required=True, help='top of the dyed body, as a fraction of its height')
ap.add_argument('--dye-keep', default='', help='H0,H1,S0,S1,V0,V1 colours of the body kept (e.g. a pelt that continues the hood)')
ap.add_argument('--dye-note', default='')
ap.add_argument('--world-after', required=True, help='the world-models.json entry the new one follows')
ap.add_argument('--reference-version', required=True)
ap.add_argument('--prompt-file', required=True, help='file name in prompts-cast1.json')
ap.add_argument('--revision', default='c1-r01')
ap.add_argument('--pet-reach', type=float, default=0.75, help='petReachScale: 0.6 when the arms hang above the knees (rig '
                '--body-over-knees), 0.75 as the woman whose shoulders stand 5 cm in front of her hips')
ap.add_argument('--profile-note', default='', help='a comment above the profile entry')
args = ap.parse_args()
key = args.key
name = f'クロマニョン人 {args.variant}'


def edit(path, old, new):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    assert text.count(old) == 1, f'{path}: {old[:60]!r} found {text.count(old)} times'
    p.write_text(text.replace(old, new), encoding='utf-8', newline='\n')


def bump(path, pattern):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    match = re.search(pattern, text)
    assert match, f'{path}: {pattern}'
    number = int(match.group(1))
    text = text[:match.start(1)] + str(number + 1) + text[match.end(1):]
    p.write_text(text, encoding='utf-8', newline='\n')
    return number + 1


profiles = (ROOT / 'shared/character-profiles.mts').read_text(encoding='utf-8')
assert f"key: '{key}'" not in profiles, f'{key} is already a profile'
profile_note = f'\n  // {args.profile_note}' if args.profile_note else ''
edit('shared/character-profiles.mts', '\n]);\n', f"""{profile_note}
  Object.freeze({{
    species: 'cro',
    gender: '{args.gender}',
    key: '{key}',
    carryable: false,
    name: '{name}',
    height: 1.45,
    botHandRatios: {{ side: 0.12, front: 0.13, height: 0.6 }},
    cameraFocus: 1.15,
    petReachScale: {args.pet_reach},
  }}),
]);
""")
english = (ROOT / 'src/language-en.ts').read_text(encoding='utf-8')
last = [line for line in english.splitlines() if line.startswith("  'クロマニョン人 ") and '·' in line][-1]
edit('src/language-en.ts', last + '\n', f"""{last}
  {args.variant}: '{args.english}',
  '{name}': 'Cro-Magnon · {args.english}',
""")
# the picker's single name (src/character-selection.ts characterChoiceName): 子グマずきんのクロマニョン人女の子
child = re.match(r'^(.+)の(女の子|男の子)$', args.variant)
assert child, f'{args.variant}: a child variant ends in の女の子 or の男の子'
english = (ROOT / 'src/language-en.ts').read_text(encoding='utf-8')
single = [line for line in english.splitlines() if re.match(r'^  \S+のクロマニョン人(女の子|男の子): ', line)][-1]
edit('src/language-en.ts', single + '\n', f"""{single}
  {child[1]}のクロマニョン人{child[2]}: 'Cro-Magnon {args.english}',
""")
edit('src/style.css', """/* The chibi cast: the woman's crop. */
""", f"""/* The chibi cast: the woman's crop. */
.portrait.{key} {{
  background: #6d6d6d url('/models/{key}/portrait.png') 50% 12%/280% auto no-repeat;
}}
""")
edit('src/style.css', """.portrait.cro-magnon-woman:before,
.portrait.cro-magnon-woman:after,
.portrait.cro-magnon-woman i,
""", f""".portrait.cro-magnon-woman:before,
.portrait.cro-magnon-woman:after,
.portrait.cro-magnon-woman i,
.portrait.{key}:before,
.portrait.{key}:after,
.portrait.{key} i,
""")
keep = f"\n      keep: [{', '.join(args.dye_keep.split(','))}]," if args.dye_keep else ''
note = f'    // {args.dye_note}\n' if args.dye_note else ''
edit('src/clothing-dye-rules.ts', """    'cro-magnon-hunter': { materials: ['BodySurface'], skin: SKIN },""", f"""{note}    '{key}': {{
      materials: ['BodySurface'],
      skin: [5, 24, 0.3, 0.72, 0.8, 1],{keep}
      height: [0, {args.dye_height}],
    }},
    'cro-magnon-hunter': {{ materials: ['BodySurface'], skin: SKIN }},""")

# the large-headed characters whose delivered face must stay rigid (tests/character-face-rigidity.test.mjs)
faces = (ROOT / 'scripts/face-remake/stabilize-chibi-heads.mjs').read_text(encoding='utf-8')
start = faces.index('export const CHIBI_FACE_KEYS = [')
close = faces.index('\n];\n', start)
assert f"'{key}'" not in faces[start:close]
(ROOT / 'scripts/face-remake/stabilize-chibi-heads.mjs').write_text(
    faces[:close] + f"\n  '{key}'," + faces[close:], encoding='utf-8', newline='\n')

world = json.loads((ROOT / 'assets/world-models.json').read_text(encoding='utf-8'))
assert not any(entry.get('key') == key for entry in world['assets'])
prompts = json.loads((ROOT / 'output/model-generation/models/chibi-cast/source/original/prompts-cast1.json').read_text(encoding='utf-8'))
prompt = next(item['prompt'] for item in prompts['items'] if item['file'].endswith(args.prompt_file))
asset = json.loads((ROOT / f'public/models/{key}/asset.json').read_text(encoding='utf-8'))
index = next(i for i, entry in enumerate(world['assets']) if entry.get('key') == args.world_after)
world['assets'].insert(index + 1, {
    'key': key, 'name': name, 'kind': 'humanoid', 'height': 1.45, 'gender': args.gender, 'species': 'cro',
    'status': 'remake-candidate-1-adopted', 'geometryResolution': 1024, 'referenceVersion': args.reference_version,
    'subject': prompt, 'sha256': asset['sha256'], 'delivery': asset['url'],
    'gameQA': f'assets/{key}/qa/{args.revision}.json', 'triangles': asset['triangles'], 'revision': args.revision,
    'review': f'assets/{key}/qa/{args.revision}.json'})
(ROOT / 'assets/world-models.json').write_text(json.dumps(world, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')

counts = {
    'characters': bump('tests/characters.test.mjs', r'new Set\(CHARACTER_MODELS\.map\(\(model\) => model\.key\)\)\.size, (\d+)\)'),
    'served': bump('tests/local-visibility.test.mjs', r'assert\.equal\(CHARACTER_MODELS\.length, (\d+) \+ Number\(maruimo\)\)'),
    'privacy': bump('scripts/qa-cloudflare-character-privacy.mjs', r'assert\.equal\(CHARACTER_MODELS\.length, (\d+)\);'),
    'public': bump('scripts/qa-cloudflare-character-privacy.mjs', r'assert\.equal\(publicCharacters\.length, (\d+)\);'),
    'publicDyeRules': bump('tests/clothing-dye.test.mjs', r'assert\.equal\(Object\.keys\(rules\)\.length, (\d+)\);'),
}
# the edited sources as Prettier writes them (a long key wraps its portrait background)
subprocess.run('npx prettier --write src/style.css shared/character-profiles.mts src/language-en.ts src/clothing-dye-rules.ts',
               shell=True, cwd=ROOT, check=True, stdout=subprocess.DEVNULL)
print(json.dumps({'added': key, 'name': name, 'counts': counts}))
