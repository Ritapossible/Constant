"""
Soundtrack for the ConstantUnits intro film (video.html, 72 s): an Afrobeats / amapiano-style groove at 108 bpm,
synthesised from scratch with numpy and scipy, so there is nothing to license.

The music follows the story:
  0–6.25   A minor groove with a marimba hook, from the first frame.
  6.25     The groove tape-stops when the call drops (the data runs out); a hit; the "data used up" ping.
  7–12.9   Dark pulse, clock ticks.
  12.9     The groove comes back, as if from the TV, under crowd noise.
  19.4     Power cut: the hum sags, the groove tape-stops, a hit; then a heartbeat.
  25.2–30  Build: snare roll that speeds up, a riser, a beat of silence.
  30       The drop on the logo: C major groove, log-drum bass, claps, shakers, the hook in major.
  50–58    A chime for each bill that pays.
  55.2     Lift for the happy scenes: hook an octave up, strings.
  65.2     Outro under the end card: drums thin out, last phrase, final hit, ring out.

  python3 music.py out/music.wav
"""

import sys
import wave

import numpy as np
from scipy.signal import butter, sosfilt

SR = 48000
DUR = 72.0
N = int(SR * DUR)
BPM = 108
BEAT = 60 / BPM
STEP = BEAT / 4  # a sixteenth
BAR = BEAT * 4
rng = np.random.default_rng(11)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def secs(d):
    return np.arange(int(d * SR)) / SR


def lp(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x)


def hp(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


class Bus:
    def __init__(self):
        self.x = np.zeros((2, N))

    def add(self, at, sig, gain=1.0, pan=0.0):
        i = int(round(at * SR))
        if i >= N or i < 0:
            return
        sig = sig[: N - i] * gain
        self.x[0, i : i + len(sig)] += sig * np.sqrt((1 - pan) / 2) * 1.414
        self.x[1, i : i + len(sig)] += sig * np.sqrt((1 + pan) / 2) * 1.414


# ── Instruments ──────────────────────────────────────────────────────────────────────


def kick(depth=1.0):
    t = secs(0.42)
    f = 46 + 110 * np.exp(-t * 32)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 7.5)
    click = hp(rng.standard_normal(len(t)), 2500) * np.exp(-t * 400) * 0.25
    return np.tanh((body + click) * 1.4 * depth)


def clap():
    t = secs(0.32)
    n = bp(rng.standard_normal(len(t)), 900, 4200)
    e = np.zeros_like(t)
    for k, d in enumerate([0, 0.011, 0.022]):  # three hands, slightly apart
        i = int(d * SR)
        e[i:] += np.exp(-(t[: len(t) - i]) * (90 if k < 2 else 16))
    return n * e * 0.8


def shaker(accent=1.0):
    t = secs(0.07)
    return hp(rng.standard_normal(len(t)), 7000) * np.exp(-t * 70) * accent


def rim():
    t = secs(0.09)
    tone = np.sin(2 * np.pi * 1700 * t) * 0.6 + np.sin(2 * np.pi * 820 * t) * 0.4
    return (tone + bp(rng.standard_normal(len(t)), 1500, 5000) * 0.4) * np.exp(-t * 60)


def snare():
    t = secs(0.22)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t * 30)
    n = bp(rng.standard_normal(len(t)), 1200, 8000) * np.exp(-t * 22)
    return body * 0.5 + n * 0.8


def log_drum(n, dur=0.42):
    """Amapiano log drum: a round, pitch-dropping bass hit with a little grit."""
    t = secs(dur)
    f = midi(n) * (1 + 0.5 * np.exp(-t * 40))
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.25 * np.sin(2 * ph)
    return np.tanh(x * 1.8) * np.exp(-t * 6) * (1 - np.exp(-t * 900))


def marimba(n, dur=0.6, bright=1.0):
    t = secs(dur)
    f = midi(n)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t * 7) + 0.35 * bright * np.sin(2 * np.pi * f * 4 * t) * np.exp(-t * 30)
    x += 0.15 * bright * np.sin(2 * np.pi * f * 10 * t) * np.exp(-t * 80)
    return x * (1 - np.exp(-t * 1500))


def keys(notes, dur):
    """A soft electric-piano chord stab."""
    t = secs(dur)
    x = sum(np.sin(2 * np.pi * midi(n) * t) + 0.2 * np.sin(2 * np.pi * midi(n) * 2 * t) * np.exp(-t * 8) for n in notes)
    return x / len(notes) * np.exp(-t * 3.2) * (1 - np.exp(-t * 600))


