"""Reproducible CC0 audio mastering and original sampled score. No network/game/save access.
Requires numpy and FFmpeg (FFMPEG env or the task-local imageio-ffmpeg binary).
"""
import json, pathlib, subprocess, hashlib, runpy, wave, math
import numpy as np
utils = runpy.run_path(str(pathlib.Path(__file__).with_name('inspect-nature-quality.py')))
ROOT, FF, RATE, decode, metrics = [utils[k] for k in ['ROOT','FF','RATE','decode','metrics']]
SOURCES = ROOT/'assets/nature-audio/quality-source'
ORIGINAL = ROOT/'assets/nature-audio/source'
OUT = ROOT/'public/audio/nature'
MASTER = ROOT/'assets/nature-audio/quality-masters'
MASTER.mkdir(exist_ok=True)
files=[]
def wav(file, x):
    with wave.open(str(file),'wb') as w:
        w.setnchannels(x.shape[1]); w.setsampwidth(2); w.setframerate(RATE)
        w.writeframes(np.round(np.clip(x,-1,1)*32767).astype('<i2').tobytes())
def loudness(file):
    p=subprocess.run([FF,'-hide_banner','-i',str(file),'-af','loudnorm=print_format=json','-f','null','-'],capture_output=True,check=True)
    text=p.stderr.decode(errors='replace')
    return json.loads(text[text.rfind('{'):text.rfind('}')+1])
