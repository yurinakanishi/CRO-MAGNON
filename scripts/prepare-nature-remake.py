"""Rebuild every game sound and the place themes from the 2026-10-11 CC0 sources.

Offline and deterministic: reads assets/nature-audio/remake-20261011/source (see
fetch-nature-remake.py / fetch-nature-remake-vsco.py) and the earlier CC0 cat recording,
writes lossless masters to remake-20261011/masters and the shipped MP3s + manifest to
public/audio/nature. Requires numpy and FFmpeg (with libmp3lame and soxr).

Loudness is NOT decided here. Every file is mastered to the same reference
(ASSET_LUFS: integrated loudness for beds and music, maximum momentary loudness for
one-shots) and the measured value is stored in the manifest; the game turns real-world
sound levels into playback gain in src/nature-audio-levels.ts.
"""
from __future__ import annotations

import hashlib, importlib.util, json, math, pathlib, re, subprocess, sys
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
REMAKE = ROOT / 'assets/nature-audio/remake-20261011'
SRC = REMAKE / 'source/freesound'
MASTERS = REMAKE / 'masters'
OUT = ROOT / 'public/audio/nature'
CAT = ROOT / 'assets/nature-audio/foley-source/cat-hiss.mp3'
RATE = 44100
ASSET_LUFS = -23.0
FILES: list[dict] = []


def decode(path, start=0.0, seconds=None, filters=None, channels=2):
    cmd = ['ffmpeg', '-v', 'error', '-ss', f'{start:.4f}', '-i', str(path)]
    if seconds:
        cmd += ['-t', f'{seconds:.4f}']
    if filters:
        cmd += ['-af', filters]
    cmd += ['-ar', str(RATE), '-ac', str(channels), '-f', 'f32le', '-']
    data = subprocess.run(cmd, capture_output=True, check=True).stdout
    return np.frombuffer(data, '<f4').reshape(-1, channels).astype(np.float64)


