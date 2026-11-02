#!/usr/bin/env python3
"""Build TK-16, a compact CC0 General MIDI SoundFont, in three house styles.

The bank is authored from deterministic mathematical waveforms; no recorded
samples or third-party tables are read.  Sixteen melodic timbres are built as
band-limited single-cycle loops (three pitch zones each, so high notes do not
alias) and shaped by SoundFont envelopes, a filter sweep and vibrato.  All 128
General MIDI programs map onto those sixteen timbres by instrument family, and
the bank-128 kit is synthesised from sweeps, noise and fixed metallic partials.

Three profiles share the sixteen timbres and the kit and differ in rate, loop
resolution, bit depth, brightness, attack timing and drive: Classic RPG (the
default, `TK-16.sf2`), Whimsical and Arcade.  Timbre targets (attack time, brightness, decay class, vibrato) were chosen by
listening to and coarsely measuring commercial 16-bit-era sample sets.  No
waveform, envelope table or sample data from them is read or embedded here.
Keep this source beside the provenance manifest so every sample stays
reproducible and auditable.
"""
from __future__ import annotations

import hashlib
import json
import math
import struct
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOUNDFONTS = ROOT / "media" / "soundfonts"
PROVENANCE = ROOT / "tools" / "licences" / "tk16-provenance.json"
TAU = 2.0 * math.pi

# SoundFont generator ids used below.
G_VIB_PITCH, G_MOD_PITCH, G_FC, G_Q, G_MOD_FC = 6, 7, 8, 9, 11
G_VIB_DELAY, G_VIB_FREQ = 23, 24
G_MOD_A, G_MOD_D, G_MOD_S, G_MOD_R = 26, 28, 29, 30
G_A, G_H, G_D, G_S, G_R = 34, 35, 36, 37, 38
G_INSTRUMENT, G_KEYS, G_ATTEN, G_PAN = 41, 43, 48, 17
G_COARSE, G_FINE, G_SAMPLE, G_MODE, G_SCALE, G_EXCL = 51, 52, 53, 54, 56, 57


def tc(seconds: float) -> int:
    """Seconds to SoundFont timecents."""
    return int(round(1200.0 * math.log2(max(seconds, 0.001))))


def fc(hz: float) -> int:
    """Hertz to SoundFont absolute cents."""
    return int(round(1200.0 * math.log2(hz / 8.176)))


def key_hz(key: int) -> float:
    return 440.0 * 2.0 ** ((key - 69) / 12.0)


# --- melodic spectra ------------------------------------------------------
# A spectrum is f(f0, limit) -> [(ratio, amplitude, phase)] with ratio < limit.
# A ratio may be a multiple of 1/K for a loop of K cycles (bells use K = 3).

def harmonics(f0, limit, weight, phase=0.0):
    return [(float(n), weight(n, f0), phase) for n in range(1, int(limit))]


def formant(hz, centre, width):
    return math.exp(-(((hz - centre) / width) ** 2))


SPECTRA = {
    "piano": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -1.35 * (0.3 if n % 7 == 0 else 1.0) * (1.0 if n < 4 else 0.8)),
    "bright": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -0.95),
    "ep": lambda f0, lim: [(1.0, 1.0, 0.0), (2.0, 0.28, 0.0), (3.0, 0.05, 0.0), (7.0, 0.07, 0.0), (9.0, 0.03, 0.0)],
    "organ": lambda f0, lim: [(float(r), a, 0.0) for r, a in ((1, 1.0), (2, 0.8), (3, 0.5), (4, 0.45), (6, 0.25), (8, 0.18)) if r < lim],
    "guitar": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -1.1 * (0.5 if n % 5 == 0 else 1.0)),
    "bass": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -1.7 if n < 12 else 0.0),
    "strings": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -1.05 * (1.0 + 0.4 * formant(n * f, 2200.0, 1200.0))),
    "choir": lambda f0, lim: harmonics(f0, lim, lambda n, f: 0.04 + formant(n * f, 700.0, 280.0) + 0.55 * formant(n * f, 1150.0, 340.0) + 0.2 * formant(n * f, 2600.0, 700.0)),
    "brass": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -0.8 * (1.0 + formant(n * f, 1400.0, 900.0))),
    "synth": lambda f0, lim: harmonics(f0, lim, lambda n, f: (1.0 / n if n % 2 else 0.0) + (0.6 / n if n % 4 == 2 else 0.0)),
    # The 8/3 and 16/3 partials stay weak: loud, they read as a second note that climbs faster than the tune.
    "bell": lambda f0, lim: [(1.0, 1.0, 0.0), (2.0, 0.35, 0.0), (8.0 / 3.0, 0.12, 0.0), (4.0, 0.15, 0.0), (16.0 / 3.0, 0.06, 0.0), (8.0, 0.04, 0.0)],
    "lead": lambda f0, lim: harmonics(f0, lim, lambda n, f: 1.0 / n),
    "pad": lambda f0, lim: harmonics(f0, lim, lambda n, f: n ** -1.8),
    "pluck": lambda f0, lim: harmonics(f0, lim, lambda n, f: 0.75 ** (n - 1) * (1.0 + (0.5 if n == 4 else 0.0))),
    "flute": lambda f0, lim: [(1.0, 1.0, 0.0), (2.0, 0.14, 0.0), (3.0, 0.05, 0.0), (4.0, 0.02, 0.0)],
}

# name, spectrum, loop cycles K, volume env (attack, decay, sustain cB, release),
# filter (low hz, sweep cents, mod attack, mod decay, mod sustain per mille, Q cB),
# vibrato (delay s, rate hz, cents), wide chorus pair, attenuation cB
INSTRUMENTS = [
    ("TK Piano", "piano", 1, (0.004, 5.0, 900, 0.35), (1800, 3600, 0.002, 1.4, 120, 0), (0, 0, 0), False, 103),
    ("TK Bright", "bright", 1, (0.003, 3.2, 800, 0.3), (2600, 3200, 0.002, 0.9, 220, 0), (0, 0, 0), False, 62),
    ("TK EP", "ep", 1, (0.003, 2.2, 600, 0.35), (3200, 1200, 0.002, 0.7, 500, 0), (0, 0, 0), False, 74),
    ("TK Organ", "organ", 1, (0.012, 0.1, 0, 0.08), (9000, 0, 0.01, 0.1, 1000, 0), (0.2, 5.2, 4), False, 129),
    ("TK Guitar", "guitar", 1, (0.002, 1.8, 1000, 0.28), (1400, 4200, 0.002, 0.45, 180, 0), (0, 0, 0), False, 73),
    ("TK Bass", "bass", 1, (0.003, 1.2, 600, 0.2), (700, 2400, 0.002, 0.3, 300, 0), (0, 0, 0), False, 49),
    ("TK Strings", "strings", 1, (0.22, 0.3, 0, 0.5), (2600, 1500, 0.35, 0.5, 700, 0), (0.35, 5.2, 12), True, 157),
    ("TK Choir", "choir", 1, (0.16, 0.3, 0, 0.45), (5200, 0, 0.1, 0.1, 1000, 0), (0.3, 5.0, 14), True, 113),
    ("TK Brass", "brass", 1, (0.045, 0.3, 120, 0.2), (1100, 4200, 0.08, 0.3, 450, 0), (0.25, 5.8, 6), False, 5),
    ("TK Synth", "synth", 1, (0.004, 0.2, 80, 0.12), (4200, 0, 0.01, 0.1, 1000, 0), (0, 0, 0), True, 109),
    ("TK Bell", "bell", 3, (0.002, 4.0, 1000, 0.5), (900, 3600, 0.002, 0.35, 0, 0), (0, 0, 0), False, 84),
    ("TK Lead", "lead", 1, (0.015, 0.2, 40, 0.14), (3800, 1200, 0.02, 0.4, 600, 0), (0.18, 5.6, 22), True, 119),
    ("TK Pad", "pad", 1, (0.6, 0.5, 0, 1.1), (1800, 2400, 0.8, 1.0, 500, 0), (0.5, 4.2, 7), True, 164),
    ("TK Pluck", "pluck", 1, (0.002, 0.9, 1100, 0.18), (3000, 3000, 0.002, 0.3, 120, 0), (0, 0, 0), False, 6),
    ("TK Flute", "flute", 1, (0.09, 0.2, 0, 0.18), (6000, 0, 0.05, 0.1, 1000, 0), (0.28, 5.0, 9), False, 166),
    ("TK SFX", "noise", 1, (0.02, 0.2, 0, 0.4), (2400, 3000, 0.4, 1.0, 400, 80), (0, 0, 0), False, 85),
]

