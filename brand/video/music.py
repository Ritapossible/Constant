"""
Soundtrack for the ConstantUnits intro film (video.html, 72 s).

Synthesised from scratch with numpy, so there is nothing to license. Two halves:
  0–30 s   A minor, slow and tense: a low drone, a heartbeat pulse, a ticking clock, a hit when the call
           drops (6.25 s) and a power-down when the light goes off (19.4 s), then a riser into the brand.
  30–72 s  C major, warm and steady: pad, plucked arpeggio, soft kick and shaker, a chime for each bill
           that pays, a held chord and a fade.

  python3 music.py out/music.wav
"""

import sys
import wave

import numpy as np

SR = 48000
DUR = 72.0
N = int(SR * DUR)
rng = np.random.default_rng(7)


def midi(n):
    return 440.0 * 2 ** ((n - 69) / 12)


def env(n, a, r, sustain=1.0):
    """Attack/release envelope over n samples (seconds for a and r)."""
    e = np.ones(n) * sustain
    na, nr = max(1, int(a * SR)), max(1, int(r * SR))
    e[:na] = np.linspace(0, sustain, na)
    e[-nr:] *= np.linspace(1, 0, nr)
    return e


def lowpass(x, cutoff):
    """One-pole low-pass; cutoff may be a number or an array per sample."""
    c = np.broadcast_to(np.asarray(cutoff, float), x.shape)
    k = 1 - np.exp(-2 * np.pi * c / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc += k[i] * (x[i] - acc)
        y[i] = acc
    return y


def add(buf, at, sig, gain=1.0, pan=0.0):
    i = int(at * SR)
    if i >= N:
        return
    sig = sig[: N - i]
    l, r = np.sqrt((1 - pan) / 2), np.sqrt((1 + pan) / 2)
    buf[0, i : i + len(sig)] += sig * gain * l * 1.414
    buf[1, i : i + len(sig)] += sig * gain * r * 1.414


def tone(freq, dur, harmonics=((1, 1.0),), detune=0.0):
    t = np.arange(int(dur * SR)) / SR
    out = np.zeros_like(t)
    for h, a in harmonics:
        out += a * np.sin(2 * np.pi * freq * h * t)
        if detune:
            out += a * np.sin(2 * np.pi * freq * h * (1 + detune) * t)
    return out


def pad(notes, dur, bright=0.35):
    sig = sum(tone(midi(n), dur, ((1, 1), (2, bright), (3, bright / 3)), detune=0.003) for n in notes)
    return sig / len(notes) * env(len(sig), dur * 0.35, dur * 0.4)


def pluck(n, dur=0.9):
    t = np.arange(int(dur * SR)) / SR
    f = midi(n)
    sig = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(4 * np.pi * f * t) + 0.12 * np.sin(6 * np.pi * f * t)
    return sig * np.exp(-t * 5.5) * env(len(t), 0.004, 0.05)


def kick(dur=0.35, depth=1.0):
    t = np.arange(int(dur * SR)) / SR
    f = 48 + 90 * np.exp(-t * 28)
    ph = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(ph) * np.exp(-t * 9) * depth


def noise(dur):
    return rng.standard_normal(int(dur * SR))


def hat(dur=0.08):
    t = np.arange(int(dur * SR)) / SR
    x = noise(dur)
    x = x - lowpass(x, 6000)
    return x * np.exp(-t * 60)


def tick(dur=0.03):
    t = np.arange(int(dur * SR)) / SR
    return np.sin(2 * np.pi * 2400 * t) * np.exp(-t * 220)


def bell(n, dur=2.2):
    t = np.arange(int(dur * SR)) / SR
    f = midi(n)
    parts = ((1, 1, 2.2), (2.76, 0.45, 4.0), (5.4, 0.22, 6.5), (2, 0.3, 3.0))
    return sum(a * np.sin(2 * np.pi * f * m * t) * np.exp(-t * d) for m, a, d in parts) * env(len(t), 0.002, 0.2)


def boom(dur=2.4):
    t = np.arange(int(dur * SR)) / SR
    f = 38 + 60 * np.exp(-t * 6)
    body = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 1.6)
    air = lowpass(noise(dur), 900) * np.exp(-t * 3.5) * 0.8
    return body + air


def riser(dur):
    t = np.arange(int(dur * SR)) / SR
    x = lowpass(noise(dur), 300 + 5000 * (t / dur) ** 2)
    return x * (t / dur) ** 2


def power_down(dur=1.4):
    """A hum that sags in pitch and dies, like a fridge and a TV losing the grid."""
    t = np.arange(int(dur * SR)) / SR
    f = 100 * (1 - 0.55 * (t / dur) ** 1.5)
    ph = 2 * np.pi * np.cumsum(f) / SR
    hum = np.sin(ph) + 0.5 * np.sin(2 * ph) + 0.25 * np.sin(3 * ph)
    return hum * (1 - t / dur) ** 2 * 0.6


