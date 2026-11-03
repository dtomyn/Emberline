/**
 * fireplace.js: the quiet sound bed under the documentary: a wood fire crackling.
 *
 * Synthesized live with Web Audio from seeded noise (no audio files), in four layers:
 *   - roar:     low, filtered brown noise that breathes slowly, the body of the flames;
 *   - hiss:     a faint high sizzle;
 *   - crackles: irregular ticks and snaps, mostly tiny, sometimes bunched into bursts, as wood does;
 *   - pops:     a few louder knocks per chapter, one for each of the chapter's largest real fires, in the
 *               order they started (bigger fires knock deeper; west is left).
 * Each chapter sets how lively the fire is. The whole bed ducks while a line is spoken.
 */

const LON_W = -110, LON_E = -101.4; // Saskatchewan's west and east edges
// Measured against the Kokoro clips (RMS about -22.6 dBFS) by rendering offline: the fire sits near
// -34 to -37 dBFS between lines (livelier chapters louder) and -43 to -46 dBFS under the voice, so it
// is felt more than heard. Re-measure if these change (see CLAUDE.md).
export const LEVEL = 0.14; // the bed's level between lines
export const DUCKED = 0.05; // and while the narrator speaks
const LOOKAHEAD = 0.6;     // seconds of crackle scheduled ahead

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

/** Seeded random in [0, 1), so the fire sounds the same every time. */
export function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}

/**
 * A real fire as a pop: deeper and louder for bigger fires across `range` (the chapter's
 * [smallest, largest]), panned by longitude.
 */
export function firePop(f, [lo, hi] = [1, 1e6]) {
  const k = Math.log10(f.size_ha + 1), a = Math.log10(lo + 1), b = Math.log10(hi + 1);
  const size = b > a ? clamp((k - a) / (b - a), 0, 1) : 0.5;
  return {
    freq: 900 - size * 620, // 900 Hz knock for the smallest, 280 Hz thump for the largest
    pan: clamp(((f.longitude - LON_W) / (LON_E - LON_W)) * 2 - 1, -1, 1) * 0.7,
    level: 0.5 + size * 0.5,
  };
}

/**
 * The crackle events from time `t0` to `t1` at `rate` events per second: { t, kind, ... }.
 * Pure, so it can be tested. Wood crackles in bursts, so an event often brings a few quick followers.
 */
export function crackleEvents(rnd, t0, t1, rate) {
  const out = [];
  let t = t0;
  while (true) {
    t += -Math.log(1 - rnd()) / rate; // Poisson gaps
    if (t >= t1) break;
    const r = rnd();
    const kind = r < 0.82 ? 'tick' : r < 0.97 ? 'snap' : 'pop';
    out.push({ t, kind, amp: rnd() ** 2.2, freq: rnd(), pan: rnd() * 1.4 - 0.7 });
    if (rnd() < 0.35) {
      const n = 1 + Math.floor(rnd() * 4);
      let u = t;
      for (let k = 0; k < n; k++) {
        u += 0.004 + rnd() * 0.03;
        if (u < t1) out.push({ t: u, burst: true, kind: 'tick', amp: rnd() ** 2 * 0.8, freq: rnd(), pan: clamp(out[out.length - 1].pan + rnd() * 0.2 - 0.1, -1, 1) });
      }
    }
  }
  return out.sort((a, b) => a.t - b.t); // a burst can run past the next crackle
}

