"""Original place themes and musical cues rendered from CC0 VSCO 2 CE recordings.

Offline and deterministic: reads only local sources (fetch-nature-remake-vsco.py and
fetch-nature-remake.py download them), writes lossless masters, never touches the game.
Usage as a module: render_all() -> list of {name, wav, score, ...}; or run directly.
"""
from __future__ import annotations

import json, math, pathlib, re, subprocess
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
REMAKE = ROOT / 'assets/nature-audio/remake-20261011'
VSCO = REMAKE / 'source/vsco'
FREESOUND = REMAKE / 'source/freesound'
MASTERS = REMAKE / 'masters'
RATE = 44100
NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}
CACHE: dict = {}


def midi(name: str) -> int:
    m = re.fullmatch(r'([A-G])([#b]?)(-?\d)', name)
    return (int(m.group(3)) + 1) * 12 + NOTE[m.group(1)] + {'#': 1, 'b': -1, '': 0}[m.group(2)]


def decode(path, ratio=1.0, channels=2):
    key = (str(path), round(ratio, 7), channels)
    if key not in CACHE:
        cmd = ['ffmpeg', '-v', 'error', '-i', str(path)]
        if abs(ratio - 1) > 1e-7:
            # Varispeed with the SoX resampler: correct pitch, no time-stretch artefacts.
            rate = int(subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries',
                                       'stream=sample_rate', '-of', 'csv=p=0', str(path)],
                                      capture_output=True, check=True).stdout.decode().strip())
            cmd += ['-af', f'asetrate={round(rate * ratio)},aresample={RATE}:resampler=soxr:precision=28']
        cmd += ['-ar', str(RATE), '-ac', str(channels), '-f', 'f32le', '-']
        data = subprocess.run(cmd, capture_output=True, check=True).stdout
        CACHE[key] = np.frombuffer(data, '<f4').reshape(-1, channels).astype(np.float64)
    return CACHE[key]


def onset(x, fraction=0.004):
    level = np.abs(x).max(axis=1)
    hit = np.where(level > level.max() * fraction)[0]
    return max(0, int(hit[0]) - round(0.004 * RATE)) if len(hit) else 0


def measure_pitch(x, nominal, partials=4):
    """Return the recording's actual fundamental near its nominal note (tuning, not vibrato).

    Corrections beyond 20 cents are treated as measurement errors (piano inharmonicity,
    extreme registers) and the nominal pitch is kept.
    """
    mono = x.mean(axis=1)
    start = onset(x) + round(0.25 * RATE)
    seg = mono[start:start + 2 * RATE]
    if len(seg) < RATE // 4:
        return 440 * 2 ** ((nominal - 69) / 12)
    n = 1 << 18
    spectrum = np.abs(np.fft.rfft(seg * np.hanning(len(seg)), n))
    freq = np.fft.rfftfreq(n, 1 / RATE)
    expected = 440 * 2 ** ((nominal - 69) / 12)
    estimates = []
    for k in range(1, partials + 1):
        band = (freq > expected * k * 0.975) & (freq < expected * k * 1.025)
        if band.any():
            i = np.where(band)[0][np.argmax(spectrum[band])]
            if spectrum[i] > spectrum[band].mean() * 4:
                estimates.append((spectrum[i], freq[i] / k))
    if not estimates:
        return expected
    # Strongest partials dominate; ignore weak/noisy ones.
    estimates.sort(reverse=True)
    hz = float(np.median([e[1] for e in estimates[:3]]))
    return hz if abs(1200 * math.log2(hz / expected)) <= 20 else expected


