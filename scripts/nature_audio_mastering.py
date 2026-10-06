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