/** `ctx` may be an OfflineAudioContext, to render the bed for a level check. */
export function createFireplace(ctx = null) {
  const Ctx = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  if (!ctx && !Ctx) return null;
  ctx ??= new Ctx();
  const live = !(globalThis.OfflineAudioContext && ctx instanceof OfflineAudioContext);
  const rnd = seeded(20251103);
  const rate = ctx.sampleRate;

  const out = ctx.createGain();
  out.gain.value = 0;
  const limiter = ctx.createDynamicsCompressor();
  limiter.threshold.value = -18; limiter.ratio.value = 8; limiter.attack.value = 0.002; limiter.release.value = 0.2;
  out.connect(limiter).connect(ctx.destination);
  // A small room, so the fire sounds like it is in a hearth rather than in your ear
  const room = ctx.createBuffer(2, Math.floor(rate * 0.9), rate);
  for (let c = 0; c < 2; c++) { const d = room.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (rnd() * 2 - 1) * (1 - i / d.length) ** 4; }
  const reverb = ctx.createConvolver();
  reverb.buffer = room;
  const wet = ctx.createGain(); wet.gain.value = 0.25;
  reverb.connect(wet).connect(out);
  const bus = ctx.createGain();
  bus.connect(out); bus.connect(reverb);

  // Noise loops: brown (deep) and white (bright), stereo-decorrelated, long enough not to sound looped
  function noise(seconds, brown) {
    const b = ctx.createBuffer(2, Math.floor(rate * seconds), rate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      let last = 0;
      for (let i = 0; i < d.length; i++) {
        const w = rnd() * 2 - 1;
        d[i] = brown ? (last = (last + 0.02 * w) / 1.02) * 3.5 : w;
      }
    }
    return b;
  }
  const loop = (buffer) => { const s = ctx.createBufferSource(); s.buffer = buffer; s.loop = true; return s; };
  // Slow, irregular breathing: two incommensurate sine waves added to a gain
  function breathe(param, base, depth, rates) {
    param.value = base;
    for (const r of rates) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = r; g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
    }
  }

  // Roar
  const roarSrc = loop(noise(7.3, true));
  const roarLp = ctx.createBiquadFilter(); roarLp.type = 'lowpass'; roarLp.frequency.value = 320;
  const roar = ctx.createGain();
  const roarBody = ctx.createGain(); // follows how lively the chapter is
  roarSrc.connect(roarLp).connect(roar).connect(roarBody).connect(bus);
  breathe(roar.gain, 0.5, 0.18, [0.11, 0.29]);
  breathe(roarLp.frequency, 320, 90, [0.07, 0.19]);
  // Hiss
  const hissSrc = loop(noise(5.9, false));
  const hissBp = ctx.createBiquadFilter(); hissBp.type = 'bandpass'; hissBp.frequency.value = 4200; hissBp.Q.value = 0.6;
  const hiss = ctx.createGain();
  hissSrc.connect(hissBp).connect(hiss).connect(roarBody);
  breathe(hiss.gain, 0.012, 0.006, [0.23, 0.41]);

  // Crackles: short slices of a white-noise buffer through a resonant band-pass
  const grit = noise(0.5, false);
  function crack(t, { kind, amp, freq, pan, hz = null }, loud = 1) {
    const s = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), g = ctx.createGain(), p = ctx.createStereoPanner();
    s.buffer = grit;
    const len = kind === 'tick' ? 0.002 + amp * 0.004 : kind === 'snap' ? 0.008 + amp * 0.014 : 0.03 + amp * 0.04;
    bp.type = 'bandpass';
    bp.frequency.value = hz ?? (kind === 'tick' ? 2200 + freq * 5000 : kind === 'snap' ? 900 + freq * 1800 : 300 + freq * 700);
    bp.Q.value = kind === 'pop' ? 6 : kind === 'snap' ? 2.5 : 1.2;
    const peak = loud * (kind === 'tick' ? 0.25 + amp * 0.6 : kind === 'snap' ? 0.6 + amp * 0.9 : 1.4 + amp);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.0008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    p.pan.value = pan;
    s.connect(bp).connect(g).connect(p).connect(bus);
    s.start(t, rnd() * 0.45, len + 0.01);
  }

  let lively = 1;         // crackles per second scale with this
  let scheduled = 0;      // crackle events are scheduled up to this time
  const scheduleUntil = (t1) => {
    if (t1 <= scheduled) return;
    for (const e of crackleEvents(rnd, scheduled, t1, 4 + lively * 6)) crack(e.t, e);
    scheduled = t1;
  };
  let timer = null;

  function level(to, seconds) {
    const t = ctx.currentTime;
    out.gain.cancelScheduledValues(t);
    out.gain.setValueAtTime(out.gain.value, t);
    out.gain.linearRampToValueAtTime(to, t + seconds);
  }
  function liveliness(to, seconds = 3) {
    lively = to;
    const t = ctx.currentTime;
    roarBody.gain.cancelScheduledValues(t);
    roarBody.gain.setValueAtTime(roarBody.gain.value, t);
    roarBody.gain.linearRampToValueAtTime(0.6 + to * 0.25, t + seconds);
  }

  let muted = false, ducked = false;
  const target = () => (muted ? 0 : ducked ? DUCKED : LEVEL);

  return {
    /** The fire catches under the title card. */
    begin() {
      if (live) ctx.resume();
      roarSrc.start(); hissSrc.start();
      roarBody.gain.value = 0.4;
      scheduled = ctx.currentTime;
      liveliness(0.6, 4);
      level(target(), 3);
      if (live) timer = setInterval(() => ctx.state === 'running' && scheduleUntil(ctx.currentTime + LOOKAHEAD), 200);
    },
    /** A chapter: how lively the fire is, and its real fires as pops over the first seconds. */
    chapter(i, fires = [], { heat = 1 } = {}) {
      liveliness(heat);
      const pops = fires.slice(0, 8);
      const sizes = pops.map((f) => f.size_ha);
      const range = [Math.min(...sizes), Math.max(...sizes)];
      const t0 = ctx.currentTime + 1.5;
      pops.forEach((f, k) => {
        const p = firePop(f, range);
        crack(t0 + k * 1.3 + rnd() * 0.3, { kind: 'pop', amp: p.level, hz: p.freq, pan: p.pan }, 0.7);
      });
    },
    /** Burning down to embers under the end card. */
    end() { liveliness(0.25, 6); },
    duck(on) { ducked = on; level(target(), on ? 0.35 : 1.6); },
    setMuted(m) { muted = m; level(target(), 0.4); },
    get muted() { return muted; },
    pause() { if (live) ctx.suspend(); },
    resume() { if (live) ctx.resume(); },
    /** For an offline render: schedule the crackle up to `t` seconds. */
    prerender(t) { scheduleUntil(t); },
    /** Fade out and release the audio device. */
    stop(seconds = 1.5) {
      level(0, seconds);
      clearInterval(timer);
      if (live) setTimeout(() => ctx.close(), seconds * 1000 + 200);
    },
  };
}