def reverb(x, seconds=2.2, mix=0.22):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    ir = np.stack([rng.standard_normal(n), rng.standard_normal(n)]) * np.exp(-t * 6.9 / seconds)
    ir[:, : int(0.012 * SR)] = 0
    ir /= np.sqrt((ir**2).sum(axis=1, keepdims=True))
    size = 1 << int(np.ceil(np.log2(x.shape[1] + n)))
    wet = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:, : x.shape[1]]
    return x * (1 - mix) + wet * mix * 1.6


def main(path):
    buf = np.zeros((2, N))

    # ── Part one: 0–30 s, A minor, 80 bpm ──────────────────────────────────────────
    beat = 60 / 80
    drone = tone(midi(33), 30.5, ((1, 1), (2, 0.5), (3, 0.2)), detune=0.002)
    drone = lowpass(drone, 260) * env(len(drone), 2.5, 1.2) * 0.55
    add(buf, 0, drone, 0.9)

    chords = [[57, 60, 64], [53, 57, 60], [50, 53, 57], [52, 56, 59]]  # Am F Dm E
    bar = beat * 4
    for i in range(int(29 / bar) + 1):
        add(buf, i * bar, pad(chords[i % 4], bar + 0.8, 0.25), 0.22)

    # Heartbeat on each beat, ticking clock on the off-beats; both thin out in the silence after the blackout.
    t = 0.0
    while t < 29.5:
        quiet = 19.4 <= t < 21.0
        if not quiet:
            add(buf, t, kick(0.3, 0.7), 0.28)
            add(buf, t + 0.18, kick(0.25, 0.5), 0.16)
            add(buf, t + beat / 2, tick(), 0.12, pan=0.35)
        t += beat

    # A falling three-note figure over the data meter draining.
    for k, n in enumerate([76, 74, 72, 71, 69]):
        add(buf, 1.4 + k * 0.9, pluck(n, 1.4), 0.13, pan=-0.2)

    add(buf, 6.25, boom(), 0.85)  # the call drops
    add(buf, 7.0, bell(81, 1.2) * 0.6, 0.14, pan=0.4)  # the "data used up" text
    add(buf, 18.6, power_down(), 0.7)  # power sags …
    add(buf, 19.4, boom(2.8), 0.7)  # … and goes
    add(buf, 25.2, riser(4.8), 0.45)  # "you still run out" into the brand

    # ── Part two: 30–72 s, C major, 100 bpm ───────────────────────────────────────
    beat = 60 / 100
    bar = beat * 4
    start = 30.0
    add(buf, start, boom(3.0), 0.55)
    add(buf, start, bell(84, 3.2), 0.16)

    prog = [[48, 55, 60, 64], [43, 55, 59, 62], [45, 57, 60, 64], [41, 53, 57, 60]]  # C G Am F
    arps = [[72, 76, 79, 76], [71, 74, 79, 74], [72, 76, 81, 76], [69, 72, 77, 72]]
    end = 68.0
    i = 0
    while start + i * bar < end:
        at = start + i * bar
        add(buf, at, pad(prog[i % 4][1:], bar + 1.0, 0.4), 0.2)
        bassn = prog[i % 4][0]
        add(buf, at, lowpass(tone(midi(bassn - 12), bar, ((1, 1), (2, 0.3))), 400) * env(int(bar * SR), 0.02, 0.3), 0.3)
        if at >= 37.2:  # the arpeggio comes in with the app demo
            for s in range(8):
                add(buf, at + s * beat / 2, pluck(arps[i % 4][s % 4]), 0.1, pan=0.3 if s % 2 else -0.3)
        if at >= 38.4:
            for b in range(4):
                add(buf, at + b * beat, kick(0.3, 0.8), 0.32)
                add(buf, at + b * beat + beat / 2, hat(), 0.05, pan=0.5)
        i += 1

    # Each bill that pays in the app demo, then in the split screen.
    for k, at in enumerate([50.0, 51.1, 52.2]):
        add(buf, at + 0.05, bell(88 + [0, 3, 7][k], 1.4), 0.09, pan=-0.3)
    for k, at in enumerate([56.4, 57.4, 58.4]):
        add(buf, at, bell([88, 91, 96][k], 2.2), 0.13, pan=[-0.4, 0.4, 0.0][k])

    # Ending: a held C chord under the end card.
    add(buf, end - 0.6, pad([48, 55, 60, 64, 67], 72 - end + 0.6, 0.3), 0.32)
    add(buf, 65.2, bell(84, 3.5), 0.12)

    buf = reverb(buf)
    t = np.arange(N) / SR
    fade = np.clip((DUR - t) / 3.5, 0, 1) * np.clip(t / 0.4, 0, 1)
    lift = 1 + 0.6 * np.clip((t - 29.8) / 0.2, 0, 1)  # the bright half sits about 4 dB above the tense one
    buf *= fade * lift
    buf /= np.max(np.abs(buf)) / 0.89  # about -1 dBFS

    pcm = (buf.T * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "out/music.wav")
