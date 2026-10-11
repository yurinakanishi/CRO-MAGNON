"""Download the CC0 field recordings used by prepare-nature-remake.py (explicit network step).

Freesound originals require a login, so the public high-quality OGG previews (~190 kb/s
Vorbis of the 48/96 kHz originals) are used. Every row lists the sound page, author and
licence as published there. Writes only under assets/nature-audio/remake-20261011/source
and records SHA-256 + bytes in assets/nature-audio/remake-20261011/sources.json.
`--cache DIR` copies an already downloaded <id>.ogg instead of fetching it again.
"""
import hashlib, json, pathlib, shutil, sys, time, urllib.request

ROOT = pathlib.Path(__file__).resolve().parents[1]
REMAKE = ROOT / 'assets/nature-audio/remake-20261011'
OUT = REMAKE / 'source/freesound'
# id, author, preview user id, title, original format, role in the game
SOURCES = [
    (176249, 'strangy', 1222472, 'Wind through the grass', '48 kHz / 24 bit, Sanken CSS-5 M-S', 'wind'),
    (337614, 'borralbi', 2774517, 'Murmuring Stream', '96 kHz / 24 bit, Olympus LS-12 + Rycote', 'river'),
    (690215, 'Nox_Sound', 9250976, 'Ambiance_Stream_Moderate_Skaftafell_Loop_Stereo_01', '48 kHz / 24 bit, Zoom H5', 'stream'),
    (698306, 'Nox_Sound', 9250976, 'Ambiance_Waterfall_Small_Close_Loop_Stereo', '96 kHz / 24 bit, Sony PCM-D100', 'waterfall'),
    (829627, 'Nox_Sound', 9250976, 'Ambiance_Ocean_Praia_dos_Moinhos_Loop_Stereo_02', '96 kHz / 24 bit, Sony PCM-D100', 'shore'),
    (512334, 'felix.blume', 1661766, 'Light rain in a field of bananas trees', '96 kHz / 24 bit, AB B&K 4006, Sound Devices 833', 'rain'),
    (637523, 'kyles', 612689, 'fire small campfire crackling short +air tone', '48 kHz / 24 bit', 'fire'),
    (40699, 'Spandau', 25133, 'campfire.wav', '48 kHz / 24 bit, spaced omnis', 'torch'),
    (202900, 'felix.blume', 1661766, 'Birds singing in the countryside, Oklahoma, USA', '96 kHz / 24 bit, Schoeps CCM41+CCM8 M-S', 'birds'),
    (116791, 'nigelcoop', 1088850, 'Blackbird 252.wav', '44.1 kHz / 16 bit', 'birds'),
    (234554, 'Electroviolence', 4238641, 'Dripping water', '44.1 kHz / 16 bit', 'drops'),
    (648945, 'Nox_Sound', 9250976, 'IR_Cathedral_5m_Stereo', '96 kHz / 24 bit, Sony PCM-D100', 'cave reverb, cave music reverb'),
    (585739, 'Nox_Sound', 9250976, 'IR_Church_Small_5m_Stereo', '48 kHz / 24 bit, Zoom H5', 'music reverb'),
    (556042, 'Nox_Sound', 9250976, 'Footsteps_Mountain_Boots_Grass_Mono', '48 kHz / 24 bit', 'grass steps, jump'),
    (564893, 'Nox_Sound', 9250976, 'Footsteps_Mountain_Boots_Wet_Sand_Sequence_Mono', '48 kHz / 24 bit', 'sand steps'),
    (558472, 'Nox_Sound', 9250976, 'Footsteps_Mountain_Boots_Rock_Walk_Sequence_Mono', '48 kHz / 24 bit, Rode NTG4+', 'stone steps'),
    (613849, 'Nox_Sound', 9250976, 'Footsteps_Mountain_Boots_Snow_Walk_Mono', '48 kHz / 24 bit, Tascam DR-05', 'snow steps'),
    (861369, 'ChristopherJngs', 8154783, 'Splashing Footsteps Shallow Water', '44.1 kHz / 16 bit', 'water steps'),
    (427979, 'Kinoton', 2247456, 'Short Whoosh, 13x', '48 kHz / 24 bit', 'attack, throw'),
    (586841, 'Kinoton', 2247456, 'Power Kick, Body Impact, 7x', '48 kHz / 24 bit, MKH 416', 'hurt'),
    (624478, 'ValentinPetiteau', 10443988, 'Cloth - heavy - shake - run - trouser', '96 kHz / 24 bit', 'jump'),
    (435291, 'zazz.sound.design', 726853, 'Cloth Rustle 1', '48 kHz / 24 bit', 'mount'),
    (554561, 'dynamique', 456862, 'fabric rubbing / pulling', '48 kHz / 16 bit', 'pet'),
    (579409, 'Plaban2001', 12378178, 'rock_collisions.wav', '44.1 kHz / 32 bit', 'gather stone'),
    (846927, 'Nox_Sound', 9250976, 'Foley_Object_Basket_WithWood_Stick_PickUp_Into_Sequence_Stereo', '96 kHz / 24 bit', 'gather wood'),
    (559082, 'Nox_Sound', 9250976, 'Foley_Movement_High_Grass_Mono', '48 kHz / 24 bit', 'gather plant'),
    (846930, 'Nox_Sound', 9250976, 'Foley_Object_Match_Ignition_Sequence_Stereo', '96 kHz / 24 bit', 'torch switch'),
]


def main():
    cache = pathlib.Path(sys.argv[sys.argv.index('--cache') + 1]) if '--cache' in sys.argv else None
    OUT.mkdir(parents=True, exist_ok=True)
    rows = []
    for sid, author, uid, title, original, role in SOURCES:
        target = OUT / f'{sid}.ogg'
        url = f'https://cdn.freesound.org/previews/{sid // 1000}/{sid}_{uid}-hq.ogg'
        if not target.exists():
            if cache and (cache / f'{sid}.ogg').exists():
                shutil.copyfile(cache / f'{sid}.ogg', target)
            else:
                req = urllib.request.Request(url, headers={'User-Agent': 'cro-magnon-audio'})
                with urllib.request.urlopen(req, timeout=300) as r:
                    target.write_bytes(r.read())
                time.sleep(1)
        data = target.read_bytes()
        rows.append({'file': f'{sid}.ogg', 'id': sid, 'title': title, 'author': author,
                     'page': f'https://freesound.org/people/{author}/sounds/{sid}/', 'url': url,
                     'license': 'CC0-1.0', 'original': original, 'role': role,
                     'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        print(sid, role, len(data))
    (REMAKE / 'sources.json').write_text(json.dumps({
        'retrieved': '2026-10-11',
        'note': 'Freesound HQ OGG previews of CC0 originals; licence verified on each sound page on 2026-10-11.',
        'sources': rows}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