# General MIDI program -> TK-16 instrument index, by family.
GM_MAP = (
    [0, 1, 2, 1, 2, 2, 13, 13]            # 0-7 pianos, harpsichord, clavi
    + [10, 10, 10, 10, 13, 13, 10, 13]    # 8-15 chromatic percussion
    + [3] * 8                             # 16-23 organs, accordion
    + [4] * 8                             # 24-31 guitars
    + [5] * 8                             # 32-39 basses
    + [6, 6, 6, 6, 6, 13, 13, 5]          # 40-47 strings, pizzicato, harp, timpani
    + [6, 6, 6, 6, 7, 7, 7, 8]            # 48-55 ensembles, choir, orchestra hit
    + [8] * 8                             # 56-63 brass
    + [8, 8, 8, 8, 14, 14, 14, 14]        # 64-71 reeds
    + [14] * 8                            # 72-79 pipes
    + [9, 9, 11, 11, 11, 11, 11, 11]      # 80-87 synth leads
    + [12] * 8                            # 88-95 synth pads
    + [12, 15, 10, 12, 12, 12, 12, 15]    # 96-103 synth effects
    + [13, 13, 13, 13, 10, 14, 6, 14]     # 104-111 ethnic
    + [10, 13, 10, 13, 5, 5, 9, 15]       # 112-119 percussive
    + [15] * 8                            # 120-127 sound effects
)
assert len(GM_MAP) == 128


class Lcg:
    def __init__(self, seed: int) -> None:
        self.state = seed

    def next(self) -> float:
        self.state = (self.state * 1103515245 + 12345) & 0x7FFFFFFF
        return self.state / 0x3FFFFFFF - 1.0


class Lfsr:
    """15-bit linear-feedback shift register, modelled on the SNES DSP noise source.

    Feedback is bit 0 XOR bit 1 into bit 14 as the register shifts right, so the
    sequence repeats every 2**15 - 1 = 32,767 steps, the short metallic
    repetition heard in console percussion.
    """

    def __init__(self, seed: int) -> None:
        self.state = (seed % 0x7FFF) or 1

    def next(self) -> float:
        feedback = (self.state ^ (self.state >> 1)) & 1
        self.state = (self.state >> 1) | (feedback << 14)
        word = (self.state << 1) & 0xFFFF
        return (word - 0x10000 if word >= 0x8000 else word) / 32768.0


# --- table-driven styles ------------------------------------------------------
# Classic and Whimsical build every timbre from one row of a table: waveform, loop cycles,
# volume envelope (attack, decay, sustain cB, release), static low-pass cutoff, vibrato,
# chorus pair, the rate tier its loop length aims for, attenuation, and optional extras
# ("head": a transient before the loop; "pitch_env": cents of start-up pitch bend).

def sus(fraction: float) -> int:
    """Sustain as a fraction of peak, in SoundFont centibels of attenuation."""
    return int(round(-200.0 * math.log10(max(fraction, 1e-3))))


def pulse(duty: float):
    return lambda n: abs((2.0 / (n * math.pi)) * math.sin(n * math.pi * duty))


def series(weight):
    return lambda f0, lim: [(float(n), weight(n), 0.0) for n in range(1, int(lim)) if abs(weight(n)) > 1e-4]


def saw(n):
    return 1.0 / n


def tri(n):
    return (1.0 / n ** 2) if n % 2 else 0.0


CLASSIC_SPECTRA = {
    "piano": series(lambda n: 0.6 * saw(n) + 0.4 * pulse(0.25)(n)),
    "bright": series(lambda n: 0.5 * saw(n) + 0.5 * pulse(0.25)(n)),
    "ep": series(lambda n: tri(n) * 3 + (0.5 if n == 2 else 0.0)),
    "guitar": series(lambda n: 0.5 * pulse(0.2)(n) + 0.5 * saw(n)),
    "bass": series(tri),
    "strings": series(saw),
    "choir": lambda f0, lim: [(float(n), saw(n), 0.0) for n in range(1, int(lim))] + [(0.5, 0.5, 0.0)],
    "brass": series(lambda n: 0.6 * pulse(0.3)(n) + 0.4 * saw(n)),
    "synth": series(lambda n: (1.0 / n) if n % 2 else 0.0),
    "lead": series(saw),
    "pad": series(lambda n: 0.5 * saw(n) + 0.5 * pulse(0.4)(n)),
    "pluck": series(lambda n: tri(n) + 0.3 * saw(n)),
    "flute": series(lambda n: tri(n) * 4),
}

#            spectrum, cycles, (attack, decay, sustain cB, release), cutoff Hz, vibrato, chorus, tier Hz, attenuation
CLASSIC_TABLE = {
    "TK Piano":   ("piano", 1, (0.003, 1.8, sus(0.08), 0.2), 8500, (0, 0, 0), False, 22050, 43),
    "TK Bright":  ("bright", 1, (0.003, 1.2, sus(0.08), 0.2), 8500, (0, 0, 0), False, 22050, 5),
    "TK EP":      ("ep", 1, (0.002, 0.55, sus(0.0), 0.2), 10000, (0, 0, 0), False, 22050, 0),
    "TK Organ":   ("organ", 1, (0.002, 0.05, 0, 0.1), 7000, (0.2, 5.2, 4), False, 16000, 208),
    "TK Guitar":  ("guitar", 1, (0.001, 0.8, sus(0.0), 0.1), 6500, (0, 0, 0), False, 16000, 0),
    "TK Bass":    ("bass", 1, (0.001, 0.6, sus(0.0), 0.1), 4500, (0, 0, 0), False, 11025, 0),
    "TK Strings": ("strings", 1, (0.15, 0.2, sus(0.82), 0.4), 7500, (0.35, 5.2, 10), True, 22050, 221),
    "TK Choir":   ("choir", 2, (0.25, 0.2, sus(0.8), 0.5), 6000, (0.3, 5.0, 12), True, 16000, 205),
    "TK Brass":   ("brass", 1, (0.06, 0.25, sus(0.72), 0.16), 8000, (0.25, 5.8, 5), False, 22050, 121),
    "TK Synth":   ("synth", 1, (0.002, 0.1, 0, 0.1), 9000, (0, 0, 0), True, 22050, 311),
    "TK Bell":    ("bell", 3, (0.002, 0.7, sus(0.0), 0.2), 8000, (0, 0, 0), False, 16000, 0),
    "TK Lead":    ("lead", 1, (0.002, 0.1, 0, 0.1), 9000, (0.18, 5.6, 18), True, 22050, 244),
    "TK Pad":     ("pad", 1, (0.8, 0.5, sus(0.85), 0.8), 5500, (0.5, 4.2, 6), True, 16000, 185),
    "TK Pluck":   ("pluck", 1, (0.001, 0.8, sus(0.0), 0.1), 6500, (0, 0, 0), False, 16000, 9),
    "TK Flute":   ("flute", 1, (0.04, 0.05, sus(0.95), 0.1), 6750, (0.28, 5.0, 8), False, 16000, 270),
    "TK SFX":     ("noise", 1, (0.02, 0.2, 0, 0.4), 2400, (0, 0, 0), False, 16000, 174),
}