def pad(notes, dur, bright=0.3):
    t = secs(dur)
    x = sum(
        sum(np.sin(2 * np.pi * midi(n) * (1 + d) * t) for d in (-0.004, 0.0, 0.004)) + bright * np.sin(2 * np.pi * midi(n) * 2 * t)
        for n in notes
    )
    e = np.minimum(1, t / (dur * 0.3)) * np.minimum(1, (dur - t) / (dur * 0.3))
    return lp(x / len(notes) / 3, 2500) * e


def bell(n, dur=1.6):
    t = secs(dur)
    f = midi(n)
    parts = ((1, 1, 2.6), (2.76, 0.4, 5.0), (5.4, 0.2, 8.0), (2, 0.3, 3.5))
    return sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t * d) for m, a, d in parts) * (1 - np.exp(-t * 2000))


def boom(dur=2.4):
    t = secs(dur)
    f = 36 + 70 * np.exp(-t * 7)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.8)
    air = lp(rng.standard_normal(len(t)), 700) * np.exp(-t * 4) * 0.7
    return np.tanh((body + air) * 1.3)


def whoosh(dur=0.9, up=True):
    t = secs(dur)
    k = t / dur if up else 1 - t / dur
    x = np.zeros_like(t)
    noise = rng.standard_normal(len(t))
    for a, b in ((0.0, 0.33), (0.33, 0.66), (0.66, 1.0)):  # a sweep in three bands
        m = (k >= a) & (k < b + 0.12)
        x += bp(noise, 400 + 5000 * a, 900 + 7000 * b) * m
    return x * np.sin(np.pi * t / dur) ** 2 * 0.7


def riser(dur):
    t = secs(dur)
    noise = rng.standard_normal(len(t))
    x = np.zeros_like(t)
    for k in range(8):  # filter opening in steps, crossfaded
        lo, hi = k / 8, (k + 1) / 8
        w = np.clip(1 - np.abs(t / dur - (lo + hi) / 2) * 8, 0, 1)
        x += bp(noise, 200 + 900 * k, 900 + 1400 * k) * w
    tone = np.sin(2 * np.pi * np.cumsum(220 * 2 ** (2 * t / dur)) / SR) * 0.15
    return (x + tone) * (t / dur) ** 2


def power_down(dur=1.0):
    t = secs(dur)
    f = 100 * (1 - 0.6 * (t / dur) ** 1.4)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.3 * np.sin(3 * ph)) * (1 - t / dur) ** 1.5 * 0.5


def crowd(dur):
    t = secs(dur)
    x = bp(rng.standard_normal(len(t)), 300, 2500)
    swell = 0.6 + 0.4 * np.sin(2 * np.pi * t / 3.1) ** 2
    return x * swell * np.minimum(1, t / 1.0)


def heartbeat():
    return np.concatenate([kick(0.55), np.zeros(int(0.06 * SR))])[: int(0.4 * SR)]


def tape_stop(bus, at, length=0.55):
    """Slow the bus to a halt from `at`, like a record losing power; silence after."""
    i0 = int(at * SR)
    n = int(length * SR)
    rate = np.linspace(1, 0, n) ** 1.3
    pos = i0 + np.cumsum(rate)
    for c in range(2):
        seg = np.interp(pos, np.arange(N), bus.x[c])
        bus.x[c, i0 : i0 + n] = seg * np.linspace(1, 0.3, n)
        bus.x[c, i0 + n :] = 0


# ── Patterns (sixteenth steps in a bar) ─────────────────────────────────────────────

KICK = [0, 6, 8, 12]  # afro bounce, on the floor with a push before beat three
KICK_HALF = [0, 10]
CLAP = [4, 12]
RIM = [3, 7, 10, 14]  # syncopated, around the tresillo
SHAKE_ACC = [2, 6, 10, 14]

# The hook: two bars, A minor pentatonic in part one, C major pentatonic after the drop.
HOOK_MIN = [[(0, 69), (3, 72), (6, 74), (8, 76), (11, 74), (14, 72)], [(0, 69), (3, 67), (6, 69), (10, 72), (12, 69)]]
HOOK_MAJ = [[(0, 76), (3, 79), (6, 81), (8, 79), (10, 76), (12, 74)], [(0, 72), (3, 74), (6, 76), (10, 79), (12, 76), (14, 74)]]
HOOK_ANSWER = [[(0, 84), (2, 81), (4, 79), (7, 81), (10, 76)], [(0, 79), (3, 76), (6, 74), (8, 76), (12, 72)]]

