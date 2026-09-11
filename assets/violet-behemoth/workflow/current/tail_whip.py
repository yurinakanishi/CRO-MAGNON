"""Secondary tail motion for the seven-bone behemoth tail.

The tail is a damped chain: every bone is a torsion spring on its parent, is
dragged by the parent frame's world yaw velocity (steady lag) and reacts to the
parent frame's angular acceleration (whip on sudden starts and stops). Loop
clips are driven by an authored travelling wave and reduced to exact sinusoids
so that the clip seam closes; the tail spin is simulated as a one-shot.
Angles are degrees, time in seconds. No Blender dependency.
"""
import math
import numpy as np

N = 7
FPS = 30
SUBSTEPS = 8
SPIN_RATE = 360.0 / 0.85  # degrees per second of the authoritative sweep


def chain():
    natural = [30.0, 27.0, 24.0, 21.0, 18.0, 16.0, 14.0]  # rad/s, softer toward the tip
    zeta = 0.34
    k = [w * w for w in natural]
    c = [2 * zeta * w for w in natural]
    inertia = [0.38] * N  # fraction of parent angular acceleration felt as reaction
    lag = [4.6 + 0.65 * i for i in range(N)]  # steady lag per bone at the spin rate
    drag = [k[i] * lag[i] / SPIN_RATE for i in range(N)]
    return k, c, inertia, drag


def simulate(seconds, base_velocity, target=None, fps=FPS, substeps=SUBSTEPS):
    """Return relative yaw per bone, shape (frames + 1, N), sampled at fps.

    base_velocity(t): world yaw velocity of the hips in deg/s.
    target(t, i): muscular target yaw for bone i (authored undulation), or None.
    """
    k, c, inertia, drag = chain()
    frames = round(seconds * fps)
    dt = 1.0 / (fps * substeps)
    theta = np.zeros(N)
    omega = np.zeros(N)
    out = np.zeros((frames + 1, N))
    out[0] = theta
    previous_base = base_velocity(0.0)
    for frame in range(1, frames + 1):
        for step in range(substeps):
            t = (frame - 1) / fps + (step + 1) * dt
            base = base_velocity(t)
            base_accel = (base - previous_base) / dt
            previous_base = base
            parent_velocity = base
            parent_accel = base_accel
            alpha = np.zeros(N)
            for i in range(N):
                goal = target(t, i) if target else 0.0
                alpha[i] = (
                    -k[i] * (theta[i] - goal)
                    - c[i] * omega[i]
                    - inertia[i] * parent_accel
                    - drag[i] * parent_velocity
                )
                parent_velocity += omega[i]
                parent_accel += alpha[i]
            omega += alpha * dt
            theta += omega * dt
        out[frame] = theta
    return out


def fit_periodic(samples, cycle, fps=FPS, harmonics=2):
    """Least-squares Fourier fit of the final cycle so the loop closes exactly.

    samples: (frames + 1, N) from a simulation covering several cycles.
    Returns a function yaw(u, i) for loop phase u in [0, 1].
    """
    per_cycle = round(cycle * fps)
    last = samples[-per_cycle - 1 : -1]
    u = np.arange(per_cycle) / per_cycle
    columns = [np.ones(per_cycle)]
    for h in range(1, harmonics + 1):
        columns += [np.sin(2 * math.pi * h * u), np.cos(2 * math.pi * h * u)]
    basis = np.stack(columns, axis=1)
    coefficients, *_ = np.linalg.lstsq(basis, last, rcond=None)

    def evaluate(phase, i):
        value = coefficients[0, i]
        for h in range(1, harmonics + 1):
            value += coefficients[2 * h - 1, i] * math.sin(2 * math.pi * h * phase)
            value += coefficients[2 * h, i] * math.cos(2 * math.pi * h * phase)
        return float(value)

    return evaluate, coefficients


def gait_wave(cycle, amplitude, growth, phase_step):
    """Authored travelling wave: amplitude grows toward the tip and lags per bone."""
    omega = 2 * math.pi / cycle

    def target(t, i):
        return (amplitude + growth * i) * math.sin(omega * t - phase_step * i)

    return target


def gait_yaw(cycle, amplitude, growth, phase_step, cycles=8):
    samples = simulate(cycle * cycles, lambda t: 0.0, gait_wave(cycle, amplitude, growth, phase_step))
    evaluate, coefficients = fit_periodic(samples, cycle)
    return evaluate, coefficients


def spin_profile(seconds=1.5, windup=0.33, sweep=0.85, coil=2.6, coil_growth=0.5):
    """One-shot tail spin: coil during the windup, lag and crack during the sweep."""

    def base_velocity(t):
        return SPIN_RATE if windup <= t < windup + sweep else 0.0

    def target(t, i):
        if t >= windup:
            return 0.0
        u = t / windup
        return (coil + coil_growth * i) * u * u * (3 - 2 * u)

    return simulate(seconds, base_velocity, target), base_velocity


def hips_yaw(t, windup=0.33, sweep=0.85):
    return float(np.clip((t - windup) / sweep, 0, 1)) * 360.0


if __name__ == '__main__':
    for name, cycle, amp, growth, step in [('Walk', 1.2, 2.0, 0.9, 0.5), ('Run', 0.4, 1.6, 0.7, 0.75)]:
        evaluate, coefficients = gait_yaw(cycle, amp, growth, step)
        peaks = []
        for i in range(N):
            values = [evaluate(u / 60, i) for u in range(60)]
            peaks.append(max(abs(v) for v in values))
        tip = [sum(evaluate(u / 60, i) for i in range(N)) for u in range(60)]
        print(name, 'bone peaks', [round(p, 1) for p in peaks], 'tip cumulative range', round(min(tip), 1), round(max(tip), 1))
    samples, _ = spin_profile()
    tip = samples.sum(axis=1)
    for frame in range(0, 46, 3):
        print('spin', round(frame / 30, 2), 'hips', round(hips_yaw(frame / 30)), 'bones', [round(v, 1) for v in samples[frame]], 'tip', round(tip[frame], 1))