# Whimsical: the classic table with rounded mallets, a quirky 33% pulse reed, a chiffy flute, a bouncy
# pizzicato bass and floaty pad/bell envelopes; releases stay under 120 ms on the melody voices.
WHIMSICAL_SPECTRA = {
    **CLASSIC_SPECTRA,
    "mallet": series(lambda n: 1.0 if n == 1 else 0.0),
    "sine": series(lambda n: 1.0 if n == 1 else 0.0),
    "tack": series(pulse(0.3)),
    "tackb": series(pulse(0.2)),
    "pulse12": series(pulse(0.12)),
    "pulse15": series(pulse(0.15)),
    "pulse25": series(pulse(0.25)),
}
PUFFED = (0.015, 0.12, sus(0.85), 0.08)
WHIMSICAL_TABLE = {
    **CLASSIC_TABLE,
    # A worn parlor piano: two pulse waves a few cents apart, so the beating never settles.
    "TK Piano":  ("tack", 1, (0.0, 0.9, sus(0.05), 0.12), 8500, (0, 0, 0), True, 22050, 43, {"detune": 3}),
    "TK Bright": ("tackb", 1, (0.0, 0.9, sus(0.05), 0.12), 9000, (0, 0, 0), True, 22050, 5, {"detune": 4}),
    # A toy marimba: sine with a fast-fading octave and a 16-frame strike.
    "TK Pluck":  ("mallet", 1, (0.0, 0.22, sus(0.0), 0.06), 9000, (0, 0, 0), False, 22050, 9, {"head": ("mallet", 0.14)}),
    # A rubber bass: round triangle that bounces down from three semitones above in 20 ms.
    "TK Bass":   ("bass", 1, (0.0, 0.38, sus(0.1), 0.04), 4500, (0, 0, 0), False, 11025, 0, {"pitch_env": (300, 0.02)}),
    # A kazoo / duck reed: 12% duty on the strike, 25% for the body, scooping up two semitones in 30 ms.
    "TK Synth":  ("pulse25", 1, (0.01, 0.08, sus(0.9), 0.06), 6500, (0, 0, 0), False, 22050, 311,
                  {"head": ("alt", 0.03, "pulse12"), "pitch_env": (-200, 0.03)}),
    # A boing / jaw-harp lead: 15% pulse that starts an octave up and springs down in 40 ms, fluttering at 12 Hz.
    "TK Lead":   ("pulse15", 1, PUFFED, 7500, (0, 0, 0), False, 22050, 244, {"head": ("boing", 0.2), "pitch_env": (1200, 0.04)}),
    # A chirp whistle: triangle with a breath, steady for 300 ms and then a nervous 7 Hz vibrato.
    "TK Flute":  ("flute", 1, (0.02, 0.05, sus(0.95), 0.07), 6750, (0.3, 7.0, 20), False, 16000, 270, {"head": ("chiff", 0.035)}),
    # Brass, saxes and voices scoop up into the note from two semitones below in 35 ms.
    "TK Brass":  (*CLASSIC_TABLE["TK Brass"], {"pitch_env": (-200, 0.035)}),
    "TK Choir":  (*CLASSIC_TABLE["TK Choir"], {"pitch_env": (-200, 0.035)}),
    "TK Bell":   ("bell", 3, (0.08, 1.2, sus(0.4), 0.45), 8000, (0, 0, 0), False, 16000, 0),
    "TK Pad":    ("pad", 1, (0.08, 1.2, sus(0.4), 0.45), 5500, (0.5, 4.2, 6), True, 16000, 185),
    # A water-drop boop: a pure sine that falls a octave and a half in about 35 ms and is gone.
    "TK SFX":    ("sine", 1, (0.0, 0.12, 0, 0.02), 9000, (0, 0, 0), False, 16000, 174, {"pitch_env": (1800, 0.035)}),
}
# Attenuation added to the table value so each Whimsical voice sits at the classic loudness.
WHIMSICAL_ATTEN_DELTA = {"TK Piano": 59, "TK Bright": 66, "TK Bass": -20, "TK Synth": -144, "TK Bell": 160, "TK Lead": -102, "TK Pad": -17, "TK Pluck": -259, "TK SFX": 84}
for _name, _delta in WHIMSICAL_ATTEN_DELTA.items():
    _row = list(WHIMSICAL_TABLE[_name])
    _row[7] = max(0, _row[7] + _delta)
    WHIMSICAL_TABLE[_name] = tuple(_row)
# Whimsical reeds, accordion and harmonica take the pulse reed.
WHIMSICAL_GM = {68: 9, 69: 9, 70: 9, 71: 9, 21: 9, 22: 9}


def fm_wave(ratio: float, index: float):
    """Two-operator phase modulation, baked as one loop: sin(w t + index * sin(ratio * w t))."""
    return lambda length, period: [math.sin(TAU * i / period + index * math.sin(TAU * ratio * i / period)) for i in range(length)]


def feedback_fm_wave(feedback: float, gain: float):
    """x[n] = sin(w n + feedback * x[n-1]), clipped at gain, run at the loop's own (low) sample rate.

    At this rate the recursion settles into a periodic orbit within a few cycles (checked for every loop size),
    so the loop joins exactly; its aliased, flat-topped edge is the point.
    """
    def wave(length, period):
        x = 0.0
        for n in range(200 * period):
            x = math.sin(TAU * (n % period) / period + feedback * x)
        out = []
        for i in range(length):
            x = math.sin(TAU * (i % period) / period + feedback * x)
            out.append(max(-1.0, min(1.0, gain * x)))
        return out
    return wave


ARCADE_WAVES = {
    "fmbass": fm_wave(2.0, 0.4),
    "fmbell": fm_wave(3.5, 1.2),
    "fmfb": feedback_fm_wave(1.8, 1.4),
}
ARCADE_SPECTRA = {
    **CLASSIC_SPECTRA,
    "pulse20": series(pulse(0.2)),
    # An open power chord: a saw, a saw a fifth up (3/2, two cycles per loop) and a saw an octave up.
    "chord": lambda f0, lim: [(r * n, 1.0 / (3.0 * n), 0.0) for r in (1.0, 1.5, 2.0) for n in range(1, int(lim)) if r * n < lim],
}


def _arcade_table():
    table = {}
    for name, row in CLASSIC_TABLE.items():
        spectrum, cycles, venv, cutoff, vib, wide, tier, atten, *rest = row
        # Brighter everywhere (+700 cents) with half the vibrato depth.
        table[name] = (spectrum, cycles, venv, int(cutoff * 1.5), (vib[0], vib[1], int(round(vib[2] * 0.5))), wide, tier, atten, *rest)
    fast = {  # snappier entries
        "TK Strings": (0.04, 0.2, sus(0.82), 0.3), "TK Pad": (0.12, 0.5, sus(0.85), 0.5), "TK Choir": (0.06, 0.2, sus(0.8), 0.3),
        "TK Flute": (0.03, 0.05, sus(0.95), 0.12),
    }
    for name, venv in fast.items():
        row = list(table[name])
        row[2] = venv
        table[name] = tuple(row)
    # 2-op FM slap bass: modulation index falls from 3.5 to 0.4 in the first 40 ms, with a +5 semitone drop in 15 ms.
    table["TK Bass"] = ("fmbass", 1, (0.0, 0.22, sus(0.15), 0.045), 9000, (0, 0, 0), False, 4186, 0,
                        {"head": ("fm", 0.04, {"ratio": 2.0, "i0": 3.5, "i1": 0.4, "tau": 0.013}), "pitch_env": (500, 0.015)})
    # Biting guitar: clipped 1:1 feedback phase modulation, a 32-frame pick scratch, and a 1 semitone scoop in 10 ms.
    table["TK Guitar"] = ("fmfb", 1, (0.002, 0.12, sus(0.9), 0.06), 9000, (0, 0, 0), False, 16000, 0,
                          {"head": ("pick", 32), "pitch_env": (-100, 0.01)})
    table["TK Lead"] = ("fmfb", 1, (0.002, 0.12, sus(0.9), 0.06), 9000, (0.18, 5.6, 9), True, 22050, 0, {"pitch_env": (-100, 0.01)})
    # Brass stab: 20% pulse that rips down from an octave above in 22 ms.
    table["TK Brass"] = ("pulse20", 1, (0.0, 0.18, sus(0.55), 0.05), 7500, (0, 0, 0), False, 22050, 0, {"pitch_env": (1200, 0.022)})
    # Action power chord on the organ slot, with a 32-frame saturated strike.
    table["TK Organ"] = ("chord", 2, (0.0, 0.35, sus(0.7), 0.08), 7500, (0, 0, 0), False, 16000, 0, {"head": ("slap", 32)})
    # FM chime: a 1:3.5 bell whose index starts hot and settles.
    table["TK Bell"] = ("fmbell", 2, (0.0, 0.5, sus(0.0), 0.1), 10000, (0, 0, 0), False, 16000, 0,
                        {"head": ("fm", 0.06, {"ratio": 3.5, "i0": 3.5, "i1": 1.2, "tau": 0.02})})
    return table