def master(name, x, source, target, processing, loop=False):
    x=x-x.mean(axis=0,keepdims=True)
    temp=MASTER/(name+'-unmastered.wav'); wav(temp,x)
    measured=loudness(temp)
    # One constant gain per asset preserves the recording's dynamics. No loudness pumping.
    gain=min(10**((target-float(measured['input_i']))/20), .56/max(.00001,float(np.abs(x).max())))
    x=x*gain
    file=MASTER/(name+'.wav'); wav(file,x)
    compressed=OUT/(name+'.mp3')
    subprocess.run([FF,'-v','error','-y','-i',str(file),'-map_metadata','-1','-c:a','libmp3lame','-q:a','2','-id3v2_version','3',str(compressed)],check=True)
    final=decode(compressed,channels=x.shape[1]); stat=metrics(final)
    level=loudness(compressed)
    payload=compressed.read_bytes()
    info={'name':name,'url':f'/audio/nature/{name}.mp3','source':source,'processing':processing,
          'loop':loop,'rate':RATE,'channels':x.shape[1],**stat,'rms':float(np.sqrt(np.mean(final**2))),
          'lufs':float(level['input_i']),'truePeakDB':float(level['input_tp']),
          'masterGainDB':round(20*math.log10(gain),3),'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
    files.append(info)
    print(name, f"{stat['seconds']}s {info['lufs']} LUFS {stat['peak']:.3f} peak {len(payload)} bytes",flush=True)
    return x
def join(x, seconds):
    n=round(seconds*RATE)
    out=x[n:].copy()
    t=np.linspace(0,1,n)[:,None]
    # Equal-power blend for decorrelated field-recording tails, without a level dip.
    out[-n:]=x[-n:]*np.cos(t*np.pi/2)+x[:n]*np.sin(t*np.pi/2)
    return out
def fade(x, incoming, outgoing):
    a,b=round(incoming*RATE),round(outgoing*RATE)
    x[:a]*=np.sin(np.linspace(0,np.pi/2,a))[:,None]**2
    x[-b:]*=np.cos(np.linspace(0,np.pi/2,b))[:,None]**2
    return x
jobs=[
    # Calm portion of the field recording; reject the heavy low-frequency gusts at its start.
    ('wind',SOURCES/'wind-field.wav',70,43,3,2,-32,'highpass=f=170,highpass=f=170,highshelf=f=1800:g=-5,lowpass=f=3400'),
    ('river',SOURCES/'river-field.wav',16,37,3,2,-25,'highpass=f=85,highshelf=f=4000:g=-3,lowpass=f=10000'),
    ('shore',ORIGINAL/'river.mp3',74,41,4,2,-26,'highpass=f=75,highshelf=f=4500:g=-3,lowpass=f=11000'),
    ('fire',ORIGINAL/'fire.wav',1,27,2,1,-27,'highpass=f=65,lowpass=f=7500'),
    ('torch',ORIGINAL/'fire.wav',7,16,2,1,-33,'highpass=f=240,highshelf=f=2000:g=-4,lowpass=f=4800'),
    ('rain',SOURCES/'rain-field.ogg',5,39,3,2,-28,'highpass=f=110,equalizer=f=1400:t=o:w=1.4:g=-3,lowpass=f=8500'),
]
for name,file,start,seconds,overlap,channels,target,filters in jobs:
    x=decode(file,start,seconds,filters,channels)
    assert len(x)>=round(seconds*RATE)-2
    master(name,join(x,overlap),file.name,target,{'start':start,'seconds':seconds,'crossfade':overlap,'filters':filters},True)
for i,(start,seconds) in enumerate([(1,6.5),(10,7),(20,7.5)]):
    x=decode(ORIGINAL/'birds.ogg',start,seconds,'highpass=f=1100,highshelf=f=5200:g=-4,lowpass=f=10500',1)
    master(f'birds-{i}',fade(x,.65,.9),'birds.ogg',-26,{'start':start,'seconds':seconds,'fadeIn':.65,'fadeOut':.9,'filters':'highpass 1100; high shelf 5200 -4 dB; lowpass 10500'})
for i,start in enumerate([4.35,12.45]):
    x=decode(SOURCES/'drips.flac',start,1.2,'highpass=f=250,lowpass=f=7200',1)
    master(f'drop-{i}',fade(x,.08,.35),'drips.flac',-30,{'start':start,'seconds':1.2,'fadeIn':.08,'fadeOut':.35,'filters':'highpass 250; lowpass 7200'})

# Each actual instrument recording is near its target pitch; keep attacks and room detail.
def midi(note, octave): return (octave+1)*12+{'C':0,'D':2,'E':4,'F':5,'G':7,'A':9,'B':11}[note]
bank={'flute':[], 'harp':[]}
for kind,pattern in [('flute','LDFlute_susNV_*_v1_1.wav'),('harp','KSHarp_*_mf.wav')]:
    for file in sorted(SOURCES.glob(pattern)):
        n=file.name.split('_')[2 if kind=='flute' else 1]
        root=midi(n[0],int(n[1])+(1 if kind=='flute' else 0))
        x=decode(file,filters='highpass=f=55,lowpass=f=8500')
        # Trim only leading recording silence; do not chop the instrument's attack.
        threshold=max(.00003,float(np.abs(x).max())*.012)
        nonzero=np.where(np.max(np.abs(x),axis=1)>threshold)[0]
        x=x[max(0,int(nonzero[0])-.015*RATE).__int__():]
        # Correct the small tuning offset of this recording, not its vibrato.
        body=x[round(.4*RATE):round(2.4*RATE)].mean(axis=1)
        spectrum=np.abs(np.fft.rfft(body*np.hanning(len(body))))
        f=np.fft.rfftfreq(len(body),1/RATE); expected=440*2**((root-69)/12)
        candidates=np.where((f>expected*.975)&(f<expected*1.025))[0]
        actual=float(f[candidates[np.argmax(spectrum[candidates])]])
        # Stable per-instrument RMS calibration before musical dynamics.
        rms=np.sqrt(np.mean(x[:min(len(x),RATE*3)]**2))
        x*=min(.065/max(rms,1e-5),.5/max(float(np.abs(x).max()),1e-5))
        bank[kind].append((root,actual,x,file.name))

# [time, pitch, sustain, intensity]. Phrases breathe; accompaniment is deliberately sparse.
scores={
 'explore':{'seconds':48,'flute':[(2,62,2.5,.62),(6,69,2,.49),(9.2,67,2.6,.52),(14,64,3,.56),(21,62,2.6,.49),(26,64,2,.47),(29,67,2.7,.53),(34,69,3,.47),(39,62,3.5,.43)],'harp':[(0,50,7,.43),(.25,57,6,.28),(8,62,6,.24),(13,55,8,.34),(20,50,7,.35),(25,57,6,.27),(33,55,7,.31),(39,50,7,.32),(40.2,62,6,.2)]},
 'camp':{'seconds':48,'flute':[(4,66,2.8,.47),(8,64,2.1,.4),(11,62,3,.5),(20,69,2.8,.42),(24,66,2.2,.43),(28,64,2.7,.42),(35,62,4,.44)],'harp':[(0,50,7,.44),(.32,57,7,.35),(1.3,62,7,.26),(6,59,6,.32),(10,54,7,.38),(10.4,62,7,.22),(17,55,7,.39),(18.2,62,6,.3),(22,59,7,.29),(28,57,7,.33),(34,50,9,.43),(35.2,57,8,.29),(38,62,7,.21)]},
 'cave':{'seconds':48,'flute':[(5,62,3.3,.42),(15,57,3,.35),(24,64,2.8,.31),(33,62,4,.35)],'harp':[(0,38,10,.44),(1.8,57,8,.21),(12,50,9,.33),(21,45,10,.34),(23,62,8,.18),(33,50,10,.31)]},
}
def reverb(x, decay, wet):
    rng=np.random.default_rng(20261006)
    n=round(decay*RATE); t=np.arange(n)/RATE
    out=x.copy()
    fftlen=1 << (len(x)+n-2).bit_length()
    for c in range(2):
        impulse=rng.uniform(-1,1,n)*np.exp(-6.9*t/decay)
        impulse[:round(.035*RATE)]=0
        # Dark diffuse tail, not bright full-band hiss; FFT lowpass with gradual roll-off.
        f=np.fft.rfftfreq(n,1/RATE)
        impulse=np.fft.irfft(np.fft.rfft(impulse)/(1+(f/2300)**4),n)
        impulse/=np.sqrt(np.sum(impulse**2))*2.5
        for delay,gain in [(.041,.35),(.073,.23),(.119,.15)]: impulse[round((delay+c*.009)*RATE)]+=gain
        convolved=np.fft.irfft(np.fft.rfft(x[:,c],fftlen)*np.fft.rfft(impulse,fftlen),fftlen)[:len(x)]
        out[:,c]+=convolved*wet
    return out
for place,score in scores.items():
    x=np.zeros((RATE*score['seconds'],2),dtype=np.float32); used=set()
    notes=[]
    for kind in ['harp','flute']:
        for at,pitch,sustain,volume in score[kind]:
            root,actual,sample,file=min(bank[kind],key=lambda a:abs(pitch-a[0]))
            rate=(440*2**((pitch-69)/12))/actual
            length=min(round((sustain+1.0)*RATE),int(len(sample)/rate)-1)
            index=np.arange(length)*rate
            y=np.stack([np.interp(index,np.arange(len(sample)),sample[:,c]) for c in range(2)],axis=1)
            fade(y,.08 if kind=='flute' else .012,.85 if kind=='flute' else 1.0)
            # Subtle fixed seating, no artificial stereo motion across individual notes.
            y[:,0]*=1 if kind=='flute' else .84
            y[:,1]*=.84 if kind=='flute' else 1
            offset=round(at*RATE); size=min(len(y),len(x)-offset)
            x[offset:offset+size]+=y[:size]*volume
            used.add(file);notes.append({'instrument':kind,'at':at,'midi':pitch,'duration':sustain,'velocity':volume,'sample':file,'rate':rate})
    x=reverb(x,3.1 if place=='cave' else 1.9,.38 if place=='cave' else .2)
    fade(x,.8,4)
    master('bgm-'+place,x,sorted(used),-26,{'score':notes,'reverbSeconds':3.1 if place=='cave' else 1.9,'tailFade':4})

old=json.loads((ROOT/'assets/nature-audio/before-quality-20261006/audio/manifest.json').read_text())
download=json.loads((SOURCES/'sources.json').read_text())
sources=download['sources']+[s for s in old['sources'] if s['file'] in ['birds.ogg','fire.wav','river.mp3']]
manifest={'version':2,'prepared':'2026-10-06','format':'44.1 kHz MP3 VBR q2; stereo beds/music, mono positioned fire/birds/drops; lossless masters archived',
 'sources':sources,'files':files,'totalBytes':sum(f['bytes'] for f in files),
 'decodedBytesAt48000Hz':sum(round(f['seconds']*48000)*f['channels']*4 for f in files)}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
(OUT/'CREDITS.txt').write_text('CRO-MAGNON nature audio revision 2\n\n'+ '\n\n'.join(f"{s['file']}\n{s['author']}\n{s['page']}\nCC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/" for s in sources)+
 '\n\nOriginal three compositions arranged from VSCO 2 CE flute and harp recordings. See manifest.json for every note, sample, processing interval, level and SHA-256.\n',encoding='utf-8')
print('Total bytes',manifest['totalBytes'],'decoded 48k',manifest['decodedBytesAt48000Hz'])