class Instrument:
    """Multisampled instrument: nearest recorded zone, small varispeed, natural envelope."""

    def __init__(self, name, files, *, octave=12, attack=0.004, release=0.6, pan=0.0, gain=1.0,
                 send=0.3, loop=False, tuned=True, struck=False):
        self.name, self.attack, self.release, self.pan, self.gain = name, attack, release, pan, gain
        self.send, self.loop, self.tuned, self.struck = send, loop, tuned, struck
        self.zones = []
        self.turn: dict = {}
        for path in files:
            m = re.search(r'_([A-G]#?)(\d)_', path.name)
            nominal = midi(m.group(1) + m.group(2)) + octave if tuned else 60
            x = decode(path)
            # Struck strings have inharmonic partials: tune from the fundamental only.
            hz = measure_pitch(x, nominal, 1 if struck else 4) if tuned else 440 * 2 ** ((nominal - 69) / 12)
            start = onset(x)
            # Struck strings are levelled on their attack, bowed/blown notes on their sustain.
            body = x[start:start + round(0.25 * RATE)] if struck else x[start + round(0.3 * RATE):start + round(2.3 * RATE)]
            rms = float(np.sqrt(np.mean(body ** 2))) or 1e-6
            self.zones.append({'path': path, 'nominal': nominal, 'hz': hz, 'rms': rms,
                               'cents': round(1200 * math.log2(hz / (440 * 2 ** ((nominal - 69) / 12))), 1)})

    def zone(self, note):
        nearest = min(abs(z['nominal'] - note) for z in self.zones)
        options = [z for z in self.zones if abs(z['nominal'] - note) == nearest]
        options.sort(key=lambda z: (z['nominal'] < note, z['path'].name))
        best = [z for z in options if z['nominal'] == options[0]['nominal']]
        # Alternate recorded round-robins for repeated notes.
        key = best[0]['nominal']
        self.turn[key] = self.turn.get(key, -1) + 1
        return best[self.turn[key] % len(best)]

    def render(self, note, seconds, velocity, swell=0.0, natural=False):
        z = self.zone(note)
        target = 440 * 2 ** ((note - 69) / 12)
        ratio = target / z['hz'] if self.tuned else 1.0
        x = decode(z['path'], ratio)
        x = x[onset(x):]
        # Common level per recording, then a gentle velocity curve.
        x = x * (0.1 / z['rms']) * (velocity ** 1.5) * self.gain
        if self.struck:
            # A softer hammer/pluck is darker as well as quieter (first-order roll-off).
            spectrum = np.fft.rfft(x, axis=0)
            f = np.fft.rfftfreq(len(x), 1 / RATE)
            spectrum /= np.sqrt(1 + (f / (1500 + 9000 * velocity)) ** 2)[:, None]
            x = np.fft.irfft(spectrum, len(x), axis=0)
        hold = seconds if not natural else len(x) / RATE
        total = round((hold + self.release) * RATE)
        if len(x) < total:
            if not self.loop:
                total = len(x)
            else:
                a, b = round(len(x) * 0.35), round(len(x) * 0.85)
                fade = round(0.35 * RATE)
                region = x[a:b]
                out = x[:b].copy()
                while len(out) < total:
                    t = np.linspace(0, 1, fade)[:, None]
                    joined = out[-fade:] * np.cos(t * np.pi / 2) + region[:fade] * np.sin(t * np.pi / 2)
                    out = np.concatenate([out[:-fade], joined, region[fade:]])
                x = out
        x = x[:total].copy()
        n = len(x)
        env = np.ones(n)
        a = min(n, round(max(self.attack, swell) * RATE))
        if a:
            env[:a] = np.sin(np.linspace(0, np.pi / 2, a)) ** 2
        r0 = min(n, round(hold * RATE))
        r = n - r0
        if r > 0:
            env[r0:] *= np.cos(np.linspace(0, np.pi / 2, r)) ** 2
        x *= env[:, None]
        # Constant-power seating of the stereo recording.
        angle = (self.pan + 1) * np.pi / 4
        x[:, 0] *= math.cos(angle) * math.sqrt(2)
        x[:, 1] *= math.sin(angle) * math.sqrt(2)
        return x, z


def vsco(pattern):
    files = sorted(VSCO.glob(pattern))
    assert files, pattern
    return files