# Attenuation added to the classic value so the clipped and pulse voices sit at the classic loudness.
ARCADE_ATTEN_DELTA = {"TK Organ": 44, "TK Guitar": 360, "TK Bass": 7, "TK Strings": 5, "TK Choir": 13, "TK Brass": 60, "TK Bell": -28, "TK Lead": 290, "TK Pad": 75, "TK SFX": -8}


def _arcade_leveled():
    table = _arcade_table()
    for name, delta in ARCADE_ATTEN_DELTA.items():
        row = list(table[name])
        row[7] = max(0, row[7] + delta)
        table[name] = tuple(row)
    return table


ARCADE_TABLE = _arcade_leveled()
# Acoustic guitars pluck; electric and distorted guitars take the clipped lead.
ARCADE_GM = {24: 13, 25: 13, 26: 13, 27: 13, 28: 13}


def tier_zones(zones, tier_hz):
    """Pick each zone's loop length so its sample rate lands nearest the family's rate tier."""
    out = []
    for lo, hi, _, *_r in zones:
        root = (lo + hi) // 2 if hi < 127 else 84
        want = tier_hz / key_hz(min(root, 100))
        out.append((lo, hi, min((16, 32, 64, 128, 256), key=lambda c: abs(math.log2(c / want)))))
    return out


# --- house styles ---------------------------------------------------------
# rate: percussion sample rate; zones: (low key, high key, loop frames), with fewer
# harmonics higher up so transposed samples do not alias into a second, faster pitch;
# bits/dither: output word length and noise; filter_shift: cents added to every
# filter; venv: per-timbre volume-envelope overrides (attack, decay, sustain cB,
# release); drive: tanh saturation per spectrum; drums: kit shaping.
PROFILES = {
    "classic": {
        "file": "TK-16.sf2",
        "title": "TK-16 Classic RPG",
        "feel": "textbook chip table: saw/pulse blends, a static low-pass and a standard envelope per family, loop lengths aimed at rate tiers",
        "rate": 24000,
        "zones": ((0, 47, 256), (48, 71, 128), (72, 83, 64), (84, 95, 32), (96, 127, 16)),
        "table": CLASSIC_TABLE, "spectra": CLASSIC_SPECTRA, "tiers": True,
        "bits": 12, "dither": 0.0, "filter_shift": 0, "vibrato_scale": 1.0,
        "venv": {},
        "drive": {},
        "drums": {"tom_len": 0.45, "tom_decay": 0.15, "snare_len": 0.24, "snare_decay": 0.075, "kick_decay": 0.13, "kick_click": 0.25,
                  "kick_start": 40.0, "kick_sweep": 80.0, "kick_sweep_tau": 0.03, "crash_len": 1.5, "crash_decay": 0.45, "chat_decay": 0.02, "drive": {}},
    },
    "whimsical": {
        "file": "TK-16-Whimsical.sf2",
        "title": "TK-16 Whimsical",
        "feel": "the classic table with rounded mallets, a 33% pulse reed, a chiffy flute, a bouncy pizzicato bass and floaty pad and bell",
        "rate": 24000,
        "zones": ((0, 47, 128), (48, 71, 64), (72, 83, 32), (84, 127, 16)),
        "table": WHIMSICAL_TABLE, "spectra": WHIMSICAL_SPECTRA, "tiers": False, "gm_overrides": WHIMSICAL_GM,
        # Toy percussion in place of the rock kit on the sounds that carry the beat.
        "kit_swap": {"snare": "toy_snare", "clap": "toy_clap", "chat": "shaker", "cowbell": "agogo_bell", "claves": "pip"},
        "bits": 12, "dither": 0.0, "filter_shift": 0, "vibrato_scale": 1.0,
        "venv": {},
        "drive": {},
        "drums": {"tom_len": 0.45, "tom_decay": 0.15, "snare_len": 0.24, "snare_decay": 0.075, "kick_decay": 0.13, "kick_click": 0.25,
                  "kick_start": 40.0, "kick_sweep": 80.0, "kick_sweep_tau": 0.03, "crash_len": 1.5, "crash_decay": 0.45, "chat_decay": 0.02, "drive": {}},
    },
    "arcade": {
        "file": "TK-16-Arcade.sf2",
        "title": "TK-16 Arcade",
        "feel": "a cabinet board: 2-operator FM bass and chime, feedback-FM guitar and lead, a ripping pulse brass, a power chord, a clipped kick and a gated crack",
        "rate": 24000,
        # (low key, high key, loop frames, root key): a 4.2 kHz bass zone rooted at C2, then 64, 32 and 16 frame loops.
        "zones": ((0, 47, 64, 36), (48, 71, 64, 60), (72, 83, 32, 72), (84, 127, 16, 84)),
        "table": ARCADE_TABLE, "spectra": ARCADE_SPECTRA, "waves": ARCADE_WAVES, "tiers": False, "gm_overrides": ARCADE_GM,
        "kit_swap": {"chat": "arc_hat", "ohat": "arc_ohat", "crash": "arc_crash"},
        "bits": 12, "dither": 0.3, "filter_shift": 0, "vibrato_scale": 1.0,
        "venv": {},
        "drive": {},
        "drums": {"tom_len": 0.55, "tom_decay": 0.4, "snare_len": 0.16, "snare_decay": 0.12, "snare_gate": 0.12, "snare_tones": (180.0, 330.0),
                  "kick_decay": 0.1, "kick_click": 0.3, "kick_start": 50.0, "kick_sweep": 190.0, "kick_sweep_tau": 0.01, "kick_clip": 0.8,
                  "drive": {"*": 1.4, "kick": 1.0, "snare": 1.4}},
    },
}


def to_int16(values, peak=0.82, reference_from=0):
    # The level follows the loop (from `reference_from`), so a transient head may exceed it and clip.
    top = max(abs(v) for v in values[reference_from:]) or 1.0
    scale = peak * 32767.0 / top
    return [max(-32768, min(32767, int(round(v * scale)))) for v in values]


def finish(values, profile, peak=0.82, drive=0.0, reference_from=0):
    """Normalise, optionally saturate, then reduce to the profile's word length."""
    ints = to_int16(values, peak, reference_from)
    if drive > 1.0:
        ints = to_int16([math.tanh(drive * v / 32768.0) for v in ints], peak, reference_from)
    bits = profile["bits"]
    if bits >= 16:
        return ints
    step = 1 << (16 - bits)
    rng = Lcg(0x5EED)
    out = []
    for sample in ints:
        noise = rng.next() * step * 0.5 * profile["dither"] if profile["dither"] else 0.0
        out.append(max(-32768, min(32767, int(round((sample + noise) / step)) * step)))
    return out


