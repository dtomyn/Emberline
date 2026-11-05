"""The explainer's soundtrack, synthesized from the film's own timeline (no recordings, numpy only).

  mix(timeline, voice_dir, manifest, out_wav, fps)

Layers, quietest first: a low pad in D minor that swells and ducks under the voice; the crackle and roar
of a fire under the burning scenes; an air whoosh on each camera zoom; a soft two-part mouse click
(press and release, panned to where the cursor is); a key tap for every typed character; a riser under
each counting number and a soft bell hit when it lands; a roar under each burn transition; thunder on
every lightning strike the replay drew; a sub impact under the title and end card; and the Kokoro
narration on top. render.py levels the
result to -14 LUFS for YouTube.
"""
import numpy
import soundfile

SR = 48000
rng = numpy.random.default_rng(1981)


def seconds(n):
    return int(round(n * SR))


def band(x, lo, hi):
    """Band-limit a signal with an FFT mask (soft edges)."""
    spec = numpy.fft.rfft(x)
    f = numpy.fft.rfftfreq(len(x), 1 / SR)
    mask = numpy.ones_like(f)
    if lo:
        mask *= 1 / (1 + (lo / numpy.maximum(f, 1)) ** 4)
    if hi:
        mask *= 1 / (1 + (f / hi) ** 4)
    return numpy.fft.irfft(spec * mask, len(x))


def add(track, sound, at, gain=1.0, pan=0.5):
    """Mix a mono sound into a stereo track at `at` seconds, with equal-power panning."""
    i = seconds(at)
    if i >= len(track) or i + len(sound) <= 0:
        return
    s = sound[max(0, -i): len(track) - i]
    i = max(0, i)
    track[i:i + len(s), 0] += s * gain * numpy.cos(pan * numpy.pi / 2)
    track[i:i + len(s), 1] += s * gain * numpy.sin(pan * numpy.pi / 2)


def curve(marks, total, default=0.0):
    """Per-sample level from (at, level, over) marks, easing linearly to each new level."""
    n = seconds(total)
    out = numpy.full(n, default, dtype="float32")
    level = default
    for at, to, over in sorted(marks):
        a, b = seconds(at), seconds(at + max(over, 0.01))
        if a >= n:
            break
        ramp = numpy.linspace(level, to, max(1, b - a), dtype="float32")
        out[a:min(b, n)] = ramp[:max(0, min(b, n) - a)]
        out[min(b, n):] = to
        level = to
    return out


