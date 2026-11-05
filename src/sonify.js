/**
 * sonify.js: Hear the Season. Every ignition in the replay plays a note (Web Audio, no samples).
 *
 *   pitch    size: small fires ring high, big fires sound low (A minor pentatonic, so it stays musical)
 *   timbre   cause: lightning a bright bell, human a soft wooden mallet, unknown a muted pad
 *   loudness log of size; fires ≥ 10,000 ha add a deep gong
 *   pan      longitude: west to east across the stereo field
 *   texture  a crackle bed and low rumble follow how many fires started in the last two weeks,
 *            so big years swell into a storm; lightning strikes bring thunder
 */
const PENTA = [0, 3, 5, 7, 10];
const A2 = 110;
// Four octaves of A minor pentatonic, low to high
const SCALE = Array.from({ length: 20 }, (_, i) => A2 * 2 ** ((12 * Math.floor(i / 5) + PENTA[i % 5]) / 12));
const MAX_VOICES = 30;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

export function noteFor(fire) {
  const size = Math.log10(fire.size_ha + 1) / 5.8; // 0 for tiny fires, ~1 for 600k ha
  const jitter = Math.round((((Math.sin(fire.t * 12.9898 + fire.latitude) * 43758.5453) % 1 + 1) % 1) * 4) - 2;
  const idx = clamp(Math.round((1 - size) * (SCALE.length - 1)) + jitter, 0, SCALE.length - 1);
  return {
    freq: SCALE[idx],
    gain: 0.05 + 0.13 * clamp(size, 0, 1),
    pan: clamp((fire.longitude + 105.7) / 4.4, -1, 1),
    voice: fire.general_cause === 'Lightning' ? 'bell' : fire.general_cause === 'Human' ? 'wood' : 'pad',
    gong: fire.size_ha >= 10000,
  };
}

export function createSonifier() {
  let ctx = null, out, verbIn, noise, bed, bedFilter, rumble, voices = 0, lastThunder = -9;
  const S = { enabled: false, recent: 0 };

  function init() {
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.25;
    out = ctx.createGain(); out.gain.value = 0;
    out.connect(comp).connect(ctx.destination);

    // Reverb from a generated impulse: decaying stereo noise
    const len = ctx.sampleRate * 2.8, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    const verb = ctx.createConvolver(); verb.buffer = ir;
    verbIn = ctx.createGain(); verbIn.gain.value = 0.55;
    verbIn.connect(verb).connect(out);

    // Shared noise buffer for crackle, rumble and thunder
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noise.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

    const loop = (filterType, freq, q) => {
      const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
      const f = ctx.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(f).connect(g).connect(out); src.start();
      return { g, f };
    };
    ({ g: bed, f: bedFilter } = loop('bandpass', 2200, 0.7));
    ({ g: rumble } = loop('lowpass', 90, 0.6));
  }

  function env(gainNode, t, peak, attack, decay) {
    gainNode.gain.setValueAtTime(0.0001, t);
    gainNode.gain.exponentialRampToValueAtTime(peak, t + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  function tone(freq, type, t, peak, attack, decay, pan, filterHz) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    let node = o;
    if (filterHz) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = filterHz; o.connect(f); node = f; }
    node.connect(g).connect(p);
    p.connect(out); p.connect(verbIn);
    env(g, t, peak, attack, decay);
    o.start(t); o.stop(t + attack + decay + 0.05);
    voices++;
    o.onended = () => { voices--; };
  }

  function play(fire, when) {
    if (voices > MAX_VOICES) return;
    const n = noteFor(fire), t = ctx.currentTime + when;
    if (n.voice === 'bell') {
      tone(n.freq * 2, 'sine', t, n.gain, 0.004, 1.9, n.pan);
      tone(n.freq * 2 * 2.76, 'sine', t, n.gain * 0.35, 0.002, 0.6, n.pan);
    } else if (n.voice === 'wood') {
      tone(n.freq * 2, 'triangle', t, n.gain * 1.1, 0.003, 0.32, n.pan, 2400);
      tone(n.freq * 8, 'sine', t, n.gain * 0.18, 0.001, 0.07, n.pan);
    } else {
      tone(n.freq * 2, 'sine', t, n.gain * 0.8, 0.06, 1.1, n.pan, 1400);
    }
    if (n.gong) {
      tone(n.freq / 2, 'sine', t, 0.22, 0.01, 4.5, n.pan);
      tone(n.freq / 2 * 1.5, 'sine', t, 0.07, 0.02, 3.2, -n.pan);
    }
  }

  return {
    state: S,
    get enabled() { return S.enabled; },
    async setEnabled(on) {
      S.enabled = on;
      if (on && !ctx) init();
      if (!ctx) return;
      if (on) await ctx.resume();
      out.gain.setTargetAtTime(on ? 0.9 : 0, ctx.currentTime, 0.15);
    },

    /** Play ignitions that happened during one frame, spread across the frame for a natural texture. */
    ignitions(fires, frameSeconds) {
      if (!S.enabled || !ctx || !fires.length) return;
      const pick = fires.length > 8 ? [...fires].sort((a, b) => b.size_ha - a.size_ha).slice(0, 8) : fires;
      pick.forEach((f, i) => play(f, (i / pick.length) * frameSeconds + 0.01));
    },

    /** Continuous texture: recent = fires started in the last 14 days, burning = their hectares. */
    ambience(recent, burningHa) {
      if (!S.enabled || !ctx) return;
      const level = clamp(Math.log10(recent + 1) / 2.4, 0, 1);
      const deep = clamp(Math.log10(burningHa + 1) / 5.5, 0, 1);
      bed.gain.setTargetAtTime(level ** 1.6 * 0.09, ctx.currentTime, 0.4);
      bedFilter.frequency.setTargetAtTime(1600 + level * 1800, ctx.currentTime, 0.6);
      rumble.gain.setTargetAtTime(deep ** 2 * 0.45, ctx.currentTime, 0.8);
    },

    /** Thunder: a soft, distant low rumble (no bright crack), at most one every 1.5 s. */
    thunder(intensity = 0.6) {
      if (!S.enabled || !ctx || voices > MAX_VOICES) return;
      if (ctx.currentTime - lastThunder < 1.5) return;
      lastThunder = ctx.currentTime;
      const t = ctx.currentTime + 0.15 + Math.random() * 0.6;
      const src = ctx.createBufferSource(); src.buffer = noise;
      const f = ctx.createBiquadFilter(); f.type = 'lowpass';
      f.frequency.setValueAtTime(320, t); f.frequency.exponentialRampToValueAtTime(60, t + 2.2);
      const g = ctx.createGain();
      const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.4 - 0.7;
      src.connect(f).connect(g).connect(p).connect(out); p.connect(verbIn);
      env(g, t, 0.05 + 0.08 * intensity, 0.25, 2.4);
      src.start(t, Math.random()); src.stop(t + 2.6);
      voices++;
      src.onended = () => { voices--; };
    },
    silence() { if (ctx) { bed.gain.setTargetAtTime(0, ctx.currentTime, 0.2); rumble.gain.setTargetAtTime(0, ctx.currentTime, 0.3); } },
  };
}