def loop_cycle(spectrum: str, f0: float, period: int, cycles: int, profile, rate: int = 0, head=None) -> tuple[list[int], int]:
    """One sample: an optional transient head, then a loop of whole cycles. Returns (frames, head length)."""
    # Whole cycles, repeated until the loop is a multiple of 16 frames (one BRR block).
    length = period * cycles
    length *= 16 // math.gcd(16, length)
    drive = profile["drive"].get(spectrum, 0.0)
    if spectrum == "noise":
        rng = Lfsr(0x544B31 + period)
        raw = [rng.next() for _ in range(length)]
        smooth = [0.0] * length
        last = 0.0
        for index in range(length * 2):  # two passes so the loop wraps without a seam
            last = 0.55 * last + 0.45 * raw[index % length]
            if index >= length:
                smooth[index - length] = last
        return finish(smooth, profile, drive=drive), 0
    spectra = profile.get("spectra", {})
    direct = profile.get("waves", {}).get(spectrum)
    if direct is not None:
        loop_values = direct(length, period)
        partials = []

        def wave(i: int) -> float:
            return loop_values[i % length]
    else:
        partials = (spectra.get(spectrum) or SPECTRA[spectrum])(f0, period / 2.0)
        # Every partial must complete a whole number of cycles in the loop, so the join is exact.
        partials = [(r, a, p) for r, a, p in partials if r < period / 2.0 and abs(r * cycles - round(r * cycles)) < 1e-9]

        def wave(i: int) -> float:
            return sum(a * math.sin(TAU * r * i / period + p) for r, a, p in partials)

    lead: list[float] = []
    if head is not None:
        kind, seconds, *arg = head
        # A whole number of fundamental cycles, so the loop continues in phase.
        if kind in ("slap", "pick"):
            lead_length = (int(math.ceil(seconds / period)) if kind == "slap" else int(seconds))
            lead_length = lead_length * period if kind == "slap" else lead_length
        elif kind == "fm":
            unit = period * cycles
            lead_length = int(math.ceil(seconds * f0 / cycles)) * unit
        else:
            lead_length = int(math.ceil(seconds * f0)) * period
        rng = Lfsr(0x4845 + period)
        alt = None
        if kind == "alt":
            alt = [(r, a, p) for r, a, p in (spectra.get(arg[0]) or SPECTRA[arg[0]])(f0, period / 2.0) if r < period / 2.0 and abs(r * cycles - round(r * cycles)) < 1e-9]
        warp = 0.0
        previous = 0.0
        flutter = [0.0] * lead_length
        if kind == "boing":
            # A 12 Hz flutter of about +-30 cents that dies away over the head, baked in as phase modulation.
            position = 0.0
            for i in range(lead_length):
                t = i / rate
                flutter[i] = position
                position += 1.0 + 0.0174 * math.sin(TAU * 12.0 * t) * math.exp(-t / 0.05)
            warp = (position - lead_length) / lead_length
        for i in range(lead_length):
            t = i / rate
            if kind == "pick":
                # A metallic pick scratch: 32 frames of high-passed shift-register noise.
                sample = rng.next()
                value = 0.9 * (sample - previous) * (1.0 - i / lead_length)
                previous = sample
            elif kind == "fm":
                cfg = arg[0]
                index = cfg["i1"] + (cfg["i0"] - cfg["i1"]) * math.exp(-t / cfg["tau"])
                value = math.sin(TAU * i / period + index * math.sin(TAU * cfg["ratio"] * i / period))
            elif kind == "boing":
                u = flutter[i] - warp * i  # ends exactly on a whole cycle so the loop joins in phase
                value = sum(a * math.sin(TAU * r * u / period + p) for r, a, p in partials)
            elif alt is not None:
                value = sum(a * math.sin(TAU * r * i / period + p) for r, a, p in alt)
            else:
                value = wave(i)
            if kind == "mallet":
                # A rounded mallet: an octave-up partial that drops out fast, and a 16-frame strike.
                value += 0.35 * math.sin(TAU * 2.0 * i / period) * math.exp(-t / 0.04)
                if i < 16:
                    value += 0.3 * rng.next() * (1.0 - i / 16.0)
            elif kind == "slap":
                # An unpitched, clipped thumb slap over the first 48 frames.
                if i < seconds:
                    value += max(-1.0, min(1.0, 3.0 * rng.next())) * (1.0 - i / seconds)
            elif kind == "chiff":
                # A breath of shift-register noise, about -12 dB, fading out over the first 35 ms.
                value += 0.25 * rng.next() * max(0.0, 1.0 - t / seconds)
            lead.append(value)
    body = lead + [wave(i) for i in range(length)]
    return finish(body, profile, drive=drive, reference_from=len(lead)), len(lead)


# --- percussion -----------------------------------------------------------

def metallic(t: float) -> float:
    """Six fixed square partials, the usual cymbal/hat colour."""
    total = 0.0
    for ratio in (2.0, 3.0, 4.16, 5.43, 6.79, 8.21):
        total += 1.0 if math.sin(TAU * 205.3 * ratio * t) >= 0.0 else -1.0
    return total / 6.0


def square(hz: float, t: float) -> float:
    return 1.0 if math.sin(TAU * hz * t) >= 0.0 else -1.0


def noise_hp(rng: Lcg, count: int) -> list[float]:
    last = 0.0
    out = []
    for _ in range(count):
        value = rng.next()
        out.append(value - last)
        last = value
    return out


# Length in seconds of each one-shot kind; tom, snare and kick lengths come from the profile.
DRUM_SECONDS = {
    "kick": 0.30, "kick2": 0.22, "snare": 0.24, "snare2": 0.20, "rim": 0.05, "clap": 0.26, "chat": 0.07, "phat": 0.09,
    "ohat": 0.30, "tom": 0.45, "crash": 0.75, "chinese": 0.60, "splash": 0.32, "ride": 0.55, "ridebell": 0.50,
    "cowbell": 0.30, "tamb": 0.22, "vibraslap": 0.60, "bongo": 0.18, "conga_m": 0.12, "conga_o": 0.30,
    "timbale": 0.30, "agogo": 0.35, "cabasa": 0.10, "maracas": 0.07, "whistle_s": 0.15, "whistle_l": 0.50,
    "guiro_s": 0.12, "guiro_l": 0.40, "claves": 0.07, "block": 0.10, "cuica_m": 0.10, "cuica_o": 0.30,
    "tri_m": 0.15, "tri_o": 0.70,
    "arc_hat": 0.09, "arc_ohat": 0.20, "arc_crash": 0.80,
    "toy_snare": 0.12, "toy_clap": 0.09, "shaker": 0.12, "agogo_bell": 0.35, "pip": 0.10,
}


def bandpass(samples, rate: int, centre: float, q: float):
    """RBJ biquad band-pass (constant 0 dB peak gain)."""
    w = TAU * centre / rate
    alpha = math.sin(w) / (2.0 * q)
    b0, b2, a0, a1, a2 = alpha, -alpha, 1.0 + alpha, -2.0 * math.cos(w), 1.0 - alpha
    x1 = x2 = y1 = y2 = 0.0
    out = []
    for x in samples:
        y = (b0 * x + b2 * x2 - a1 * y1 - a2 * y2) / a0
        out.append(y)
        x2, x1, y2, y1 = x1, x, y1, y
    return out