def instruments():
    return {
        'piano': Instrument('piano', [p for p in vsco('Keys/Upright Nr1/UR1_*_mf_RR*.wav') if '_C1_' not in p.name],
                            octave=0, struck=True, attack=0.002, release=1.4, gain=0.9, send=0.34),
        'harp': Instrument('harp', vsco('Strings/Harp/KSHarp_*.wav'), octave=0, struck=True, attack=0.002,
                           release=1.0, pan=0.22, gain=0.75, send=0.3),
        'flute': Instrument('flute', vsco('Woodwinds/Flute/susvib/LDFlute_susvib_*_v1_1.wav'), attack=0.07,
                            release=0.45, pan=-0.12, gain=0.45, send=0.3, loop=True),
        'flute_pure': Instrument('flute_pure', vsco('Woodwinds/Flute/susNV/LDFlute_susNV_*_v1_1.wav'),
                                 attack=0.05, release=0.35, pan=-0.12, gain=0.55, send=0.3, loop=True),
        'violins': Instrument('violins', vsco('Strings/Violin Section/susVib/VlnEns_susVib_*_v1.wav'),
                              attack=0.6, release=1.6, pan=-0.3, gain=0.25, send=0.28, loop=True),
        'violas': Instrument('violas', vsco('Strings/Viola Section/susvib/ViolaEns_susvib_*_v1_1.wav'),
                             attack=0.6, release=1.6, pan=0.25, gain=0.23, send=0.28, loop=True),
        'cellos': Instrument('cellos', vsco('Strings/Cello Section/susvib/susvib_*_v1_1.wav'),
                             attack=0.7, release=1.8, pan=-0.12, gain=0.25, send=0.24, loop=True),
        'bass': Instrument('bass', vsco('Strings/Solo Contrabass/SusNV/BKCtbss_SusNV_*_v1_rr1.wav'),
                           attack=1.2, release=2.0, pan=0.05, gain=0.38, send=0.25, loop=True),
        'horn': Instrument('horn', [p for p in vsco('Brass/F Horn/sus/MOHorn_sus_*_v1_1.wav') if 'A0' not in p.name],
                           attack=0.9, release=1.6, pan=0.3, gain=0.48, send=0.4, loop=True),
    }


def oneshot(path, gain=1.0, pan=0.0):
    x = decode(path)
    x = x[onset(x):] * gain
    angle = (pan + 1) * np.pi / 4
    x[:, 0] *= math.cos(angle) * math.sqrt(2)
    x[:, 1] *= math.sin(angle) * math.sqrt(2)
    return x


def impulse(file_id, predelay=0.012):
    x = decode(FREESOUND / f'{file_id}.ogg')
    peak = int(np.argmax(np.abs(x).max(axis=1)))
    x = x[peak:].copy()
    # Remove the direct path (the dry signal is mixed separately) but keep early reflections.
    x[:round(0.004 * RATE)] = 0
    x = np.concatenate([np.zeros((round(predelay * RATE), 2)), x])
    tail = round(0.25 * RATE)
    x[-tail:] *= np.cos(np.linspace(0, np.pi / 2, tail))[:, None] ** 2
    return x / np.sqrt(np.sum(x ** 2) / 2)


def convolve(dry, ir):
    n = len(dry) + len(ir) - 1
    size = 1 << (n - 1).bit_length()
    out = np.zeros((n, 2))
    for c in range(2):
        out[:, c] = np.fft.irfft(np.fft.rfft(dry[:, c], size) * np.fft.rfft(ir[:, c], size), size)[:n]
    return out