MINOR = [(45, [57, 60, 64]), (41, [57, 60, 65]), (43, [55, 59, 62]), (40, [56, 59, 64])]  # Am F G E
MAJOR = [(36, [60, 64, 67, 71]), (33, [57, 60, 64, 67]), (38, [57, 60, 62, 65]), (43, [55, 59, 62, 65])]  # Cmaj7 Am7 Dm7 G7
LOG_LINE = [(0, 0), (3, 0), (6, 7), (10, 3), (12, 0), (14, 7)]  # steps, semitones above the root


def drums(bus, at, bars, kick_steps=KICK, claps=True, rims=True, shakers=True, gain=1.0):
    for b in range(bars):
        t0 = at + b * BAR
        for s in range(16):
            t = t0 + s * STEP
            if s in kick_steps:
                bus.add(t, kick(), 0.55 * gain)
            if claps and s in CLAP:
                bus.add(t, clap(), 0.32 * gain, pan=0.05)
            if rims and s in RIM:
                bus.add(t, rim(), 0.13 * gain, pan=-0.35)
            if shakers:
                bus.add(t + (STEP * 0.12 if s % 2 else 0), shaker(1.0 if s in SHAKE_ACC else 0.45), 0.09 * gain, pan=0.4)


def bass_and_chords(bus, pads, at, bars, prog, log=True, stabs=True, bar_offset=0):
    for b in range(bars):
        t0 = at + b * BAR
        root, chord = prog[(b + bar_offset) % len(prog)]
        if log:
            for s, iv in LOG_LINE:
                bus.add(t0 + s * STEP, log_drum(root + iv), 0.5)
        if stabs:
            for s in (2, 7, 10):  # off-beat keys
                bus.add(t0 + s * STEP, keys(chord, 0.5), 0.16, pan=-0.15)
        pads.add(t0, pad(chord, BAR + 0.3), 0.18)


def hook(bus, at, bars, phrase, octave=0, gain=0.22, pan=0.2):
    for b in range(bars):
        for s, n in phrase[b % len(phrase)]:
            bus.add(at + b * BAR + s * STEP, marimba(n + octave), gain, pan=pan)
            bus.add(at + b * BAR + s * STEP + STEP * 3, marimba(n + octave, bright=0.5), gain * 0.25, pan=-pan)  # echo


def duck(x, at, end, depth=0.55):
    """Pump the pads against the kick so the groove breathes."""
    t = np.arange(N) / SR
    m = (t >= at) & (t < end)
    ph = ((t - at) % BEAT) / BEAT
    g = 1 - depth * np.exp(-ph * 9)
    x[:, m] *= g[m]


