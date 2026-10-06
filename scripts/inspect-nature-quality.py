"""Read-only analysis of candidates; FFmpeg and numpy, no game state."""
import json, subprocess, pathlib, os
import numpy as np
ROOT = pathlib.Path(__file__).resolve().parents[1]
FF = os.environ.get('FFMPEG', str(ROOT / 'output/nature-audio-tools/imageio_ffmpeg/binaries/ffmpeg-win-x86_64-v7.1.exe'))
RATE = 44100
def decode(file, start=0, seconds=None, filters=None, channels=2):
    cmd = [FF, '-v', 'error', '-ss', str(start), '-i', str(file)]
    if seconds: cmd += ['-t', str(seconds)]
    if filters: cmd += ['-af', filters]
    cmd += ['-ar', str(RATE), '-ac', str(channels), '-f', 'f32le', '-']
    result = subprocess.run(cmd, check=True, capture_output=True)
    return np.frombuffer(result.stdout, '<f4').reshape(-1, channels).copy()
def metrics(data):
    rms=float(np.sqrt(np.mean(data.astype('float64')**2)))
    mono=data.mean(axis=1)
    frames=mono[:len(mono)//8192*8192].reshape(-1,8192)
    power=(np.abs(np.fft.rfft(frames*np.hanning(8192)))**2).mean(axis=0)
    freq=np.fft.rfftfreq(8192,1/RATE)
    bands={str(a)+'-'+str(b):round(float(power[(freq>=a)&(freq<b)].sum()/power.sum()),5) for a,b in [(0,80),(80,500),(500,2500),(2500,7000),(7000,22050)]}
    return {'seconds':round(len(data)/RATE,3),'rmsDB':round(20*np.log10(max(1e-10,rms)),2),'peak':round(float(np.max(np.abs(data))),5),'bands':bands,'correlation':round(float(np.corrcoef(data.T)[0,1]),3) if data.shape[1]>1 else 1}
if __name__=='__main__':
    result={}
    for name in ['wind-field.wav','river-field.wav','rain-field.ogg','drips.flac']:
        x=decode(ROOT/'assets/nature-audio/quality-source'/name)
        rows=[]
        for start in range(0,int(len(x)/RATE)-10,20):
            rows.append({'start':start,**metrics(x[start*RATE:(start+10)*RATE])})
        result[name]=rows
    for name in ['LDFlute_susNV_C3_v1_1.wav','KSHarp_D2_mf.wav']:
        x=decode(ROOT/'assets/nature-audio/quality-source'/name,0,3).mean(axis=1)
        spectrum=np.abs(np.fft.rfft(x*np.hanning(len(x))))
        peaks=np.argsort(spectrum)[-6:]
        result[name]={'peaksHz':[round(float(i*RATE/len(x)),2) for i in reversed(peaks)]}
    (ROOT/'output/nature-quality-candidates.json').write_text(json.dumps(result,indent=2))
    print(json.dumps(result,indent=2))