def duck_curve(voiced, total, depth, attack=0.25, release=0.9):
    """1 between lines, `depth` while the narrator speaks, with smooth edges."""
    n = seconds(total)
    on = numpy.zeros(n, dtype="float32")
    for v in voiced:
        on[seconds(v["at"] - attack):seconds(v["end"] + 0.15)] = 1
    # A centred moving average makes the edges soft. Done with a running sum: numpy.convolve is direct
    # convolution, and a 0.9 s kernel over minutes of 48 kHz audio would take hours.
    w = seconds(release)
    c = numpy.concatenate([[0.0], numpy.cumsum(on, dtype="float64")])
    lo = numpy.clip(numpy.arange(n) - w // 2, 0, n)
    hi = numpy.clip(lo + w, 0, n)
    on = ((c[hi] - c[lo]) / w).astype("float32")
    return 1 - (1 - depth) * numpy.clip(on, 0, 1)


# ------------------------------------------------------------------ instruments
NOTE = {"D2": 73.42, "F2": 87.31, "A2": 110.0, "Bb1": 58.27, "C2": 65.41, "D3": 146.83, "F3": 174.61, "A3": 220.0,
        "Bb2": 116.54, "C3": 130.81, "E3": 164.81, "G3": 196.0, "D4": 293.66, "F4": 349.23, "A4": 440.0, "C4": 261.63, "E4": 329.63}
CHORDS = [["D2", "D3", "F3", "A3", "D4"], ["Bb1", "Bb2", "D3", "F3", "D4"], ["F2", "C3", "F3", "A3", "C4"], ["C2", "C3", "E3", "G3", "E4"]]
CHORD_LEN = 8.0


def pad(total):
    """Slow chords, each partial a pair of detuned sines panned apart, crossfading every eight seconds."""
    n = seconds(total)
    out = numpy.zeros((n, 2), dtype="float32")
    seg = seconds(CHORD_LEN)
    fade = seconds(3.0)
    for k, start in enumerate(range(-fade, n, seg)):
        a, b = max(0, start), min(n, start + seg + fade * 2)
        if b <= a:
            continue
        t = numpy.arange(a, b) / SR
        local = numpy.arange(a - start, b - start)
        env = numpy.clip(numpy.minimum(local / fade, (seg + 2 * fade - local) / fade), 0, 1)
        env = numpy.sin(env * numpy.pi / 2) ** 2
        for j, name in enumerate(CHORDS[k % len(CHORDS)]):
            f = NOTE[name]
            amp = (0.55 if j == 0 else 0.28 / (1 + 0.25 * j)) * (1 + 0.25 * numpy.sin(2 * numpy.pi * (0.07 + 0.03 * j) * t + j))
            for side, det in ((0, 0.9985), (1, 1.0015)):
                wave = numpy.sin(2 * numpy.pi * f * det * t + j) + 0.18 * numpy.sin(4 * numpy.pi * f * det * t)
                out[a:b, side] += (wave * amp * env).astype("float32")
    # A faint high shimmer an octave and a fifth up, breathing slowly
    t = numpy.arange(n) / SR
    shimmer = 0.04 * numpy.sin(2 * numpy.pi * 880 * t) * (0.5 + 0.5 * numpy.sin(2 * numpy.pi * 0.05 * t)) ** 3
    out[:, 0] += shimmer.astype("float32")
    out[:, 1] += numpy.roll(shimmer, seconds(0.013)).astype("float32")
    return out / numpy.abs(out).max()


def fire_bed(total):
    """Roar (low brown noise) and hiss, plus crackles: short bright bursts at random, sometimes in bunches."""
    n = seconds(total)
    roar = band(rng.standard_normal(n), 40, 380)
    roar *= 1 + 0.5 * numpy.sin(2 * numpy.pi * 0.23 * numpy.arange(n) / SR)
    hiss = band(rng.standard_normal(n), 3500, 9000) * 0.12
    bed = numpy.stack([roar + hiss, numpy.roll(roar, seconds(0.02)) + hiss], axis=1)
    bed /= numpy.abs(bed).max()
    crackle = numpy.zeros((n, 2), dtype="float32")
    t = 0.0
    while t < total:
        t += rng.exponential(1 / 14)
        burst = 1 + (rng.random() < 0.12) * rng.integers(2, 6)
        for b in range(burst):
            length = seconds(rng.uniform(0.002, 0.012))
            x = rng.standard_normal(length) * numpy.exp(-numpy.linspace(0, 6, length))
            x = numpy.diff(x, prepend=0)  # brighter, like a snap
            add(crackle, x, t + b * rng.uniform(0.01, 0.04), rng.uniform(0.15, 1.0) ** 2, rng.uniform(0.2, 0.8))
    return 0.55 * bed + 0.9 * crackle / max(1e-9, numpy.abs(crackle).max())


def click(down):
    """A soft mouse click: a tiny tick, a short resonance and a low thock; the release is lighter and higher."""
    n = seconds(0.05)
    t = numpy.arange(n) / SR
    tick = band(rng.standard_normal(n), 2000, 9000) * numpy.exp(-t / 0.0012)
    ring = numpy.sin(2 * numpy.pi * (2300 if down else 3100) * t) * numpy.exp(-t / 0.006) * 0.5
    thock = numpy.sin(2 * numpy.pi * (170 if down else 240) * t) * numpy.exp(-t / 0.012) * (0.9 if down else 0.35)
    return (tick * 0.7 + ring + thock) * (1.0 if down else 0.6)


def key(seed, space=False):
    """A keyboard tap: a short bright tick over a small low knock; the space bar is duller and longer."""
    r = numpy.random.default_rng(seed)
    n = seconds(0.06)
    t = numpy.arange(n) / SR
    tick = band(r.standard_normal(n), 1800, 8000) * numpy.exp(-t / (0.0022 if space else 0.0014))
    knock = numpy.sin(2 * numpy.pi * (r.uniform(300, 380) if not space else 210) * t) * numpy.exp(-t / (0.016 if space else 0.009))
    ring = numpy.sin(2 * numpy.pi * r.uniform(1700, 2400) * t) * numpy.exp(-t / 0.004) * 0.25
    out = tick * 0.8 + knock * (0.55 if space else 0.4) + ring
    return out / numpy.abs(out).max()


def riser(dur):
    """Tension under a counting number: filtered noise and a sine that both climb, swelling to the end."""
    n = seconds(dur)
    t = numpy.arange(n) / SR
    k = t / max(dur, 1e-3)
    freq = 180 * 4 ** k
    tone = numpy.sin(2 * numpy.pi * numpy.cumsum(freq) / SR) * 0.35 + numpy.sin(2 * numpy.pi * numpy.cumsum(freq * 1.5) / SR) * 0.15
    air = band(rng.standard_normal(n), 600, 7000) * (0.3 + 0.7 * k)
    env = k ** 1.8 * numpy.minimum(1, (1 - k) * 40 + 0.0)
    out = (tone + air / max(1e-9, numpy.abs(air).max())) * env
    return out / max(1e-9, numpy.abs(out).max())


def hit():
    """A number landing: a short soft sub thump and a warm bell (fifth and octave) that rings out."""
    n = seconds(2.6)
    t = numpy.arange(n) / SR
    sub = numpy.sin(2 * numpy.pi * numpy.cumsum(55 + 40 * numpy.exp(-t / 0.08)) / SR) * numpy.exp(-t / 0.35)
    bell = sum(a * numpy.sin(2 * numpy.pi * f * t) * numpy.exp(-t / d) for f, a, d in ((587.3, 0.5, 0.9), (880, 0.3, 0.7), (1174.7, 0.2, 0.5), (1760, 0.08, 0.3)))
    thump = band(rng.standard_normal(n), 30, 300) * numpy.exp(-t / 0.03)
    out = sub * 0.9 + bell * 0.45 + 0.4 * thump / numpy.abs(thump).max()
    return out / numpy.abs(out).max()


def burn(dur, cover):
    """A burn transition: a roar that swells through the move, crackling, with a soft air rush on top."""
    n = seconds(dur + 1.2)
    t = numpy.arange(n) / SR
    k = numpy.clip(t / dur, 0, 1)
    swell = numpy.sin(numpy.pi * numpy.clip(k * 0.9 + 0.05, 0, 1)) ** 1.2 * numpy.exp(-numpy.maximum(0, t - dur) / 0.5)
    roar = band(rng.standard_normal(n), 35, 500)
    rush = band(rng.standard_normal(n), 800, 5000) * (k if cover else 1 - k)
    crack = numpy.zeros(n)
    at = 0.0
    while at < dur:
        at += rng.exponential(1 / 30)
        i, length = seconds(at), seconds(rng.uniform(0.002, 0.01))
        if i + length < n:
            crack[i:i + length] += numpy.diff(rng.standard_normal(length + 1)) * rng.uniform(0.2, 1) ** 2
    out = roar / numpy.abs(roar).max() + 0.35 * rush / numpy.abs(rush).max() + 0.6 * crack / max(1e-9, numpy.abs(crack).max())
    return out * swell / max(1e-9, numpy.abs(out * swell).max())


def whoosh(dur, rising, big=False):
    """Air moving past: noise that swells and fades, its colour sliding up for a push-in and down for a pull-out."""
    n = seconds(dur + 0.3)
    noise = rng.standard_normal(n)
    low, high = band(noise, 150, 900), band(noise, 900, 6000)
    k = numpy.linspace(0, 1, n)
    mix = k if rising else 1 - k
    env = numpy.sin(numpy.clip(k * 1.15, 0, 1) * numpy.pi) ** 1.6
    out = (low * (1 - mix) + high * mix * 0.6) * env
    if big:
        out += band(rng.standard_normal(n), 30, 160) * env * 1.2
    return out / max(1e-9, numpy.abs(out).max())


def boom():
    """A sub impact: a falling sine with a soft noise thump and a dark tail."""
    n = seconds(4.0)
    t = numpy.arange(n) / SR
    freq = 38 + 34 * numpy.exp(-t / 0.35)
    body = numpy.sin(2 * numpy.pi * numpy.cumsum(freq) / SR) * numpy.exp(-t / 1.1)
    thump = band(rng.standard_normal(n), 20, 220) * numpy.exp(-t / 0.08)
    tail = band(rng.standard_normal(n), 40, 400) * numpy.exp(-t / 1.3) * 0.08
    out = body + 0.5 * thump / numpy.abs(thump).max() + tail / max(1e-9, numpy.abs(tail).max()) * 0.15
    return out / numpy.abs(out).max()


def thunder(seed):
    """Distant thunder: a soft low rumble that rolls irregularly for a few seconds (no sharp crack,
    which the owner found harsh)."""
    r = numpy.random.default_rng(seed)
    n = seconds(4.5)
    t = numpy.arange(n) / SR
    rumble = band(r.standard_normal(n), 25, 180)
    rolls = numpy.zeros(n)
    for _ in range(6):
        c, w = r.uniform(0.3, 2.8), r.uniform(0.35, 0.9)
        rolls += r.uniform(0.4, 1) * numpy.exp(-((t - c) / w) ** 2)
    fade_in = numpy.clip(t / 0.25, 0, 1)
    out = rumble / numpy.abs(rumble).max() * rolls * numpy.exp(-t / 2.2) * fade_in
    return out / numpy.abs(out).max()


def voice_track(voiced, clips, voice_dir, total):
    out = numpy.zeros((seconds(total), 2), dtype="float32")
    for v in voiced:
        audio, rate = soundfile.read(str(voice_dir / clips[v["text"]]["file"]), dtype="float32", always_2d=True)
        audio = audio.mean(axis=1)
        if rate != SR:
            audio = numpy.interp(numpy.arange(int(len(audio) * SR / rate)) * rate / SR, numpy.arange(len(audio)), audio)
        add(out, audio, v["at"], 1.0, 0.5)
    return out


def mix(timeline, voice_dir, clips, out_wav, fps):
    total = timeline["total"] + 1.0
    lag = 1 / fps  # frame k is drawn at k/fps but seen at (k-1)/fps
    sfx = [dict(e, at=max(0.0, e["at"] - lag)) for e in timeline["sfx"]]
    voiced = [dict(v, at=max(0.0, v["at"] - lag), end=v["end"] - lag) for v in timeline["voiced"]]
    n = seconds(total)

    music = pad(total) * curve([(e["at"], e["level"], e["over"]) for e in sfx if e["kind"] == "music"], total)[:, None]
    music *= duck_curve(voiced, total, 0.42)[:, None]
    fire = fire_bed(total) * curve([(e["at"], e["level"], e["over"]) for e in sfx if e["kind"] == "fire"], total)[:, None]
    fire *= duck_curve(voiced, total, 0.55)[:, None]
    fx = numpy.zeros((n, 2), dtype="float32")
    clicks = {True: click(True), False: click(False)}
    booms = boom()
    hits = hit()
    thunders = [thunder(s) for s in range(4)]
    last_thunder = -9.0
    for e in sfx:
        if e["kind"] == "click":
            add(fx, clicks[e["down"]], e["at"], 0.42, 0.2 + 0.6 * e.get("x", 0.5))
        elif e["kind"] == "whoosh":
            add(fx, whoosh(e["dur"], e["dir"] > 0, e.get("big", False)), e["at"], 0.16 if e.get("big") else 0.09, 0.5)
        elif e["kind"] == "boom":
            add(fx, booms, e["at"], 0.75, 0.5)
        elif e["kind"] == "key":
            add(fx, key(int(e["at"] * 1000), e.get("space", False)), e["at"], 0.2, 0.25 + 0.5 * e.get("x", 0.5))
        elif e["kind"] == "riser":
            add(fx, riser(e["dur"]), e["at"], 0.07, 0.5)
        elif e["kind"] == "hit":
            add(fx, hits, e["at"], 0.32, 0.5)
        elif e["kind"] == "burn":
            add(fx, burn(e["dur"], e.get("dir", 1) > 0), e["at"], 0.26, 0.5)
        elif e["kind"] == "thunder" and e["at"] - last_thunder > 1.5:
            # Sparse and quiet: one distant roll at most every 1.5 s, well under the voice
            last_thunder = e["at"]
            add(fx, thunders[int(e["at"] * 7) % 4], e["at"] + 0.15, 0.05 + 0.07 * e.get("intensity", 0.6), 0.5)
    voice = voice_track(voiced, clips, voice_dir, total)
    track = voice + music * 0.10 + fire * 0.07 + fx
    track /= max(1.0, numpy.abs(track).max() / 0.95)
    soundfile.write(str(out_wav), track, SR, subtype="PCM_24")
    return total