def reverb(x, seconds=1.8, mix=0.2):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)]) * np.exp(-t * 6.9 / seconds)
    ir[:, : int(0.015 * SR)] = 0
    ir /= np.sqrt((ir**2).sum(axis=1, keepdims=True))
    size = 1 << int(np.ceil(np.log2(x.shape[1] + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:, : x.shape[1]]
    return x + wet * mix * 1.5


def main(path):
    g1, g2, main_, pads, fx = Bus(), Bus(), Bus(), Bus(), Bus()

    # 0 – 6.25: the groove the film opens on. A pickup on the first frame so it starts with energy.
    bars1 = 3
    g1.add(0, rim(), 0.18)
    drums(g1, 0, bars1, gain=0.85)
    bass_and_chords(g1, g1, 0, bars1, MINOR)
    hook(g1, 0, bars1, HOOK_MIN, gain=0.24)
    tape_stop(g1, 6.25)

    fx.add(6.25, boom(), 0.8)
    fx.add(7.0, bell(88, 1.0), 0.12, pan=0.4)  # "You have used up your data"

    # 7 – 12.9: tension. A sub pulse on each beat and a clock.
    t = 7.0
    while t < 12.8:
        fx.add(t, log_drum(33, 0.5), 0.35)
        fx.add(t + BEAT / 2, rim(), 0.06, pan=0.5)
        t += BEAT
    pads.add(7.0, pad([57, 60, 64], 6.0, 0.15), 0.2)
    fx.add(12.4, whoosh(0.6), 0.5)

    # 12.9 – 19.4: the match. The groove again, a little muffled, under the crowd.
    a2 = 12.9
    bars2 = 3
    drums(g2, a2, bars2, kick_steps=KICK, gain=0.75)
    bass_and_chords(g2, g2, a2, bars2, MINOR, bar_offset=1)
    hook(g2, a2, bars2, HOOK_MIN[::-1], gain=0.2, pan=-0.2)
    g2.add(a2, crowd(6.5), 0.08)
    g2.x = lp(g2.x, 3800)
    fx.add(18.5, power_down(), 0.6)
    tape_stop(g2, 19.4, 0.4)
    fx.add(19.4, boom(2.8), 0.85)

    # 19.4 – 25.2: heartbeat in the dark.
    t = 20.6
    while t < 25.2:
        fx.add(t, heartbeat(), 0.45)
        t += 60 / 72
    pads.add(19.8, pad([45, 52, 57, 60], 5.6, 0.1), 0.22)

    # 25.2 – 30: build. A snare roll in eighths, then sixteenths, then thirty-seconds; a riser; silence on the last beat.
    build_end = 30.0 - BEAT * 0.5
    t, k = 25.2, 0
    while t < build_end:
        p = (t - 25.2) / (build_end - 25.2)
        fx.add(t, snare(), 0.18 + 0.3 * p, pan=0.1)
        t += STEP * (2 if p < 0.45 else 1 if p < 0.8 else 0.5)
        k += 1
    fx.add(25.2, riser(build_end - 25.2), 0.8)
    pads.add(25.2, pad([52, 57, 60, 64], build_end - 25.2, 0.3), 0.22)
    fx.add(25.2, whoosh(0.8), 0.4)
    for b in range(2):  # the hook teased, filtered
        hook(fx, 25.2 + b * BAR, 1, [HOOK_MAJ[b]], gain=0.1)

    # 30 – 65.2: the drop and the main groove.
    drop = 30.0
    fx.add(drop, boom(3.0), 0.75)
    fx.add(drop, bell(84, 2.4), 0.14)
    bars = int((65.2 - drop) / BAR + 0.999)
    drums(main_, drop, bars)
    bass_and_chords(main_, pads, drop, bars, MAJOR)
    hook(main_, drop, bars, HOOK_MAJ, gain=0.24)
    lift_bar = int((55.2 - drop) / BAR)
    hook(main_, drop + lift_bar * BAR, bars - lift_bar, HOOK_ANSWER, octave=0, gain=0.12, pan=-0.35)
    for b in range(lift_bar, bars):
        root, chord = MAJOR[b % 4]
        pads.add(drop + b * BAR, pad([n + 12 for n in chord], BAR + 0.3, 0.4), 0.1)
    for at in (37.2, 55.2, 60.8):
        fx.add(at - 0.45, whoosh(0.7), 0.45)

    # Each bill that pays: in the app (50, 51.1, 52.2) and on the split screen (56.4, 57.4, 58.4).
    for k, at in enumerate([50.0, 51.1, 52.2]):
        fx.add(at + 0.05, bell([88, 91, 95][k], 1.2), 0.1, pan=-0.3)
    for k, at in enumerate([56.4, 57.4, 58.4]):
        fx.add(at, bell([91, 95, 100][k], 1.6), 0.13, pan=[-0.4, 0.4, 0.0][k])

    # 65.2 – 72: outro. Kick and claps drop out; shakers, keys and the hook finish the phrase; final hit.
    out = drop + bars * BAR
    drums(main_, out, 2, kick_steps=[], claps=False, rims=True, gain=0.6)
    hook(main_, out, 2, HOOK_MAJ, gain=0.28)
    for b in range(2):
        root, chord = MAJOR[b % 4]
        main_.add(out + b * BAR, log_drum(root, 0.8), 0.55)
        pads.add(out + b * BAR, pad(chord, BAR + 0.3, 0.3), 0.3)
    end_hit = out + 2 * BAR
    fx.add(end_hit, boom(3.0), 0.55)
    fx.add(end_hit, keys([48, 55, 60, 64, 67, 72], 3.0), 0.4)
    fx.add(end_hit, bell(84, 3.0), 0.14)

    duck(pads.x, drop, out)
    mix = g1.x + g2.x + main_.x + pads.x + fx.x
    mix = reverb(mix)
    mix = hp(mix, 30) + 0.7 * hp(mix, 2500)  # trim rumble, brighten so it carries on phone speakers
    mix = np.tanh(mix * 1.2) / 1.2  # gentle glue

    t = np.arange(N) / SR
    mix *= np.clip((DUR - t) / 1.5, 0, 1) * np.clip(t / 0.02, 0, 1)
    mix /= np.max(np.abs(mix)) / 0.89  # about -1 dBFS

    pcm = (mix.T * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"drop at {drop}s, outro at {out:.2f}s, final hit at {end_hit:.2f}s")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/music.wav")