class Score:
    def __init__(self, bpm, beats_per_bar, bars, tail, seed):
        self.beat = 60 / bpm
        self.per_bar = beats_per_bar
        self.seconds = bars * beats_per_bar * self.beat + tail
        self.events = []
        self.rng = np.random.default_rng(seed)

    def at(self, bar, beat):
        return ((bar - 1) * self.per_bar + (beat - 1)) * self.beat

    def note(self, inst, bar, beat, name, beats, vel, swell=0.0, natural=False, human=True):
        jitter = float(self.rng.normal(0, 0.006)) if human and inst in ('piano', 'harp') else 0.0
        v = vel * float(1 + self.rng.normal(0, 0.04)) if human else vel
        self.events.append({'instrument': inst, 'time': max(0.0, self.at(bar, beat) + jitter),
                            'note': name, 'midi': midi(name), 'seconds': beats * self.beat,
                            'velocity': round(min(1.0, max(0.05, v)), 3), 'swell': swell, 'natural': natural})

    def chord(self, inst, bar, beat, names, beats, vel, **kw):
        for n in names.split():
            self.note(inst, bar, beat, n, beats, vel, **kw)

    def arp(self, inst, bar, beat, names, step, vel, beats=6, **kw):
        for i, n in enumerate(names.split()):
            self.note(inst, bar, beat + i * step, n, beats, vel * (1 - 0.04 * i), **kw)

    def line(self, inst, bar, notes, vel, **kw):
        """notes: 'A5:2 G5:1 F5:1' (beats) starting at beat 1 of bar; 'r:1' rests."""
        t = 0.0
        for item in notes.split():
            n, d = item.split(':')
            d = float(d)
            if n != 'r':
                self.note(inst, bar, 1 + t, n, d * 0.96, vel, **kw)
            t += d

    def sample(self, path, bar, beat, gain, pan=0.0, label=None):
        self.events.append({'instrument': 'sample', 'path': path, 'time': self.at(bar, beat), 'gain': gain,
                            'pan': pan, 'note': label or path.name})