def drum(kind: str, profile) -> list[int]:
    dp = profile["drums"]
    rate = profile["rate"]
    seconds = {"tom": dp["tom_len"], "snare": dp["snare_len"], "crash": dp.get("crash_len", DRUM_SECONDS["crash"])}.get(kind, DRUM_SECONDS[kind])
    count = int(seconds * rate)
    rng = Lfsr(0x5442 + sum(map(ord, kind)))
    hp = noise_hp(rng, count)
    if kind == "toy_clap":
        hp = bandpass(hp, rate, 1200.0, 1.5)
    out = []
    phase = 0.0
    for i in range(count):
        t = i / rate
        if kind == "kick":
            phase += TAU * (dp.get("kick_start", 46.0) + dp.get("kick_sweep", 120.0) * math.exp(-t / dp.get("kick_sweep_tau", 0.028))) / rate
            v = math.sin(phase) * math.exp(-t / dp["kick_decay"]) + dp["kick_click"] * hp[i] * math.exp(-t / 0.003)
            if dp.get("kick_clip"):
                v = max(-dp["kick_clip"], min(dp["kick_clip"], v))  # flatten the top for a chest-hitting thud
        elif kind == "kick2":
            cabinet = bool(dp.get("kick_clip"))  # the cabinet kit's lighter, snappier partner to the main kick
            phase += TAU * ((75.0 + 150.0 * math.exp(-t / 0.015)) if cabinet else (58.0 + 90.0 * math.exp(-t / 0.02))) / rate
            v = math.sin(phase) * math.exp(-t / (0.06 if cabinet else 0.085)) + 0.18 * hp[i] * math.exp(-t / 0.002)
            if cabinet:
                v = max(-0.9, min(0.9, v))
        elif kind == "snare":
            if dp.get("snare_tones"):
                # A gated crack: two tones and a shift-register noise burst that stops dead.
                low, high = dp["snare_tones"]
                v = 0.35 * (math.sin(TAU * low * t) + math.sin(TAU * high * t)) * math.exp(-t / 0.05) + 0.6 * hp[i] * (1.0 if t < dp["snare_gate"] else 0.0)
            elif dp.get("snare_gate"):
                # Half a triangle pop at 220 Hz, half shift-register noise, cut off abruptly.
                triangle = 4.0 * abs((220.0 * t) % 1.0 - 0.5) - 1.0
                v = 0.5 * triangle * math.exp(-t / 0.04) + 0.5 * hp[i] * (1.0 if t < dp["snare_gate"] else 0.0)
            else:
                v = 0.55 * math.sin(TAU * 185.0 * t) * math.exp(-t / 0.05) + 0.9 * hp[i] * math.exp(-t / dp["snare_decay"])
        elif kind == "snare2":
            v = 0.4 * math.sin(TAU * 235.0 * t) * math.exp(-t / 0.035) + 1.0 * hp[i] * math.exp(-t / 0.055)
        elif kind == "rim":
            v = math.sin(TAU * 1700.0 * t) * math.exp(-t / 0.006) + 0.6 * math.sin(TAU * 480.0 * t) * math.exp(-t / 0.012)
        elif kind == "clap":
            bursts = sum(math.exp(-max(0.0, t - b) / 0.005) for b in (0.0, 0.011, 0.022) if t >= b)
            v = hp[i] * (bursts * 0.5 + 0.8 * math.exp(-t / 0.07) * (1.0 if t > 0.03 else 0.0))
        elif kind == "chat":
            v = (0.6 * metallic(t) + 0.7 * hp[i]) * math.exp(-t / dp.get("chat_decay", 0.014))
        elif kind == "phat":
            v = (0.35 * metallic(t * 0.9) + 0.5 * hp[i]) * math.exp(-t / 0.022)
        elif kind == "ohat":
            v = (0.6 * metallic(t) + 0.7 * hp[i]) * math.exp(-t / 0.085)
        elif kind == "tom":
            phase += TAU * (260.0 * (1.0 + 0.9 * math.exp(-t / 0.022))) / rate
            v = math.sin(phase) * math.exp(-t / dp["tom_decay"]) + 0.2 * hp[i] * math.exp(-t / 0.004)
        elif kind == "crash":
            v = (0.5 * metallic(t) + 0.8 * hp[i]) * math.exp(-t / dp.get("crash_decay", 0.2))
        elif kind == "chinese":
            v = (0.9 * metallic(t * 1.37) + 0.5 * hp[i]) * math.exp(-t / 0.17)
        elif kind == "splash":
            v = (0.6 * metallic(t * 1.2) + 0.8 * hp[i]) * math.exp(-t / 0.075)
        elif kind == "ride":
            v = 0.7 * metallic(t) * math.exp(-t / 0.25) + 0.4 * math.sin(TAU * 3100.0 * t) * math.exp(-t / 0.4) + 0.25 * hp[i] * math.exp(-t / 0.01)
        elif kind == "ridebell":
            v = 0.8 * math.sin(TAU * 2800.0 * t) * math.exp(-t / 0.22) + 0.45 * math.sin(TAU * 4200.0 * t) * math.exp(-t / 0.15) + 0.3 * metallic(t) * math.exp(-t / 0.08)
        elif kind == "cowbell":
            v = 0.5 * square(587.0, t) * math.exp(-t / 0.09) + 0.5 * square(845.0, t) * math.exp(-t / 0.09)
        elif kind == "tamb":
            v = (0.8 * hp[i] + 0.4 * metallic(t)) * (math.exp(-t / 0.05) + 0.5 * math.exp(-max(0.0, t - 0.06) / 0.05) * (1.0 if t >= 0.06 else 0.0))
        elif kind == "vibraslap":
            v = (0.7 * hp[i] * (0.5 + 0.5 * math.sin(TAU * 38.0 * t)) + 0.3 * math.sin(TAU * 720.0 * t)) * math.exp(-t / 0.3)
        elif kind == "bongo":
            phase += TAU * (380.0 * (1.0 + 0.25 * math.exp(-t / 0.01))) / rate
            v = math.sin(phase) * math.exp(-t / 0.07) + 0.3 * hp[i] * math.exp(-t / 0.003)
        elif kind in ("conga_m", "conga_o"):
            phase += TAU * (300.0 * (1.0 + 0.2 * math.exp(-t / 0.015))) / rate
            v = math.sin(phase) * math.exp(-t / (0.035 if kind == "conga_m" else 0.12)) + 0.3 * hp[i] * math.exp(-t / 0.003)
        elif kind == "timbale":
            v = math.sin(TAU * 650.0 * t) * math.exp(-t / 0.12) + 0.3 * metallic(t * 0.5) * math.exp(-t / 0.05) + 0.4 * hp[i] * math.exp(-t / 0.006)
        elif kind == "agogo":
            v = (math.sin(TAU * 880.0 * t) + 0.6 * math.sin(TAU * 2430.0 * t)) * math.exp(-t / 0.14)
        elif kind == "cabasa":
            v = hp[i] * math.exp(-t / 0.03) * min(1.0, t / 0.004)
        elif kind == "maracas":
            v = hp[i] * math.exp(-t / 0.018) * min(1.0, t / 0.006)
        elif kind in ("whistle_s", "whistle_l"):
            f = 2200.0 + 500.0 * min(1.0, t / 0.06)
            phase += TAU * f / rate
            v = (math.sin(phase) + 0.25 * hp[i]) * min(1.0, t / 0.01) * (1.0 if kind == "whistle_l" or t < seconds - 0.03 else 0.5)
        elif kind in ("guiro_s", "guiro_l"):
            v = hp[i] * (1.0 if math.sin(TAU * 55.0 * t) > 0.0 else 0.15) * math.exp(-t / (0.06 if kind == "guiro_s" else 0.25))
        elif kind == "claves":
            v = math.sin(TAU * 2500.0 * t) * math.exp(-t / 0.012)
        elif kind == "block":
            v = (math.sin(TAU * 1100.0 * t) + 0.5 * math.sin(TAU * 1650.0 * t)) * math.exp(-t / 0.02)
        elif kind in ("cuica_m", "cuica_o"):
            f = 420.0 + (160.0 if kind == "cuica_m" else 700.0) * min(1.0, t / (0.08 if kind == "cuica_m" else 0.25))
            phase += TAU * f / rate
            v = (math.sin(phase) + 0.4 * math.sin(2.0 * phase)) * math.exp(-t / (0.05 if kind == "cuica_m" else 0.2))
        elif kind in ("arc_hat", "arc_ohat"):
            # A high-passed square ring-modulated with shift-register noise.
            v = square(5200.0, t) * hp[i] * math.exp(-t / (0.018 if kind == "arc_hat" else 0.07))
        elif kind == "arc_crash":
            # Shift-register noise read slower and slower, falling four semitones over 800 ms.
            if i == 0:
                table = [rng.next() for _ in range(count + 2)]
                position = 0.0
                smooth = 0.0
            position += 2.0 ** (-4.0 / 12.0 * (t / 0.8))
            whole = int(position)
            blend = position - whole
            smooth += 0.5 * ((table[whole] + (table[whole + 1] - table[whole]) * blend) - smooth)
            v = smooth * math.exp(-t / 0.25)
        elif kind == "toy_snare":
            # A toy woodblock: two short sine pings and no noise.
            v = (math.sin(TAU * 780.0 * t) + math.sin(TAU * 1150.0 * t)) * math.exp(-t / 0.018)
        elif kind == "toy_clap":
            # A cartoon slapstick: band-passed shift-register noise, gated at 60 ms.
            v = hp[i] * (1.0 if t < 0.06 else 0.0) * math.exp(-t / 0.035)
        elif kind == "shaker":
            v = hp[i] * min(1.0, t / 0.01) * math.exp(-t / 0.02)
        elif kind == "agogo_bell":
            v = (math.sin(TAU * 700.0 * t) + 0.5 * math.sin(TAU * 1680.0 * t)) * math.exp(-t / 0.1)
        elif kind == "pip":
            v = math.sin(TAU * 2200.0 * t) * math.exp(-t / 0.03) + (0.8 * (1.0 if i % 2 else -1.0) if i < 8 else 0.0)
        else:  # tri_m, tri_o: triangle
            v = (math.sin(TAU * 3000.0 * t) + 0.3 * math.sin(TAU * 8400.0 * t)) * math.exp(-t / (0.05 if kind == "tri_m" else 0.4))
        out.append(v)
    drive = dp["drive"].get(kind, dp["drive"].get("*", 0.0))
    ints = finish(out, profile, 0.78, drive)
    fade = min(64, count)
    for i in range(fade):  # click-free tail
        ints[count - 1 - i] = int(ints[count - 1 - i] * i / fade)
    return ints


