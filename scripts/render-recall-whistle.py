"""Render the recall whistle (fx-recall): a person whistling to call their companion.

The previous cue was two held concert-flute notes (A5, D6) from a stereo sample with a small
church's reverb: out of phase between the ears, no glide, no breath. A whistle through the lips
is nearly a sine whose pitch slides, so it is synthesised here: a short rising "fwee" that
slurs, without a new breath, into a lower falling "yoo" with a little vibrato, carried on breath
noise around the tone. Mono and dry, like the other action sounds; the game places it.

Deterministic (fixed seed). Mastered and measured by prepare-nature-remake.write(), which writes
the 24-bit master, the shipped MP3 and the measured facts; only the fx-recall entry and the
totals of public/audio/nature/manifest.json change. Requires numpy and FFmpeg (libmp3lame).
"""
from __future__ import annotations

import importlib.util, json, pathlib
import numpy as np

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('remake', ROOT / 'scripts/prepare-nature-remake.py')
remake = importlib.util.module_from_spec(spec)
spec.loader.exec_module(remake)
RATE = remake.RATE
SEED = 20261014
SECONDS = 1.0

# The pitch through the call (seconds, Hz): a rise into the high note, a slur down, a held low
# note that sags as the breath runs out. Neighbouring points join on a smooth S-curve.
CONTOUR = [
    (0.000, 1480.0),
    (0.130, 2190.0),  # the rise ends just above the note
    (0.175, 2150.0),
    (0.330, 2120.0),
    (0.425, 1560.0),  # the slur, in the same breath
    (0.500, 1500.0),
    (0.820, 1465.0),
    (0.950, 1385.0),  # about 100 cents of sag as the lips relax
]
# Amplitude (seconds, level): a soft attack, a dip at the slur, a slow fade and a release.
LEVEL = [
    (0.000, 0.0),
    (0.012, 0.0),
    (0.050, 1.0),
    (0.300, 0.97),
    (0.375, 0.36),
    (0.450, 0.92),
    (0.820, 0.78),
    (0.950, 0.0),
]


def curve(points, t):
    """Piecewise S-curve (cosine) through the points; flat before the first and after the last."""
    times = np.array([p[0] for p in points])
    values = np.array([p[1] for p in points])
    i = np.clip(np.searchsorted(times, t, side='right') - 1, 0, len(times) - 2)
    span = times[i + 1] - times[i]
    u = np.clip((t - times[i]) / span, 0.0, 1.0)
    s = (1 - np.cos(np.pi * u)) / 2
    return values[i] + (values[i + 1] - values[i]) * s


def band(noise, low=None, high=None, soft=0.15):
    """Zero-phase FFT filter: keep `low`..`high` Hz with cosine shoulders `soft` (fraction) wide."""
    spectrum = np.fft.rfft(noise)
    freq = np.fft.rfftfreq(len(noise), 1 / RATE)
    gain = np.ones_like(freq)

    def shoulder(edge, rising):
        width = max(edge * soft, 1.0)
        u = np.clip((freq - (edge - width / 2)) / width, 0.0, 1.0)
        ramp = (1 - np.cos(np.pi * u)) / 2
        return ramp if rising else 1 - ramp

    if low:
        gain *= shoulder(low, True)
    if high:
        gain *= shoulder(high, False)
    out = np.fft.irfft(spectrum * gain, len(noise))
    return out / (np.sqrt(np.mean(out ** 2)) + 1e-12)


def window(t, start, rise, end, fall):
    """0 → 1 over start..start+rise (sin²), 1 → 0 over end-fall..end (cos²)."""
    up = np.clip((t - start) / rise, 0.0, 1.0)
    down = np.clip((end - t) / fall, 0.0, 1.0)
    return np.sin(np.pi / 2 * up) ** 2 * np.sin(np.pi / 2 * down) ** 2


def render():
    rng = np.random.default_rng(SEED)
    n = round(SECONDS * RATE)
    t = np.arange(n) / RATE
    # Vibrato only once a note has settled: a trace on the high note, more on the long low one.
    depth = 8 * window(t, 0.18, 0.10, 0.34, 0.04) + 22 * window(t, 0.50, 0.22, 0.95, 0.12)
    rate = 5.6 + 0.4 * band(rng.standard_normal(n), high=3)
    vibrato = depth * np.sin(2 * np.pi * np.cumsum(rate) / RATE)
    drift = 5 * band(rng.standard_normal(n), high=6)  # cents: no breath holds a pitch exactly
    pitch = curve(CONTOUR, t) * 2 ** ((vibrato + drift) / 1200)
    phase = 2 * np.pi * np.cumsum(pitch) / RATE
    # Nearly a sine; the lips add a faint second and third harmonic.
    tone = np.sin(phase) + 10 ** (-30 / 20) * np.sin(2 * phase + 0.3) + 10 ** (-42 / 20) * np.sin(3 * phase + 1.1)
    level = curve(LEVEL, t) * (1 + 0.03 * band(rng.standard_normal(n), high=12))
    # Breath riding on the tone: noise a few hundred hertz wide around the pitch itself.
    hiss = band(rng.standard_normal(n), high=240) * np.sin(phase + 0.7)
    # Air past the lips before the tone sounds and as it ends, and a trace throughout.
    air = band(rng.standard_normal(n), low=2500, high=9000)
    onset = window(t, 0.0, 0.012, 0.075, 0.05)
    tail = window(t, 0.86, 0.04, 0.99, 0.08)
    x = (
        level * (tone + 10 ** (-22 / 20) * hiss)
        + 10 ** (-27 / 20) * onset * air
        + 10 ** (-38 / 20) * np.maximum(level, tail) * air
    )
    return x[:, None]


def main():
    x = render()
    processing = {
        'synthesis': 'scripts/render-recall-whistle.py',
        'seed': SEED,
        'pitch': [{'time': a, 'hz': b} for a, b in CONTOUR],
        'level': [{'time': a, 'level': b} for a, b in LEVEL],
        'vibrato': '5.6 Hz; 8 cents on the high note, 22 cents on the low note',
        'harmonics': '2nd -30 dB, 3rd -42 dB',
        'breath': 'noise 480 Hz wide around the pitch at -22 dB; 2.5-9 kHz air at the onset (-27 dB) and throughout (-38 dB)',
        'note': 'replaces the stereo flute notes and church reverb of revision 4; mono and dry',
    }
    remake.write('fx-recall', x, kind='oneshot', sources=[], processing=processing)
    info = remake.FILES[-1]
    path = remake.OUT / 'manifest.json'
    manifest = json.loads(path.read_text(encoding='utf-8'))
    manifest['files'] = [info if f['name'] == 'fx-recall' else f for f in manifest['files']]
    files = manifest['files']
    manifest['totalBytes'] = sum(f['bytes'] for f in files)
    manifest['decodedBytesAt48000Hz'] = sum(
        round(f['seconds'] * 48000) * f['channels'] * 4 for f in files if f['kind'] != 'music'
    )
    path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')


if __name__ == '__main__':
    main()
