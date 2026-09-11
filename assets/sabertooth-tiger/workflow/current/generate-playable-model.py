"""Codex-owned serial local TRELLIS reconstruction with durable provenance."""
import argparse
import hashlib
import json
import os
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path

from PIL import Image
import numpy as np

PROJECT=next(p for p in Path(__file__).resolve().parents if (p/'package.json').is_file() and (p/'shared').is_dir())
MODELS=PROJECT/'output/model-generation/models'
STUDIO=PROJECT.parent/'threed-model-creation/trellis-studio'
CLI=STUDIO/'runtime/trellis-cli.exe'

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def write(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

def run(command,log):
    started=time.monotonic()
    print(json.dumps({'stage':log.stem,'status':'running','log':str(log)},ensure_ascii=False),flush=True)
    with log.open('w',encoding='utf-8') as stream:
        result=subprocess.run([str(x) for x in command],stdout=stream,stderr=subprocess.STDOUT)
    if result.returncode:
        raise RuntimeError(f'{log.stem} failed ({result.returncode}); see {log}')
    return round(time.monotonic()-started,2)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('key')
    parser.add_argument('--seed',type=int,default=42)
    parser.add_argument('--reference-version',type=int,default=1)
    args=parser.parse_args()
    spec=json.loads((MODELS/args.key/'request-spec.json').read_text(encoding='utf-8'))
    root=MODELS/args.key
    version=args.reference_version
    source=root/f'source/original/reference-v{version}.png'
    assert source.is_file(), source
    prepared=root/'source/prepared' if version==1 else root/f'source/prepared-v{version}'
    prepared.mkdir(parents=True,exist_ok=True)
    resolution=spec.get('geometryResolution',1024)
    suffix='' if version==1 else f'-ref{version:02d}'
    dense=root/f'work/trellis/dense-res{resolution}-seed{args.seed:04d}{suffix}.glb'
    if dense.exists():
        raise RuntimeError('Refusing to overwrite a dense candidate; inspect/reuse it or choose a new seed.')
    lock=MODELS/'world-trellis.lock'
    with lock.open('x') as f:
        f.write(json.dumps({'pid':os.getpid(),'key':args.key,'started':datetime.now(timezone.utc).isoformat()}))
    try:
        prompt_file=source.parent/('prompt.txt' if version==1 else f'prompt-v{version}.txt')
        write(source.with_suffix('.json'),{'generator':'Codex CLI built-in image_gen (gpt-5.6-sol, reasoning medium), run from Claude Code at user request','prompt':prompt_file.read_text(encoding='utf-8').strip(),
              'source':source.relative_to(root).as_posix(),'sha256':sha(source),'bytes':source.stat().st_size,
              'fallback':'ZImage unavailable in the established local toolchain; permitted equivalent generator.',
              'author':'Codex image_gen; pipeline run by Claude Code','claude_used':True})
        conditioning=prepared/'conditioning.png'
        if not conditioning.exists():
            raw=prepared/'birefnet.glb'
            run([CLI,'--image',source,'--output',raw,'--models',STUDIO/'models','--bg-removal','birefnet','--bg-only','--dump-bg'],prepared/'birefnet.log')
            cutout=next(prepared.glob('*cutout*.png'))
            rgba=Image.open(cutout).convert('RGBA')
            alpha=np.asarray(rgba)[:,:,3]
            ys,xs=np.nonzero(alpha>8)
            assert len(xs)>100, 'Empty or nearly empty source matte'
            bounds=(int(xs.min()),int(ys.min()),int(xs.max())+1,int(ys.max())+1)
            subject=rgba.crop(bounds)
            span=round(max(subject.size)/.89)
            canvas=Image.new('RGBA',(span,span),(255,255,255,0))
            canvas.paste(subject,((span-subject.width)//2,(span-subject.height)//2))
            canvas=canvas.resize((1024,1024),Image.Resampling.LANCZOS)
            canvas.save(conditioning)
            canvas.getchannel('A').save(prepared/'matte.png')
            write(prepared/'preparation.json',{'source_sha256':sha(source),'conditioning_sha256':sha(conditioning),
                  'cutout_sha256':sha(cutout),'bbox':bounds,'margin_fraction':.055,'size':[1024,1024],
                  'method':'Local BiRefNet alpha matte, crop, uniform fit and transparent square padding.'})
        if (root/'source'/f'reject-reference-v{version}.txt').exists():
            raise RuntimeError(f'Reference v{version} withdrawn before reconstruction; preserve preparation and use corrected reference.')
        command=[CLI,'--image',conditioning,'--output',dense,'--models',STUDIO/'models',
                 '--seed',args.seed,'--res',resolution,'--gpu',0,'--require-gpu','--xatlas','--webp','off']
        # Small environment surfaces use the toolchain's clean 512 PBR volume.
        # Geometry resolution is recorded per model. The pine's 1024 PBR pass
        # saturated the 6 GB GPU and took 24.5 minutes; preserve that result.
        texture_resolution=512 if spec['kind'] in ('foliage','equipment','terrain','water','static','bridge') else 1024
        command += ['--tex-res',texture_resolution]
        seconds=run(command,dense.with_suffix('.log'))
        assert dense.read_bytes()[:4]==b'glTF'
        write(dense.with_suffix('.json'),{'author':'Claude Code (local TRELLIS-2)','claude_used':True,'seed':args.seed,'resolution':resolution,'texture_resolution':texture_resolution,
              'conditioning':{'path':conditioning.relative_to(root).as_posix(),'sha256':sha(conditioning)},
              'output':{'path':dense.relative_to(root).as_posix(),'sha256':sha(dense),'bytes':dense.stat().st_size},
              'seconds':seconds,'command':[str(x).replace(str(root),'<model>').replace(str(STUDIO),'<trellis-studio>') for x in command]})
        write(root/'work/trellis/selected-dense.json',{'path':dense.relative_to(root).as_posix(),'sha256':sha(dense),'resolution':resolution,'seed':args.seed,'status':'reconstruction-only; visual review required'})
        print(json.dumps({'model':args.key,'status':'dense-ready','seconds':seconds,'sha256':sha(dense)},ensure_ascii=False),flush=True)
    finally:
        lock.unlink(missing_ok=True)

if __name__=='__main__':
    main()
