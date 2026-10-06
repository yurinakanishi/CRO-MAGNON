"""Rebuild recorded ambience and sampled music. Run prepare-nature-foley.py afterward."""
from nature_audio_mastering import *
jobs=[
    # Calm portion of the field recording; reject the heavy low-frequency gusts at its start.
    ('wind',SOURCES/'wind-field.wav',70,43,3,2,-38,'highpass=f=170,highpass=f=170,highshelf=f=900:g=-6,equalizer=f=1600:t=o:w=1.5:g=-3,lowpass=f=1800'),
    ('river',SOURCES/'river-field.wav',16,37,3,2,-29,'highpass=f=85,highshelf=f=3200:g=-4,lowpass=f=8000'),
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

old=json.loads((ROOT/'assets/nature-audio/before-quality-20261006/audio/manifest.json').read_text(encoding='utf-8'))
download=json.loads((SOURCES/'sources.json').read_text(encoding='utf-8'))
sources=download['sources']+[s for s in old['sources'] if s['file'] in ['birds.ogg','fire.wav','river.mp3']]
manifest={'version':2,'prepared':'2026-10-06','format':'44.1 kHz MP3 VBR q2; stereo beds/music, mono positioned fire/birds/drops; lossless masters archived',
 'sources':sources,'files':files,'totalBytes':sum(f['bytes'] for f in files),
 'decodedBytesAt48000Hz':sum(round(f['seconds']*48000)*f['channels']*4 for f in files)}
(OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8',newline='\n')
(OUT/'CREDITS.txt').write_text('CRO-MAGNON nature audio revision 2\n\n'+ '\n\n'.join(f"{s['file']}\n{s['author']}\n{s['page']}\nCC0-1.0 https://creativecommons.org/publicdomain/zero/1.0/" for s in sources)+
 '\n\nOriginal three compositions arranged from VSCO 2 CE flute and harp recordings. See manifest.json for every note, sample, processing interval, level and SHA-256.\n',encoding='utf-8',newline='\n')
print('Total bytes',manifest['totalBytes'],'decoded 48k',manifest['decodedBytesAt48000Hz'])