# One entry per sound on GM percussion keys 35-81 (numbers per RP-003 Table 3; see audio-media.md#path-c-bank):
# (sample kind, keys, scaleTuning, pan in tenths of a percent, release s, exclusive class, semitone shift, attenuation cB)
KIT = [
    ("kick2", (35,), 0, 0, 0.05, 0, 0, 0),
    ("kick", (36,), 0, 0, 0.05, 0, 0, 0),
    ("rim", (37,), 0, 0, 0.03, 0, 0, 20),
    ("snare", (38,), 0, 0, 0.08, 0, 0, 0),
    ("clap", (39,), 0, 0, 0.1, 0, 0, 10),
    ("snare2", (40,), 0, 0, 0.08, 0, 0, 0),
    ("tom", (41, 43, 45, 47, 48, 50), 100, 0, 0.12, 0, 0, 0),
    ("chat", (42,), 0, 180, 0.02, 1, 0, 20),
    ("phat", (44,), 0, 180, 0.02, 1, 0, 20),
    ("ohat", (46,), 0, 180, 0.15, 1, 0, 20),
    ("crash", (49,), 0, -200, 0.3, 0, 0, 30),
    ("ride", (51,), 0, 200, 0.25, 0, 0, 30),
    ("chinese", (52,), 0, -150, 0.3, 0, 0, 30),
    ("ridebell", (53,), 0, 200, 0.25, 0, 0, 30),
    ("tamb", (54,), 0, 120, 0.1, 0, 0, 20),
    ("splash", (55,), 0, -100, 0.2, 0, 0, 30),
    ("cowbell", (56,), 0, -120, 0.1, 0, 0, 20),
    ("crash", (57,), 0, 150, 0.3, 0, -3, 30),
    ("vibraslap", (58,), 0, 0, 0.2, 0, 0, 30),
    ("ride", (59,), 0, 200, 0.25, 0, 2, 30),
    ("bongo", (60,), 0, -120, 0.05, 0, 0, 10),
    ("bongo", (61,), 0, -120, 0.05, 0, -5, 10),
    ("conga_m", (62,), 0, 120, 0.04, 0, 0, 10),
    ("conga_o", (63,), 0, 120, 0.1, 0, 0, 10),
    ("conga_o", (64,), 0, 120, 0.1, 0, -5, 10),
    ("timbale", (65,), 0, -80, 0.1, 0, 0, 10),
    ("timbale", (66,), 0, -80, 0.1, 0, -5, 10),
    ("agogo", (67,), 0, 80, 0.15, 0, 0, 20),
    ("agogo", (68,), 0, 80, 0.15, 0, -5, 20),
    ("cabasa", (69,), 0, 100, 0.05, 0, 0, 30),
    ("maracas", (70,), 0, -100, 0.03, 0, 0, 30),
    ("whistle_s", (71,), 0, 0, 0.04, 4, 0, 30),
    ("whistle_l", (72,), 0, 0, 0.1, 4, 0, 30),
    ("guiro_s", (73,), 0, 60, 0.04, 0, 0, 30),
    ("guiro_l", (74,), 0, 60, 0.1, 0, 0, 30),
    ("claves", (75,), 0, 0, 0.03, 0, 0, 10),
    ("block", (76,), 0, 0, 0.04, 0, 0, 10),
    ("block", (77,), 0, 0, 0.04, 0, -5, 10),
    ("cuica_m", (78,), 0, 0, 0.04, 2, 0, 20),
    ("cuica_o", (79,), 0, 0, 0.1, 2, 0, 20),
    ("tri_m", (80,), 0, 0, 0.04, 3, 0, 30),
    ("tri_o", (81,), 0, 0, 0.3, 3, 0, 30),
]
assert sorted(k for _, keys, *_ in KIT for k in keys) == list(range(35, 82))


# --- RIFF -----------------------------------------------------------------

def chunk(tag: bytes, payload: bytes) -> bytes:
    result = tag + struct.pack("<I", len(payload)) + payload
    return result + (b"\0" if len(payload) & 1 else b"")


def list_chunk(kind: bytes, children: list[bytes]) -> bytes:
    return chunk(b"LIST", kind + b"".join(children))


def text_chunk(tag: bytes, value: str) -> bytes:
    return chunk(tag, value.encode("ascii") + b"\0")


def name20(name: str) -> bytes:
    return name.encode("ascii")[:19].ljust(20, b"\0")


def gen(op: int, amount: int) -> bytes:
    return struct.pack("<Hh", op, amount)


def key_range(lo: int, hi: int) -> int:
    return struct.unpack("<h", struct.pack("<BB", lo, hi))[0]


class Bank:
    def __init__(self) -> None:
        self.samples: list[int] = []
        self.shdr: list[bytes] = []
        self.records: list[dict] = []
        self.inst: list[tuple[str, list[list[bytes]]]] = []

    def add_sample(self, name, frames, rate, root, loop, generator, extra, head: int = 0) -> int:
        start = len(self.samples)
        self.samples.extend(frames)
        end = len(self.samples)
        self.samples.extend([0] * 46)
        assert not loop or (len(frames) - head) % 16 == 0, f"{name}: loop of {len(frames) - head} frames is not a multiple of 16"
        loop_range = (start + head, end) if loop else (start, start)
        self.shdr.append(struct.pack("<20sIIIIIBbHH", name20(name), start, end, loop_range[0], loop_range[1], rate, root, 0, 0, 1))
        index = len(self.shdr) - 1
        self.records.append(
            {
                "id": index,
                "name": name,
                "generator": generator,
                "rootKey": root,
                "sampleRateHz": rate,
                "frames": len(frames),
                "loopFrames": [head, len(frames)] if loop else None,
                "source": "Original deterministic mathematical waveform generated by tools/licences/tk16_build.py; no recorded or third-party sample data.",
                "license": "CC0-1.0",
                **extra,
            }
        )
        return index