def explore_score():
    s = Score(bpm=80, beats_per_bar=4, bars=32, tail=7, seed=11)
    lh = {1: 'D3 A3', 3: 'D3 A3', 5: 'D3 A3', 7: 'F2 C3', 9: 'C3 G3', 11: 'G2 D3', 13: 'F2 C3', 15: 'C3 G3',
          17: 'D3 A3', 19: 'A2 E3', 20: 'G2 D3', 21: 'D3 A3', 23: 'F2 C3', 25: 'C3 G3', 27: 'G2 D3', 29: 'D3 A3',
          31: 'D2 A2'}
    for bar, names in lh.items():
        s.chord('piano', bar, 1, names, 6 if bar not in (19, 20, 31) else (4 if bar != 31 else 9), 0.3 if bar != 1 else 0.26)
    # The motif: a rising fourth and step, then space.
    motif = [(5, [('A4', 1, .40), ('D5', 2.5, .36), ('E5', 3.5, .34)]), (6, [('F5', 1, .37), ('E5', 3, .29)]),
             (7, [('A4', 1, .37), ('C5', 2.5, .33), ('F5', 3.5, .33)]), (8, [('E5', 1.5, .31)]),
             (9, [('G4', 1, .35), ('C5', 2.5, .32), ('D5', 3.5, .32)]), (10, [('E5', 1, .35), ('D5', 2.5, .29)]),
             (11, [('B4', 1, .33), ('D5', 2.5, .31), ('G5', 3.5, .29)]), (12, [('A5', 1, .31)])]
    for bar, notes in motif:
        for name, beat, vel in notes:
            s.note('piano', bar, beat, name, 3, vel)
    for name, beat, bar, vel in [('A5', 3, 2, .21), ('E5', 1, 4, .2), ('D5', 2.5, 4, .19)]:
        s.note('piano', bar, beat, name, 3, vel)
    # Second statement an octave higher in its second half.
    for bar, notes in motif[:4]:
        for name, beat, vel in notes:
            s.note('piano', bar + 16, beat, name, 3, vel * 0.95)
    for bar, notes in [(25, [('G5', 1, .3), ('C6', 2.5, .28), ('D6', 3.5, .28)]), (26, [('E6', 1, .29), ('D6', 2.5, .25)]),
                       (27, [('B5', 1, .28), ('D6', 2.5, .26), ('G5', 3.5, .25)]), (28, [('A5', 1, .27)]),
                       (29, [('A4', 1, .28), ('D5', 2.5, .26)]), (30, [('E5', 1, .25)]), (31, [('A5', 3, .19)]),
                       (32, [('D5', 1, .21)])]:
        for name, beat, vel in notes:
            s.note('piano', bar, beat, name, 4 if bar < 32 else 8, vel)
    for name, bar, beat in [('E5', 14, 4), ('C5', 16, 4), ('A5', 18, 4)]:
        s.note('piano', bar, beat, name, 3, 0.19)
    # Harp: rising arpeggios where the piano breathes.
    for bar, names in [(9, 'C3 G3 C4 E4 G4'), (11, 'G2 D3 G3 B3 D4'), (25, 'C3 G3 C4 E4 G4'), (27, 'G2 D3 G3 B3 D4')]:
        s.arp('harp', bar, 1, names, 0.5, 0.27)
    for bar, names in [(13, 'F2 C3 A3'), (14, 'F3 C4'), (15, 'C3 G3 E4'), (16, 'G3 C4'), (17, 'D3 A3 F4'),
                       (18, 'A3 D4'), (19, 'A2 E3 C4'), (20, 'G2 D3 B3')]:
        s.arp('harp', bar, 1, names, 0.5, 0.23)
        s.note('harp', bar, 3, names.split()[-1], 3, 0.16)
    # Flute: the B-section song (Dorian B natural on the way home).
    s.line('flute', 13, 'A5:2 G5:1 F5:1', 0.42)
    s.line('flute', 14, 'E5:3 r:1', 0.38)
    s.line('flute', 15, 'G5:2 E5:1 D5:1', 0.4)
    s.line('flute', 16, 'C5:3 r:1', 0.36)
    s.line('flute', 17, 'D5:1.5 E5:0.5 F5:2', 0.4)
    s.line('flute', 18, 'A5:3 r:1', 0.4)
    s.line('flute', 19, 'C6:2 B5:1 A5:1', 0.42)
    s.line('flute', 20, 'G5:2 A5:2', 0.38)
    s.line('flute', 22, 'D6:3 r:1', 0.3)
    s.line('flute', 24, 'C6:2 A5:2', 0.28)
    # String pad.
    for bars, cello, viola in [((3, 4), 'D2', None), ((5, 6), 'D2', 'A3'), ((7, 8), 'F2', 'A3'), ((9, 10), 'C2', 'G3'),
                               ((11, 12), 'G2', 'B3'), ((13, 14), 'F2', 'A3'), ((15, 16), 'C2', 'G3'), ((17, 18), 'D2', 'F3'),
                               ((19,), 'A2', 'E3'), ((20,), 'G2', 'D3'), ((21, 22), 'D2', 'A3'), ((23, 24), 'F2', 'A3'),
                               ((25, 26), 'C2', 'G3'), ((27, 28), 'G2', 'B3'), ((29, 30, 31, 32), 'D2', 'A3')]:
        beats = 4 * len(bars)
        s.note('cellos', bars[0], 1, cello, beats, 0.36 if bars[0] > 3 else 0.3, swell=1.4)
        if viola:
            s.note('violas', bars[0], 1, viola, beats, 0.3, swell=1.2)
    for bar, name in [(13, 'A4'), (15, 'G4'), (17, 'F4')]:
        s.note('violins', bar, 1, name, 8, 0.24, swell=1.6)
    s.note('violins', 19, 1, 'E4', 4, 0.24, swell=1.0)
    s.note('violins', 20, 1, 'D4', 4, 0.22, swell=1.0)
    for bar, name in [(21, 'D3'), (23, 'C3'), (25, 'C3'), (27, 'B2')]:
        s.note('horn', bar, 1, name, 8, 0.26, swell=1.8)
    return s