def measure(x):
    """EBU R128 integrated, max momentary, true peak (FFmpeg ebur128) of a float buffer."""
    if len(x) < RATE // 2:
        x = np.concatenate([x, np.zeros((RATE // 2 - len(x), x.shape[1]))])
    p = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-f', 'f32le', '-ar', str(RATE), '-ac', str(x.shape[1]),
                        '-i', '-', '-af', 'ebur128=peak=true', '-f', 'null', '-'],
                       input=x.astype('<f4').tobytes(), capture_output=True)
    text = p.stderr.decode(errors='replace')
    momentary = [float(v) for v in re.findall(r'M:\s*(-?[\d.]+)', text)]
    summary = text[text.rfind('Summary:'):]
    integrated = float(re.search(r'I:\s+(-?[\d.]+) LUFS', summary).group(1))
    peak = float(re.search(r'Peak:\s+(-?[\d.]+) dBFS', summary).group(1))
    return {'integrated': integrated, 'momentary': max(momentary), 'truePeak': peak}


def fade(x, incoming, outgoing):
    a, b = round(incoming * RATE), round(outgoing * RATE)
    if a:
        x[:a] *= np.sin(np.linspace(0, np.pi / 2, a))[:, None] ** 2
    if b:
        x[-b:] *= np.cos(np.linspace(0, np.pi / 2, b))[:, None] ** 2
    return x


def join(x, seconds):
    """Seamless loop: the tail is equal-power blended into the head (decorrelated recordings)."""
    n = round(seconds * RATE)
    out = x[n:].copy()
    t = np.linspace(0, 1, n)[:, None]
    out[-n:] = x[-n:] * np.cos(t * np.pi / 2) + x[:n] * np.sin(t * np.pi / 2)
    return out


def events(path, filters='highpass=f=80', gap=0.15, rise=14):
    """Onset times of separate sounds (steps, hits, drips) in a recording."""
    x = decode(path, filters=filters, channels=1)[:, 0]
    blk = round(0.005 * RATE)
    env = 20 * np.log10(np.sqrt(np.convolve(x ** 2, np.ones(blk) / blk, 'same')) + 1e-9)
    floor = np.percentile(env, 20)
    found, i = [], 0
    while i < len(env):
        if env[i] > floor + rise:
            start, peak = i, i
            while i < len(env) and (env[i] > floor + 6 or i - peak < gap * RATE):
                peak = i if env[i] > env[peak] else peak
                i += 1
            if i - start > 0.03 * RATE:
                found.append(start / RATE)
        i += 1
    return found


def cut(path, at, seconds, filters, channels=1, pre=0.006, release=0.12):
    x = decode(path, max(0.0, at - pre), seconds + pre, filters, channels)
    return fade(x, min(0.004, pre), min(release, seconds / 3))


def write(name, x, *, kind, sources, processing, quality=2):
    """Master to the common reference, archive 24-bit PCM, ship VBR MP3, record the facts."""
    x = x - x.mean(axis=0, keepdims=True)
    m = measure(x)
    measured = m['integrated'] if kind != 'oneshot' else m['momentary']
    ceiling = -1.0 if kind == 'oneshot' else -2.0
    gain_db = min(ASSET_LUFS - measured, ceiling - m['truePeak'])
    x = x * 10 ** (gain_db / 20)
    MASTERS.mkdir(parents=True, exist_ok=True)
    pcm = x.astype('<f4').tobytes()
    base = ['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(RATE), '-ac', str(x.shape[1]), '-i', '-']
    subprocess.run(base + ['-c:a', 'pcm_s24le', str(MASTERS / f'{name}.wav')], input=pcm, check=True)
    mp3 = OUT / f'{name}.mp3'
    subprocess.run(base + ['-map_metadata', '-1', '-c:a', 'libmp3lame', '-q:a', str(quality), '-id3v2_version', '3',
                           str(mp3)], input=pcm, check=True)
    shipped = decode(mp3, channels=x.shape[1])
    s = measure(shipped)
    payload = mp3.read_bytes()
    mono = shipped.mean(axis=1)
    spec = np.abs(np.fft.rfft(mono[:min(len(mono), 30 * RATE)])) ** 2
    freq = np.fft.rfftfreq(min(len(mono), 30 * RATE), 1 / RATE)
    info = {
        'name': name, 'url': f'/audio/nature/{name}.mp3', 'kind': kind, 'channels': x.shape[1], 'rate': RATE,
        'seconds': round(len(shipped) / RATE, 3),
        # The game's level model reads this: integrated (beds/music) or max momentary (one-shots).
        'loudness': round(s['integrated'] if kind != 'oneshot' else s['momentary'], 2),
        'integrated': round(s['integrated'], 2), 'momentaryMax': round(s['momentary'], 2), 'truePeak': round(s['truePeak'], 2),
        'above8kHz': round(float(spec[freq >= 8000].sum() / spec.sum()), 4),
        'correlation': round(float(np.corrcoef(shipped.T)[0, 1]), 3) if x.shape[1] > 1 else 1.0,
        'masterGainDB': round(gain_db, 2), 'sources': sources, 'processing': processing,
        'bytes': len(payload), 'sha256': hashlib.sha256(payload).hexdigest(),
    }
    FILES.append(info)
    print(f"{name:18} {info['seconds']:7.2f}s {kind:7} {info['loudness']:7.2f} LU  tp {info['truePeak']:6.2f}  {len(payload):8d} B", flush=True)


def loops():
    beds = [
        # name, source id, start, seconds, crossfade, channels, filters, why
        ('wind', 176249, 36, 44, 3, 2, 'highpass=f=90,highshelf=f=7000:g=-2',
         'grass rustle with no microphone wind rumble; calm 44 s section'),
        ('river', 337614, 30, 38, 3, 2, 'highpass=f=60,lowpass=f=16000',
         'murmuring shallow stream for the slow valley river'),
        ('stream', 690215, 0, 29.9, 2.5, 2, 'highpass=f=50', 'turbulent mountain stream'),
        ('waterfall', 698306, 0, 44.9, 3, 1, 'highpass=f=40', 'small close waterfall, positioned mono source'),
        ('shore', 829627, 0, 57.9, 4, 2, 'highpass=f=35', 'waves on a beach (natural swell and recede)'),
        ('rain', 512334, 37, 42, 3, 2, 'highpass=f=90', 'light rain on broad leaves, spaced omnis'),
        ('fire', 637523, 1, 33, 3, 1, 'highpass=f=80', 'small campfire crackle, positioned mono source'),
        ('torch', 40699, 66, 21, 3, 1, 'highpass=f=170,lowpass=f=9000', 'calm flame section of a different fire'),
    ]
    for name, sid, start, seconds, overlap, channels, filters, why in beds:
        x = decode(SRC / f'{sid}.ogg', start, seconds, filters, channels)
        assert len(x) >= round(seconds * RATE) - 4, (name, len(x) / RATE)
        write(name, join(x, overlap), kind='loop', sources=[f'{sid}.ogg'],
              processing={'start': start, 'seconds': seconds, 'crossfade': overlap, 'filters': filters, 'note': why})


def oneshots():
    # Birds: the clearest songs of a prairie dawn chorus + two blackbird phrases.
    chorus = SRC / '202900.ogg'
    x = decode(chorus, filters='highpass=f=1500', channels=1)[:, 0]
    per = np.array([np.mean(x[i * RATE:(i + 1) * RATE] ** 2) for i in range(len(x) // RATE)])
    picks = []
    for i in np.argsort(per)[::-1]:
        if all(abs(i - p) > 25 for p in picks) and 3 <= i <= len(per) - 5:
            picks.append(int(i))
        if len(picks) == 4:
            break
    birds = [(chorus, p - 2.0, 5.5) for p in sorted(picks)] + [(SRC / '116791.ogg', 5.35, 2.9), (SRC / '116791.ogg', 13.05, 3.6)]
    for i, (path, start, seconds) in enumerate(birds):
        filters = 'highpass=f=1100,lowpass=f=14000' if path == chorus else 'highpass=f=900,lowpass=f=14000'
        y = fade(decode(path, start, seconds, filters, 1), 0.5, 0.8)
        write(f'birds-{i}', y, kind='oneshot', sources=[path.name],
              processing={'start': round(start, 3), 'seconds': seconds, 'filters': filters, 'fade': [0.5, 0.8]})

    drips = SRC / '234554.ogg'
    for i, at in enumerate([1.533, 4.797, 10.761, 14.255]):
        y = cut(drips, at, 1.15, 'highpass=f=180,lowpass=f=12000', release=0.4)
        write(f'drop-{i}', y, kind='oneshot', sources=[drips.name],
              processing={'onset': at, 'seconds': 1.15, 'filters': 'highpass 180 Hz, lowpass 12 kHz'})

    # Footsteps: one consistent CC0 set (Nox_Sound), walk takes only, six per surface.
    steps = {
        'grass': (556042, [0, 1, 2, 8, 12, 15], 0.42, 'highpass=f=70,highshelf=f=6000:g=-2'),
        'sand': (564893, [1, 2, 4, 8, 11, 15], 0.4, 'highpass=f=70'),
        'stone': (558472, [4, 5, 7, 9, 10, 13], 0.34, 'highpass=f=60'),
        'snow': (613849, [1, 2, 3, 7, 8, 9], 0.4, 'highpass=f=70'),
        'water': (861369, [2, 3, 5, 6, 7, 9], 0.42, 'highpass=f=90,lowpass=f=15000'),
    }
    for surface, (sid, picks, seconds, filters) in steps.items():
        path = SRC / f'{sid}.ogg'
        onsets = events(path)
        for i, k in enumerate(picks):
            y = cut(path, onsets[k], seconds, filters)
            write(f'fx-step-{surface}-{i}', y, kind='oneshot', sources=[path.name],
                  processing={'event': k, 'onset': round(onsets[k], 3), 'seconds': seconds, 'filters': filters})

    def take(prefix, sid, picks, seconds, filters, release=0.1):
        path = SRC / f'{sid}.ogg'
        onsets = events(path, gap=0.25, rise=12)
        for i, k in enumerate(picks):
            y = cut(path, onsets[k], seconds, filters, release=release)
            write(f'fx-{prefix}-{i}' if len(picks) > 1 else f'fx-{prefix}', y, kind='oneshot', sources=[path.name],
                  processing={'event': k, 'onset': round(onsets[k], 3), 'seconds': seconds, 'filters': filters})

    take('attack', 427979, [6, 7, 8], 0.5, 'highpass=f=70')            # heavier bamboo swings ~ club
    take('throw', 427979, [0, 1, 3], 0.42, 'highpass=f=150')            # lighter swings
    take('hurt', 586841, [1, 2, 6], 0.62, 'highpass=f=45', release=0.2)  # layered body impacts
    take('jump', 624478, [2, 3, 5], 0.4, 'highpass=f=90')               # heavy clothing push-off
    take('mount', 435291, [10, 12], 0.45, 'highpass=f=90')
    take('pet', 554561, [1, 23], 0.85, 'highpass=f=160,lowpass=f=9000', release=0.3)
    take('gather-wood', 846927, [1, 4], 0.55, 'highpass=f=70')
    take('gather-plant', 559082, [5, 6], 0.75, 'highpass=f=250,lowpass=f=12000', release=0.25)
    take('torch-switch', 846930, [1], 1.3, 'highpass=f=120', release=0.4)
    rock = SRC / '579409.ogg'
    onsets = events(rock, gap=0.2, rise=10)
    for i, (k, semitones) in enumerate([(0, 0), (0, -3)]):
        rate = 2 ** (semitones / 12)
        flt = 'highpass=f=80' + (f',asetrate={round(RATE * rate)},aresample={RATE}:resampler=soxr' if semitones else '')
        y = cut(rock, onsets[k], 0.5, flt)
        write(f'fx-gather-stone-{i}', y, kind='oneshot', sources=[rock.name],
              processing={'event': k, 'onset': round(onsets[k], 3), 'pitchSemitones': semitones, 'filters': flt})
    y = fade(decode(CAT, filters='highpass=f=250,lowpass=f=12000', channels=1), 0.005, 0.15)
    write('fx-hiss', y, kind='oneshot', sources=['cat-hiss.mp3'], processing={'filters': 'highpass 250 Hz, lowpass 12 kHz'})


def music():
    spec = importlib.util.spec_from_file_location('compose', ROOT / 'scripts/compose-nature-music.py')
    compose = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(compose)
    pieces, tuning = compose.render_all()
    for p in pieces:
        kind = 'music' if p['name'].startswith('bgm-') else 'oneshot'
        x = p['audio']
        if kind == 'oneshot':
            x = fade(x.copy(), 0.0, 0.05)
        write(p['name'], x, kind=kind, quality=3 if kind == 'music' else 2,
              sources=['VSCO 2 CE: ' + s for s in p['used']] + [p['impulse']],
              processing={k: p[k] for k in ['tempo', 'seconds', 'balanceDB'] if k in p} | {'score': p['score']})
    (REMAKE / 'music-tuning.json').write_text(json.dumps(tuning, indent=1) + '\n', encoding='utf-8', newline='\n')
    # The cave's convolution reverb at runtime uses the same measured cathedral response.
    ir = compose.impulse(648945, predelay=0.008)
    write('cave-ir', ir / np.abs(ir).max() * 0.5, kind='impulse', sources=['648945.ogg'],
          processing={'note': 'direct path removed, 8 ms predelay, 250 ms end fade; ConvolverNode normalises it'})


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob('*.mp3'):
        old.unlink()
    loops()
    oneshots()
    music()
    registry = json.loads((REMAKE / 'sources.json').read_text(encoding='utf-8'))
    vsco = json.loads((REMAKE / 'source/vsco/vsco-files.json').read_text(encoding='utf-8'))
    sources = registry['sources'] + [
        {'file': 'cat-hiss.mp3', 'title': 'catHisses1', 'author': 'Zabuhailo', 'license': 'CC0-1.0',
         'page': 'https://freesound.org/people/Zabuhailo/sounds/146963/', 'role': 'cat hiss',
         'sha256': hashlib.sha256(CAT.read_bytes()).hexdigest()},
        {'file': 'VSCO 2 CE', 'title': 'Versilian Studios Chamber Orchestra 2 Community Edition', 'author': vsco['author'],
         'license': 'CC0-1.0', 'page': 'https://versilian-studios.com/vsco-community/', 'role': 'music, musical cues',
         'repository': vsco['repository'], 'commit': vsco['commit'], 'files': len(vsco['files'])},
    ]
    manifest = {
        'version': 4, 'prepared': '2026-10-11', 'assetLufs': ASSET_LUFS,
        'format': '44.1 kHz MP3 VBR (V2 sounds, V3 music); stereo beds/music, mono positioned sources and foley',
        'loudness': 'integrated LUFS for loop/music/impulse, maximum momentary LUFS for oneshot; see src/nature-audio-levels.ts',
        'sources': sources, 'files': FILES,
        'totalBytes': sum(f['bytes'] for f in FILES),
        'decodedBytesAt48000Hz': sum(round(f['seconds'] * 48000) * f['channels'] * 4 for f in FILES if f['kind'] != 'music'),
    }
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
    credits = ['CRO-MAGNON audio revision 4 (2026-10-11): CC0 field recordings, CC0 foley, original music from CC0 VSCO 2 CE samples', '']
    for s in sources:
        credits += [f"{s['title']} — {s['author']}", s['page'], f"{s['license']} https://creativecommons.org/publicdomain/zero/1.0/", '']
    credits.append('Edited, filtered and loudness-mastered for the game. Every interval, filter, score note and SHA-256 is in manifest.json.')
    (OUT / 'CREDITS.txt').write_text('\n'.join(credits) + '\n', encoding='utf-8', newline='\n')
    print('files', len(FILES), 'bytes', manifest['totalBytes'], 'decoded (excluding streamed music) at 48 kHz',
          manifest['decodedBytesAt48000Hz'], file=sys.stderr)
