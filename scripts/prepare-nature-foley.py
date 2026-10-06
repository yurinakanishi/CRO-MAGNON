"""Master recorded foley. Run after prepare-nature-quality.py; no network access."""
from nature_audio_mastering import *
FOLEY=ROOT/'assets/nature-audio/foley-source'
base=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
base['files']=[f for f in base['files'] if not f['name'].startswith('fx-')]
sources=json.loads((FOLEY/'sources.json').read_text(encoding='utf-8'))['sources']
old=json.loads((ROOT/'assets/nature-audio/removed-20261006/manifest.json').read_text(encoding='utf-8'))
sources += [s for s in old['sources'] if s['file']=='fantozzi.7z']

def clip(file, filters='highpass=f=90,lowpass=f=6500', seconds=None, start=0):
    x=decode(file,start,seconds,filters,1)
    # Keep each contact's transient, remove empty leading/tail time only.
    threshold=max(.00002,float(np.abs(x).max())*.003)
    nz=np.where(np.abs(x[:,0])>threshold)[0]
    if len(nz): x=x[max(0,nz[0]-round(.008*RATE)):min(len(x),nz[-1]+round(.06*RATE))]
    return fade(x,min(.008,len(x)/RATE/8),min(.06,len(x)/RATE/5))

def emit(name,x,archive,paths,target=-28):
    # Loudness measurement needs at least one 400ms block; padding stays silent.
    if len(x)<RATE*.5: x=np.pad(x,((0,round(RATE*.5)-len(x)),(0,0)))
    return master('fx-'+name,x,archive,target,{'recordings':paths,'treatment':'DC removal; high/low-pass EQ; 8ms onset/60ms release maximum; fixed gain; silent padding to 500ms for loudness measurement'})

def simple(name,path,archive,target=-28,filters='highpass=f=90,lowpass=f=6500'):
    return emit(name,clip(path,filters),archive,[path.relative_to(ROOT).as_posix(),filters],target)

for i in range(3):
    simple(f'step-grass-{i}',FOLEY/f'impact/Audio/footstep_grass_00{i}.ogg','impact.zip',-30,'highpass=f=95,highshelf=f=2200:g=-4,lowpass=f=5500')
    for surface,label in [('sand','Sand'),('stone','Stone')]:
        path=ORIGINAL/f'footsteps/Fantozzi-footsteps/flac/Fantozzi-{label}{["L1","R2","L3"][i]}.flac'
        simple(f'step-{surface}-{i}',path,'fantozzi.7z',-29,'highpass=f=95,highshelf=f=3000:g=-3,lowpass=f=7000')
    path=FOLEY/f'snow/Corsica_S-Walking_in_Snow/Corsica_S-Walking_on_snow_covered_gravel_{i+1:02}.flac'
    simple(f'step-snow-{i}',path,'snow.7z',-30,'highpass=f=100,highshelf=f=2200:g=-4,lowpass=f=5000')
    simple(f'step-water-{i}',FOLEY/f'water/splash_{[2,6,9][i]:02}.ogg','water.zip',-29,'highpass=f=130,highshelf=f=4000:g=-3,lowpass=f=7000')
    simple(f'attack-{i}',FOLEY/f'swish/swosh-{[2,4,7][i]:02}.flac','swish.7z',-27,'highpass=f=130,lowpass=f=6500')
    simple(f'throw-{i}',FOLEY/f'swish/swosh-{[11,14,17][i]:02}.flac','swish.7z',-30,'highpass=f=200,lowpass=f=5000')

for i in range(2):
    simple(f'jump-{i}',FOLEY/f'cloth/footsteps/step_cloth{i+1}.ogg','cloth.zip',-31)
    simple(f'pet-{i}',FOLEY/f'cloth/footsteps/step_cloth{i+3}.ogg','cloth.zip',-33,'highpass=f=150,lowpass=f=3500')
    simple(f'mount-{i}',FOLEY/f'cloth/footsteps/step_lth{i+1}.ogg','cloth.zip',-30,'highpass=f=90,lowpass=f=4500')
    simple(f'hurt-{i}',FOLEY/f'impact/Audio/impactSoft_medium_00{i}.ogg','impact.zip',-27,'highpass=f=60,lowpass=f=3800')
for material,file in [('stone','impactMining_000'),('wood','impactWood_light_001'),('plant','footstep_grass_004')]:
    simple('gather-'+material,FOLEY/f'impact/Audio/{file}.ogg','impact.zip',-29,'highpass=f=100,highshelf=f=3000:g=-3,lowpass=f=6500')
fire=clip(ORIGINAL/'fire.wav','highpass=f=280,lowpass=f=4200',.55,8.3)
emit('torch-switch',fade(fire,.06,.16),'fire.wav',['fire.wav: 8.3–8.85 seconds'], -32)
simple('hiss',FOLEY/'cat-hiss.mp3','cat-hiss.mp3',-28,'highpass=f=280,highshelf=f=3000:g=-3,lowpass=f=7200')

def instrument(filename,seconds,attack,release):
    x=clip(SOURCES/filename,'highpass=f=120,lowpass=f=6500',seconds)
    x=x/max(.00001,float(np.abs(x).max()))*.15
    return fade(x,attack,release)
flute='LDFlute_susNV_C3_v1_1.wav'
emit('recall',instrument(flute,1.1,.07,.3),flute,[flute,'unshifted recorded C4; short breath'], -29)
harp='KSHarp_D4_mf.wav'
emit('confirm',instrument(harp,1.15,.012,.45),harp,[harp,'unshifted D4; short release'], -32)
# A restrained ascending fifth, with the original resonance, not an electronic ME.
x=np.zeros((round(RATE*2.7),1),dtype=np.float32)
used=['KSHarp_D4_mf.wav','KSHarp_A4_mf.wav']
for at,file,volume in [(0,used[0],1),(.23,used[1],.6)]:
    y=instrument(file,2.2,.012,.7);o=round(at*RATE);x[o:o+len(y)]+=y*volume
emit('discovery',x,used,used,-31)

base['version']=3
base['files']+=files
known={s['file'] for s in base['sources']}
base['sources'] += [s for s in sources if s['file'] not in known]
base['totalBytes']=sum(f['bytes'] for f in base['files'])
base['decodedBytesAt48000Hz']=sum(round(f['seconds']*48000)*f['channels']*4 for f in base['files'])
(OUT/'manifest.json').write_text(json.dumps(base,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
(OUT/'CREDITS.txt').write_text('CRO-MAGNON audio revision 3 — recorded ambience, sampled original music, recorded foley\n\n'+ '\n\n'.join(f"{s['file']}\n{s['author']}\n{s['page']}\n{s['license']} https://creativecommons.org/publicdomain/zero/1.0/" for s in base['sources'])+'\n\nRecordings edited/EQ/level adjusted. Original compositions and every sample/processing interval/SHA are in manifest.json. Cat uses the public HQ MP3 of the CC0 recording.\n',encoding='utf-8',newline='\n')
print('Total',len(base['files']),'files',base['totalBytes'],'bytes;',base['decodedBytesAt48000Hz'],'decoded at 48k')