def camp_score():
    s = Score(bpm=66, beats_per_bar=3, bars=32, tail=7, seed=23)
    chords = {1: 'G', 3: 'Em', 5: 'C', 7: 'D', 9: 'G', 11: 'Bm', 13: 'C', 15: 'D', 17: 'Em', 19: 'C', 21: 'G', 23: 'D',
              25: 'C', 27: 'D', 29: 'G', 31: 'G'}
    harp = {'G': ('G2 D3 B3', 'G2 D3 G3'), 'Em': ('E2 B2 G3', 'E2 B2 E3'), 'C': ('C3 G3 E4', 'C3 G3 C4'),
            'D': ('D3 A3 F#4', 'D3 A3 D4'), 'Bm': ('B2 F#3 D4', 'B2 F#3 B3')}
    roots = {'G': 'G2', 'Em': 'E2', 'C': 'C2', 'D': 'D2', 'Bm': 'B1'}
    for bar, chord in chords.items():
        first, second = harp[chord]
        last = bar == 31
        s.arp('harp', bar, 1, first, 1, 0.33 if bar > 8 else 0.3, beats=4)
        if not last:
            s.arp('harp', bar + 1, 1, second, 1, 0.28, beats=4)
        s.note('cellos', bar, 1, roots[chord] if chord != 'Bm' else 'B2', 6 if not last else 9, 0.32, swell=0.9)
    s.chord('harp', 32, 1, 'G2 D3 B3 G4', 9, 0.3)
    for bar, notes in [(9, 'B5:2 A5:1'), (10, 'G5:3'), (11, 'F#5:2 D5:1'), (12, 'B4:3'), (13, 'C5:1 E5:1 G5:1'),
                       (14, 'A5:2 G5:1'), (15, 'F#5:2 E5:1'), (16, 'D5:3'), (17, 'E5:1 G5:1 B5:1'), (18, 'A5:2 G5:1'),
                       (19, 'E5:2 G5:1'), (20, 'A5:3'), (21, 'B5:2 D6:1'), (22, 'B5:3'), (23, 'A5:2 F#5:1'),
                       (24, 'A5:3'), (25, 'G5:2 E5:1'), (26, 'C5:3'), (27, 'D5:2 F#5:1'), (28, 'A5:3'), (29, 'G5:6')]:
        s.line('flute', bar, notes, 0.4 if bar < 29 else 0.34)
    for bars, name in [(17, 'G3'), (19, 'E3'), (21, 'B3'), (23, 'A3'), (25, 'G3'), (27, 'F#3')]:
        s.note('violas', bars, 1, name, 6, 0.26, swell=1.2)
    drum = sorted(VSCO.glob('Miscellania Raw/Misc 2/rtomtom_frame*.wav'))
    for bar in range(9, 29):
        s.sample(drum[bar % 2 if len(drum) > 1 else 0], bar, 1, 0.1 if bar % 4 == 1 else 0.07, pan=0.1)
    s.chord('piano', 29, 1, 'G2 D3 B3', 9, 0.26)
    s.note('piano', 30, 2, 'D5', 6, 0.2)
    s.note('piano', 31, 1, 'B5', 9, 0.18)
    return s


