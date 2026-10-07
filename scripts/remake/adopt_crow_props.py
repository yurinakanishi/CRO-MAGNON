"""Register the TRELLIS crow rank props (and the berry cluster) that replace code-built primitives.

python scripts/remake/adopt_crow_props.py <key> [<key> ...]
Writes output/asset-remake/adopt-<key>.json and runs scripts/remake/adopt_new_asset.mjs (kind 'prop').
"""
import glob
import json
import subprocess
import sys

M = 'C:/Users/yurin/Desktop/projects/CRO-MAGNON/output/model-generation/models'
ITEMS = {
    'crow-soldier-spear': ('白羽教団の門徒の槍', 'CrowSoldierShaft/CrowSoldierSpearhead (cylinder + 4-sided cone)'),
    'crow-brute-axe': ('白羽教団の戦僧の両刃斧', 'CrowBruteAxeShaft/CrowBruteAxeBladeL/R (cylinder + two cones)'),
    'crow-prelate-glaive': ('白羽教団の大司祭の薙刀', 'CrowPrelateBlade (one cone on the crow staff)'),
    'crow-pontiff-crozier': ('白羽教皇の司教杖', 'CrowPontiffCrozierShaft/CrozierRing (cylinder + torus)'),
    'crow-hide-shield': ('白羽教団の門徒の獣皮の盾', 'CrowSoldierHideShield/ShieldBoss (cylinder + sphere)'),
    'crow-bone-pauldrons': ('白羽教団の戦僧の骨の肩当て', 'CrowBrutePauldronL/R (two half-spheres)'),
    'crow-red-mantle': ('白羽教団の大司祭の赤い肩衣', 'CrowPrelateRedMantleL/R (two half-spheres)'),
    'crow-ivory-vestment': ('白羽教皇の象牙色の祭服', 'CrowPontiffVestmentL/R (two half-spheres)'),
    'crow-pontiff-crown': ('白羽教皇の冠', 'CrowPontiffHalo/Spire1-7 (torus + seven cones)'),
    'berry-cluster': ('野いちごの房', 'berry-fruit spheres in src/world3d.ts decorateResource'),
}
for key in sys.argv[1:]:
    name, rep = ITEMS[key]
    W = f'{M}/{key}/work/candidate-02'
    run = sorted(glob.glob(f'{W}/low-poly/m*/candidate.glb'))[-1].replace('\\', '/')
    rdir = run.rsplit('/', 1)[0]
    rp = json.load(open(f'{rdir}/process-report.json'))
    ref = sorted(glob.glob(f'{M}/{key}/source/original/*.png'))[0].replace('\\', '/')
    dense = sorted(glob.glob(f'{W}/trellis/dense-*.glb'))[0].replace('\\', '/')
    attach = 'resource LOD root at berryAnchors (src/world3d.ts decorateResource)' if key == 'berry-cluster' \
        else 'crow rig bone (src/crow-faction-visuals.ts CROW_RANK_PARTS)'
    spec = {
        'key': key, 'name': name, 'kind': 'prop', 'glb': run, 'reference': ref, 'dense': dense,
        'processReport': rdir.replace('C:/Users/yurin/Desktop/projects/CRO-MAGNON/', '') + '/process-report.json',
        'replaces': f'code-built primitives: {rep}',
        'placement': {'attachment': attach},
        'notes': [f"Replaces the code-built primitive {rep}. Codex image_gen reference -> TRELLIS-2 1024 -> meshopt "
                  f"{rp['outputs'][0]['triangles']} tris -> xatlas -> albedo + baked normal. Ground-centred pivot, +Y up."],
    }
    out = f'output/asset-remake/adopt-{key}.json'
    open(out, 'w', encoding='utf8').write(json.dumps(spec, ensure_ascii=False, indent=1))
    res = subprocess.run(['node', 'scripts/remake/adopt_new_asset.mjs', out], capture_output=True, text=True, encoding='utf8')
    print(key, res.stdout.strip()[:220], res.stderr.strip()[-300:])