def build(profile_name: str = "classic") -> tuple[bytes, dict]:
    profile = PROFILES[profile_name]
    rate_hz = profile["rate"]
    bank = Bank()
    table = profile.get("table")
    for index, (name, spectrum, cycles, venv, filt, vib, wide, atten) in enumerate(INSTRUMENTS):
        extras: dict = {}
        tier = None
        if table:
            spectrum, cycles, venv, cutoff, vib, wide, tier, atten, *rest = table[name]
            extras = rest[0] if rest else {}
            filt = (float(cutoff), 0, 0.01, 0.1, 1000, 80 if spectrum == "noise" else 0)
        else:
            venv = profile["venv"].get(name, venv)
            filt = (max(300.0, filt[0] * 2.0 ** (profile["filter_shift"] / 1200.0)),) + filt[1:]
            vib = (vib[0], vib[1], int(round(vib[2] * profile["vibrato_scale"])))
        zone_plan = tier_zones(profile["zones"], tier) if table and profile.get("tiers") else profile["zones"]
        zones: list[list[bytes]] = []
        for lo, hi, period, *forced in zone_plan:
            root = forced[0] if forced else max(lo, min(hi, round(69 + 12 * math.log2((rate_hz / period) / 440.0))))
            # Tune the sample rate so the loop's pitch lands exactly on its root key.
            rate = int(round(key_hz(root) * period))
            frames, head_len = loop_cycle(spectrum, key_hz(root), period, cycles, profile, rate, extras.get("head"))
            sample = bank.add_sample(
                f"{name} {lo}-{hi}", frames, rate, root, True, spectrum,
                {"periodFrames": period, "loopCycles": cycles, "keyRange": [lo, hi]}, head_len,
            )
            low, sweep, mod_a, mod_d, mod_s, q = filt
            va, vd, vs, vr = venv
            pitch_env, pitch_seconds = extras.get("pitch_env", (0, 0.025)) if isinstance(extras.get("pitch_env", 0), tuple) else (extras.get("pitch_env", 0), 0.025)
            base = [
                gen(G_KEYS, key_range(lo, hi)),
                gen(G_ATTEN, atten),
                gen(G_A, tc(va)), gen(G_D, tc(vd)), gen(G_S, vs), gen(G_R, tc(vr)),
                gen(G_FC, fc(low)), gen(G_Q, q),
                gen(G_MOD_FC, sweep), gen(G_MOD_A, tc(mod_a)), gen(G_MOD_D, tc(pitch_seconds if pitch_env else mod_d)),
                gen(G_MOD_S, 1000 if pitch_env else (1000 - mod_s if sweep else 0)), gen(G_MOD_R, tc(vr)),
            ]
            if pitch_env:
                base.append(gen(G_MOD_PITCH, pitch_env))  # a start-up bend that settles in 25 ms
            if vib[2]:
                delay, rate_hz_vib, cents = vib
                base += [gen(G_VIB_PITCH, cents), gen(G_VIB_DELAY, tc(delay)), gen(G_VIB_FREQ, fc(rate_hz_vib))]
            if wide:
                # A narrow chorus pair: the two zones beat slowly and average to the written pitch.
                spread = extras.get("detune", 3)
                for fine, pan in ((-spread, -350), (spread, 350)):
                    zones.append(base + [gen(G_FINE, fine), gen(G_PAN, pan), gen(G_MODE, 1), gen(G_SAMPLE, sample)])
            else:
                zones.append(base + [gen(G_MODE, 1), gen(G_SAMPLE, sample)])
        bank.inst.append((name, zones))

    # Percussion instrument: one non-looping sample per kind, one zone per key.
    kit_samples: dict[str, int] = {}
    drum_zones: list[list[bytes]] = []
    for kind, keys, scale, pan, release, excl, semitones, atten in KIT:
        if kind not in kit_samples:
            voice = profile.get("kit_swap", {}).get(kind, kind)
            kit_samples[kind] = bank.add_sample(f"TK {voice}", drum(voice, profile), rate_hz, 60, False, f"drum-{voice}", {"keyRange": None})
        for key in keys:
            zone = [gen(G_KEYS, key_range(key, key)), gen(G_ATTEN, atten), gen(G_A, tc(0.001)), gen(G_R, tc(release)), gen(G_PAN, pan)]
            if semitones:
                zone.append(gen(G_COARSE, semitones))
            zone.append(gen(G_SCALE, scale))
            if excl:
                zone.append(gen(G_EXCL, excl))
            zone.append(gen(G_SAMPLE, kit_samples[kind]))
            drum_zones.append(zone)
    bank.inst.append(("TK Drums", drum_zones))

    # Presets: GM programs 0-127 in bank 0, one kit in bank 128.
    gm_map = list(GM_MAP)
    for program, timbre in profile.get("gm_overrides", {}).items():
        gm_map[program] = timbre
    phdr = [struct.pack("<20sHHHIII", name20(INSTRUMENTS[gm_map[p]][0]), p, 0, p, 0, 0, 0) for p in range(128)]
    phdr.append(struct.pack("<20sHHHIII", name20("TK Drums"), 0, 128, 128, 0, 0, 0))
    phdr.append(struct.pack("<20sHHHIII", name20("EOP"), 0, 0, 129, 0, 0, 0))
    pbag = [struct.pack("<HH", i, 0) for i in range(130)]
    pgen = [gen(G_INSTRUMENT, gm_map[p]) for p in range(128)] + [gen(G_INSTRUMENT, len(INSTRUMENTS)), gen(0, 0)]

    inst_rec, ibag, igen = [], [], []
    for name, zones in bank.inst:
        inst_rec.append(struct.pack("<20sH", name20(name), len(ibag)))
        for zone in zones:
            ibag.append(struct.pack("<HH", len(igen), 0))
            igen.extend(zone)
    inst_rec.append(struct.pack("<20sH", name20("EOI"), len(ibag)))
    ibag.append(struct.pack("<HH", len(igen), 0))
    igen.append(gen(0, 0))

    info = list_chunk(
        b"INFO",
        [
            chunk(b"ifil", struct.pack("<HH", 2, 1)),
            text_chunk(b"isng", "EMU8000"),
            text_chunk(b"INAM", profile["title"] + " General MIDI Bank"),
            text_chunk(b"ICOP", "CC0-1.0 - TK Reawakened contributors"),
            text_chunk(b"IENG", "TK Reawakened contributors"),
            text_chunk(b"ICMT", "Original CC0 mathematical waveforms; 16 RPG timbres mapped over GM 0-127 plus a synthesised kit."),
        ],
    )
    sdta = list_chunk(b"sdta", [chunk(b"smpl", struct.pack("<" + "h" * len(bank.samples), *bank.samples))])
    eos = struct.pack("<20sIIIIIBbHH", name20("EOS"), len(bank.samples), len(bank.samples), len(bank.samples), len(bank.samples), rate_hz, 60, 0, 0, 0)
    pdta = list_chunk(
        b"pdta",
        [
            chunk(b"phdr", b"".join(phdr)),
            chunk(b"pbag", b"".join(pbag)),
            chunk(b"pmod", b"\0" * 10),
            chunk(b"pgen", b"".join(pgen)),
            chunk(b"inst", b"".join(inst_rec)),
            chunk(b"ibag", b"".join(ibag)),
            chunk(b"imod", b"\0" * 10),
            chunk(b"igen", b"".join(igen)),
            chunk(b"shdr", b"".join(bank.shdr) + eos),
        ],
    )
    body = info + sdta + pdta
    data = b"RIFF" + struct.pack("<I", len(b"sfbk") + len(body)) + b"sfbk" + body
    record = {
        "bank": profile["title"],
        "profile": profile_name,
        "file": f"media/soundfonts/{profile['file']}",
        "default": profile_name == "classic",
        "character": profile["feel"],
        "presets": {"melodicPrograms": 128, "timbres": len(INSTRUMENTS), "percussionBank": 128, "percussionKeys": [35, 81]},
        "sampleCount": len(bank.records),
        "samples": bank.records,
    }
    return data, record


def main(argv: list[str]) -> None:
    """Write the banks and the provenance record; `--out DIR` writes both there instead (used to check a rebuild)."""
    out_dir = SOUNDFONTS
    provenance_path = PROVENANCE
    if len(argv) == 3 and argv[1] == "--out":
        out_dir = Path(argv[2])
        provenance_path = out_dir / "tk16-provenance.json"
    out_dir.mkdir(parents=True, exist_ok=True)
    banks = []
    for name, profile in PROFILES.items():
        data, record = build(name)
        path = out_dir / profile["file"]
        path.write_bytes(data)
        record["bytes"] = len(data)
        record["sha256"] = hashlib.sha256(data).hexdigest()
        banks.append(record)
        print(f"{path}: {len(data)} bytes, sha256 {record['sha256']}")
    provenance = {
        "format": "SoundFont 2.1 RIFF sfbk",
        "license": "CC0-1.0",
        "authoring": "Pure deterministic synthesis (noise from a 15-bit shift register); no third-party or recorded samples. Timbre targets were set by listening and coarse measurement of reference sample sets; no waveform, table or envelope data from them is read or embedded.",
        "generator": "tools/licences/tk16_build.py",
        "banks": banks,
    }
    provenance_path.write_text(json.dumps(provenance, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv)
