"""Where do skinned edges stretch? Reports worst edges, rest positions and bones."""
import sys, json
from pathlib import Path
import numpy as np
ROOT = Path(__file__).resolve().parents[6]
model = ROOT/'output/model-generation/models/sabertooth-tiger'; rev = sys.argv[1]; clips = sys.argv[2].split(',')
sys.path.insert(0, str(ROOT.parent/'threed-model-creation/trellis.cpp/tools')); sys.path.insert(0, str(model/'workflow/candidate-01'))
from glb_skin import Rigged
import graph_tools as gt
r = Rigged(model/f'work/rig/revision-{rev}/candidate.glb'); g = r.gltf
P = r.skinned({}, 0); F = r.merged_faces(); E = gt.unique_edges(F); L0 = np.linalg.norm(P[E[:, 1]]-P[E[:, 0]], axis=1); H = float(np.ptp(P[:, 1])); valid = L0 > .0018*H
J = np.concatenate([p['J'] for p in r.prims]) if 'J' in r.prims[0] else None
Wt = np.concatenate([p['W'] for p in r.prims]); names = [g['nodes'][j]['name'] for j in r.joints]
print('keys', list(r.prims[0].keys()))
for a in g['animations']:
    if a['name'] not in clips: continue
    tr = r.tracks(a); dur = max(s.times[-1] for t in tr.values() for s in t.values()); worst = None
    for t in np.linspace(0, dur, 25):
        q = r.skinned(tr, float(t)); ratio = np.where(valid, np.linalg.norm(q[E[:, 1]]-q[E[:, 0]], axis=1)/np.maximum(L0, 1e-9), 0)
        i = int(np.argmax(ratio))
        if worst is None or ratio[i] > worst[0]: worst = (float(ratio[i]), float(t), i, int((ratio > 6).sum()))
    ratio, t, i, count = worst; a_, b_ = E[i]
    def desc(v):
        top = np.argsort(-Wt[v])[:3]; jj = J[v] if J is not None else top
        return dict(rest=[round(x, 3) for x in P[v]], bones=[(names[int(jj[k])] if J is not None else names[int(k)], round(float(Wt[v][k]), 2)) for k in (range(3) if J is not None else top)])
    print(a['name'], 'ratio', round(ratio, 1), 't', round(t, 2), 'edgesOver6', count, 'restLen', round(float(L0[i]), 4), desc(a_), desc(b_))