def cave_score():
    s = Score(bpm=60, beats_per_bar=4, bars=20, tail=9, seed=37)
    for bars, bass, cello in [((1, 4), 'D2', 'A2'), ((5, 6), 'D2', 'Bb2'), ((7, 8), 'D2', 'A2'), ((9, 10), 'C2', 'G2'),
                              ((11, 12), 'Bb1', 'F2'), ((13, 16), 'A1', 'E2'), ((17, 20), 'D2', 'A2')]:
        beats = 4 * (bars[1] - bars[0] + 1)
        s.note('bass', bars[0], 1, bass, beats, 0.34, swell=2.5)
        s.note('cellos', bars[0], 1, cello, beats, 0.28, swell=2.5)
    for bar, name in [(5, 'A3'), (9, 'G3'), (13, 'F3'), (17, 'E3')]:
        s.note('violas', bar, 1, name, 16 if bar < 17 else 14, 0.22, swell=3)
    for bar, name in [(9, 'F3'), (13, 'E3')]:
        s.note('horn', bar, 1, name, 14, 0.2, swell=3)
    for bar, notes in [(2, [('D6', 1), ('A5', 3)]), (4, [('F5', 1), ('E5', 2.5)]), (6, [('Eb6', 1), ('D6', 3)]),
                       (8, [('A5', 1)]), (10, [('G5', 1), ('C6', 3)]), (12, [('F5', 1), ('D5', 3)]),
                       (14, [('E5', 1), ('A5', 2.5), ('Bb5', 4)]), (16, [('A5', 1)]),
                       (18, [('D5', 1), ('A5', 2.5), ('D6', 4)]), (20, [('D5', 1)])]:
        for name, beat in notes:
            s.note('piano', bar, beat, name, 5, 0.32)
    bells = VSCO / 'Miscellania Raw/Misc 2/NepaleseBells'
    for name, bar, beat, gain in [('fx1_short_r03_main.wav', 6, 3, 0.09), ('fx2_short_r02_main.wav', 14, 2, 0.08),
                                  ('fx_long_1_main.wav', 17, 1, 0.065)]:
        s.sample(bells / name, bar, beat, gain, pan=0.3)
    for name, bar, gain in [('susCymb1-bow-1.wav', 3, 0.05), ('susCymb1-bow-3.wav', 11, 0.05), ('susCymb1-bow-2.wav', 17, 0.045)]:
        s.sample(VSCO / 'Percussion' / name, bar, 1, gain, pan=-0.35)
    for name, bar, gain in [('bassdrum_rub1_v1.wav', 1, 0.2), ('bassdrum_rub3_v1.wav', 9, 0.19), ('bassdrum_rub2_v1.wav', 17, 0.18)]:
        s.sample(VSCO / 'Percussion' / name, bar, 1, gain)
    return s


def render(score, inst, ir, wet_scale=1.0):
    length = round(score.seconds * RATE)
    dry = np.zeros((length, 2))
    send = np.zeros((length, 2))
    stems: dict = {}
    notes = []
    for e in score.events:
        if e['instrument'] == 'sample':
            x = oneshot(e['path'], e['gain'], e['pan'])
            gain_send = 0.45
            row = {**e, 'path': e['path'].relative_to(VSCO).as_posix()}
            stem = 'percussion'
        else:
            i = inst[e['instrument']]
            x, zone = i.render(e['midi'], e['seconds'], e['velocity'], swell=e['swell'], natural=e['natural'])
            gain_send = i.send
            row = {**e, 'sample': zone['path'].relative_to(VSCO).as_posix(), 'cents': zone['cents']}
            stem = e['instrument']
        notes.append({k: (round(v, 4) if isinstance(v, float) else v) for k, v in row.items()})
        o = round(e['time'] * RATE)
        n = min(len(x), length - o)
        if n <= 0:
            continue
        dry[o:o + n] += x[:n]
        send[o:o + n] += x[:n] * gain_send * wet_scale
        stems.setdefault(stem, np.zeros((length, 2), np.float32))[o:o + n] += x[:n].astype(np.float32)
    wet = convolve(send, ir)[:length]
    mix = dry + wet
    fade = round(4.5 * RATE)
    mix[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade))[:, None] ** 2
    mix[:round(0.05 * RATE)] *= np.linspace(0, 1, round(0.05 * RATE))[:, None]
    # Diagnostic balance: each dry stem's level while it is actually sounding.
    balance = {}
    for name, x in stems.items():
        power = (x.astype(np.float64) ** 2).mean(axis=1)
        block = power[:len(power) // 4410 * 4410].reshape(-1, 4410).mean(axis=1)
        active = block[block > block.max() * 1e-3]
        balance[name] = round(10 * math.log10(active.mean() + 1e-12), 1)
    used = sorted({n.get('sample') or n.get('path') for n in notes})
    return mix, used, notes, balance


def cue(inst, ir, parts, seconds, wet=0.18):
    x = np.zeros((round(seconds * RATE), 2))
    send = np.zeros_like(x)
    for name, note, at, dur, vel in parts:
        y, _ = inst[name].render(midi(note), dur, vel)
        o = round(at * RATE)
        n = min(len(y), len(x) - o)
        x[o:o + n] += y[:n]
        send[o:o + n] += y[:n] * wet
    x += convolve(send, ir)[:len(x)]
    fade = round(min(0.6, seconds / 3) * RATE)
    x[-fade:] *= np.cos(np.linspace(0, np.pi / 2, fade))[:, None] ** 2
    return x


def render_all():
    inst = instruments()
    hall = impulse(585739)       # Nox_Sound small church, 5 m: warm, about 3 s.
    nave = impulse(648945)       # Nox_Sound cathedral, 5 m: the cave themes' longer tail.
    pieces = []
    for name, score, ir, wet in [('bgm-explore', explore_score(), hall, 1.0), ('bgm-camp', camp_score(), hall, 0.9),
                                 ('bgm-cave', cave_score(), nave, 1.7)]:
        mix, used, notes, balance = render(score, inst, ir, wet)
        pieces.append({'name': name, 'audio': mix, 'used': used, 'score': notes, 'balanceDB': balance,
                       'tempo': round(60 / score.beat, 2), 'seconds': round(score.seconds, 3),
                       'impulse': 'Nox_Sound IR ' + ('585739 small church' if ir is hall else '648945 cathedral')})
    cues = [
        ('fx-confirm', [('harp', 'D5', 0.0, 0.5, 0.42), ('harp', 'A5', 0.07, 0.5, 0.3)], 1.3, hall),
        ('fx-discovery', [('harp', 'D4', 0.0, 1.2, 0.38), ('harp', 'A4', 0.11, 1.2, 0.36), ('harp', 'D5', 0.22, 1.4, 0.36),
                          ('harp', 'F#5', 0.33, 1.6, 0.34), ('piano', 'A5', 0.36, 1.8, 0.24)], 2.8, hall),
        ('fx-recall', [('flute_pure', 'A5', 0.0, 0.32, 0.5), ('flute_pure', 'D6', 0.36, 0.55, 0.52)], 1.45, hall),
    ]
    for name, parts, seconds, ir in cues:
        pieces.append({'name': name, 'audio': cue(inst, ir, parts, seconds), 'used': sorted({
            inst[p[0]].zone(midi(p[1]))['path'].relative_to(VSCO).as_posix() for p in parts}),
            'score': [{'instrument': p[0], 'note': p[1], 'time': p[2], 'seconds': p[3], 'velocity': p[4]} for p in parts],
            'impulse': 'Nox_Sound IR 585739 small church'})
    tuning = {k: [{'sample': z['path'].name, 'nominal': z['nominal'], 'cents': z['cents']} for z in v.zones]
              for k, v in inst.items()}
    return pieces, tuning


if __name__ == '__main__':
    import wave
    MASTERS.mkdir(parents=True, exist_ok=True)
    pieces, tuning = render_all()
    for p in pieces:
        x = p['audio'] / max(1e-9, np.abs(p['audio']).max()) * 0.5
        with wave.open(str(MASTERS / f"{p['name']}-preview.wav"), 'wb') as w:
            w.setnchannels(2); w.setsampwidth(2); w.setframerate(RATE)
            w.writeframes(np.round(x * 32767).astype('<i2').tobytes())
        print(p['name'], p.get('seconds'), len(p['score']), 'events', p.get('balanceDB'))
    (MASTERS / 'music-tuning.json').write_text(json.dumps(tuning, indent=1), encoding='utf-8')
