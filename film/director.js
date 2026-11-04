// film/director.js: films the explainer inside the running app.
//
// film/render.py loads Emberline with film/clock.js (virtual time), then this module. The scenes in
// film/scenes.js are generator functions: they move a drawn cursor (the real mouse follows it, so
// hovers and clicks are the app's own), type into the app (real keystrokes), start narration lines,
// push a video camera in and out, and lay motion graphics over the frame: chapter chips, numbers that
// count up, a spotlight that dims everything but one control, cinema bars, and burn transitions that
// eat the frame to black and burn back out. render.py calls Film.step(ms) once per frame, performs the
// mouse and key events it returns, waits for map tiles, and captures the crop rectangle it returns.
// Sound effects and voice timings are collected here and mixed by film/sound.py afterwards.
import { cueTime, splitSentences } from '/src/narration.js';
import { buildScenes } from './scenes.js';

const E = window.emberline;
const clock = window.__clock;
const W = innerWidth, H = innerHeight;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
export const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const CLICKABLE = 'button, a, [role=tab], input, select, label, .sl-row, .ybar, .threat, #track, #spread-track';
const BAR = 78; // letterbox bar height, at full

// ------------------------------------------------------------------ overlay
const style = document.createElement('style');
style.textContent = `
#film { position: fixed; inset: 0; z-index: 2147483000; pointer-events: none; overflow: hidden; font-family: 'Space Grotesk', system-ui, sans-serif; }
#film .f-hud { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; transform-origin: 0 0; }
#film .f-cursor { position: absolute; left: 0; top: 0; width: 30px; height: 30px; margin: -3px 0 0 -5px; filter: drop-shadow(0 3px 6px rgba(0,0,0,.55)); transition: opacity .35s; }
#film .f-cursor svg { position: absolute; inset: 0; transition: transform .12s ease-out, opacity .12s; transform-origin: 5px 3px; }
#film .f-cursor .hand { opacity: 0; }
#film .f-cursor.hand .arrow { opacity: 0; } #film .f-cursor.hand .hand { opacity: 1; }
#film .f-cursor.down svg { transform: scale(.82); }
#film .f-ripple { position: absolute; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 2px solid #ffd27a; box-shadow: 0 0 18px #ff7a1f, inset 0 0 10px rgba(255,122,31,.6); animation: f-ripple-grow .7s ease-out forwards; }
@keyframes f-ripple-grow { from { transform: scale(.4); opacity: 1; } to { transform: scale(3.4); opacity: 0; } }
#film .f-black { position: absolute; inset: 0; background: #000; opacity: 0; }
#film .f-vig { position: absolute; inset: 0; background: radial-gradient(ellipse 75% 70% at 50% 50%, transparent 62%, rgba(0,0,0,.34) 100%); }
#film .f-bar { position: absolute; left: 0; right: 0; height: 0; background: #000; }
#film .f-bar.top { top: 0; } #film .f-bar.bot { bottom: 0; }
#film canvas.f-burn, #film canvas.f-embers { position: absolute; left: 0; top: 0; width: ${W}px; height: ${H}px; }
#film canvas.f-embers { opacity: 0; }
#film .f-chip { position: absolute; left: 304px; top: 92px; display: flex; align-items: center; gap: 14px; padding: 12px 20px 12px 14px; border-radius: 16px;
  background: linear-gradient(135deg, rgba(20,12,8,.88), rgba(10,10,14,.82)); border: 1px solid rgba(255,140,60,.35); backdrop-filter: blur(12px);
  box-shadow: 0 10px 40px -10px rgba(255,90,20,.45); opacity: 0; transform: translateY(-14px); transition: opacity .5s, transform .6s cubic-bezier(.2,.9,.2,1.2); }
#film .f-chip.on { opacity: 1; transform: none; }
#film .f-chip .n { font: 600 28px/1 'JetBrains Mono', monospace; color: #ff7a1f; text-shadow: 0 0 18px rgba(255,122,31,.7); }
#film .f-chip .k { font: 600 11px/1.2 'JetBrains Mono', monospace; letter-spacing: .16em; text-transform: uppercase; color: #ffb36b; }
#film .f-chip .t { font-size: 19px; font-weight: 600; color: #fff3e6; letter-spacing: -.01em; margin-top: 3px; }
#film .f-chip::after { content: ''; position: absolute; left: 14px; right: 14px; bottom: -1px; height: 2px; border-radius: 2px; background: linear-gradient(90deg, transparent, #ffd27a, #ff5a1f, transparent);
  transform: scaleX(0); transition: transform 1.1s .25s cubic-bezier(.2,.8,.2,1); }
#film .f-chip.on::after { transform: scaleX(1); }
#film .f-stat { position: absolute; transform: translate(-50%, -50%); text-align: center; white-space: nowrap; opacity: 0; filter: blur(14px);
  transition: opacity .7s, filter .9s cubic-bezier(.2,.8,.2,1), transform .9s cubic-bezier(.2,.8,.2,1); }
#film .f-stat.on { opacity: 1; filter: none; }
#film .f-stat.off { opacity: 0; filter: blur(10px); transform: translate(-50%, -62%); transition-duration: .6s; }
#film .f-stat .k { font: 600 15px/1 'JetBrains Mono', monospace; letter-spacing: .32em; text-transform: uppercase; color: #ffb36b; margin-bottom: 14px; }
#film .f-stat .v { font-weight: 700; line-height: .95; letter-spacing: -.045em; font-variant-numeric: tabular-nums;
  background: linear-gradient(180deg, #fff6e2 0%, #ffc27a 42%, #ff6a1f 100%); -webkit-background-clip: text; color: transparent;
  filter: drop-shadow(0 0 28px rgba(255,100,20,.55)); }
#film .f-stat .l { margin-top: 12px; font-size: 26px; font-weight: 500; color: #fbeee2; letter-spacing: -.005em; text-shadow: 0 2px 16px rgba(0,0,0,.8); }
#film .f-stat i { display: block; height: 2px; margin: 16px auto 0; width: 62%; border-radius: 2px; background: linear-gradient(90deg, transparent, #ffd27a, #ff5a1f, transparent);
  transform: scaleX(0); transition: transform 1.4s .3s cubic-bezier(.2,.8,.2,1); }
#film .f-stat.on i { transform: scaleX(1); }
#film .f-stat.plate { padding: 22px 34px 20px; border-radius: 20px; background: linear-gradient(135deg, rgba(20,12,8,.9), rgba(8,8,12,.84));
  border: 1px solid rgba(255,140,60,.32); box-shadow: 0 18px 60px -12px rgba(0,0,0,.8), 0 0 50px -20px rgba(255,90,20,.6); }
#film .f-spot { position: absolute; left: 0; top: 0; width: 0; height: 0; opacity: 0; border-radius: 14px; border: 2px solid rgba(255,200,130,.95);
  box-shadow: 0 0 0 4000px rgba(4,3,3,.58), 0 0 26px 2px rgba(255,122,31,.75), inset 0 0 18px rgba(255,122,31,.35); }
#film .f-card { position: absolute; inset: 0; display: grid; place-items: center; text-align: center; opacity: 0; transition: opacity 1.2s;
  background: radial-gradient(ellipse at 50% 60%, #2a0f05 0%, #0b0606 55%, #030304 100%); }
#film .f-card.on { opacity: 1; }
#film .f-card h1 { margin: 0; font-size: 150px; font-weight: 700; letter-spacing: -.06em; line-height: 1; background: linear-gradient(180deg, #fff3d6 0%, #ffb36b 45%, #ff5a1f 100%);
  -webkit-background-clip: text; color: transparent; filter: drop-shadow(0 0 40px rgba(255,90,20,.5)); transform: scale(.94); transition: transform 6s cubic-bezier(.1,.6,.2,1); }
#film .f-card.on h1 { transform: none; }
#film .f-card h1 span { color: transparent; }
#film .f-card p { margin: 14px 0 0; font-size: 24px; color: #f6e8da; }
#film .f-card .src { margin-top: 34px; font: 500 14px/1.6 'JetBrains Mono', monospace; letter-spacing: .1em; text-transform: uppercase; color: #c9a88e; }
#film .f-card .url { margin-top: 18px; font: 600 18px/1 'JetBrains Mono', monospace; color: #ffb36b; }
#film .f-card .embers { position: absolute; inset: 0; }
`;
document.head.appendChild(style);

const root = document.createElement('div');
root.id = 'film';
// Page space (zooms with the camera): the spotlight, the cursor, click ripples.
// Frame space (.f-hud, counter-scaled to the crop, so it stays put on screen): everything else.
root.innerHTML = `
  <div class="f-spot"></div>
  <div class="f-hud">
    <div class="f-vig"></div>
    <div class="f-chip"><span class="n"></span><div><div class="k"></div><div class="t"></div></div></div>
    <div class="f-card"><canvas class="embers"></canvas><div><h1>Ember<span>line</span></h1><p></p><div class="src"></div><div class="url"></div></div></div>
    <canvas class="f-burn"></canvas>
    <canvas class="f-embers"></canvas>
    <div class="f-stats"></div>
    <div class="f-bar top"></div><div class="f-bar bot"></div>
    <div class="f-black"></div>
  </div>
  <div class="f-cursor" style="opacity:0">
    <svg class="arrow" viewBox="0 0 30 30"><path d="M5 3 L5 24 L10.5 18.8 L14.2 27 L18 25.3 L14.4 17.3 L21.5 17.3 Z" fill="#fff" stroke="#14110f" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <svg class="hand" viewBox="0 0 30 30"><path d="M11 13 V5.5 a2 2 0 0 1 4 0 V12 M15 11.5 a2 2 0 0 1 4 0 V13 M19 12.5 a2 2 0 0 1 4 0 V18 c0 5 -3 8.5 -7.5 8.5 h-1 c-3 0 -4.6 -1.3 -6.3 -3.8 L4.6 17.6 a2 2 0 0 1 3.2 -2.3 L11 18.5" fill="#fff" stroke="#14110f" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" transform="translate(-6 -2)"/></svg>
  </div>`;
document.body.appendChild(root);
const $ = (s) => root.querySelector(s);
const hud = $('.f-hud'), cursorEl = $('.f-cursor'), black = $('.f-black'), spotEl = $('.f-spot');
const bars = [$('.f-bar.top'), $('.f-bar.bot')];
// The arrow's tip sits at (5, 3) in its 30 px box; the hand's fingertip lands about there too
const hand = cursorEl.querySelector('.hand');
hand.style.transform = 'translate(0, 0)';

// ------------------------------------------------------------------ film state
const F = {
  t: 0, done: false, scene: null, sceneAt: [],
  cursor: { x: W * 0.82, y: H * 0.88, shown: false, down: false },
  cam: { cx: W / 2, cy: H / 2, z: 1 },
  spot: { x: W / 2, y: H / 2, w: 0, h: 0, o: 0 }, bars: 0, keySeed: 11,
  tasks: [], events: [], sfx: [], voiced: [], voiceEnd: 0, lines: [], durations: {}, marks: {}, current: null,
};

// ------------------------------------------------------------------ targets
/** A screen point for a selector, element, [x, y], { lngLat } or { rect }. */
export function point(target, { dx = 0, dy = 0, ax = 0.5, ay = 0.5 } = {}) {
  if (Array.isArray(target)) return [target[0] + dx, target[1] + dy];
  if (target?.lngLat) { const p = E.map.project(target.lngLat); return [p.x + dx, p.y + dy]; }
  const r = rect(target);
  return [r.left + r.width * ax + dx, r.top + r.height * ay + dy];
}
export function rect(target) {
  if (target?.rect) return target.rect;
  const el = typeof target === 'string' ? document.querySelector(target) : target;
  if (!el) throw new Error(`film: nothing on screen matches ${target}`);
  return el.getBoundingClientRect();
}

// ------------------------------------------------------------------ the toolkit scenes use
const f = {
  E, W, H,
  get t() { return F.t; },
  /** Run a generator alongside the scene (camera moves, cursor drifts). */
  spawn(gen) { F.tasks.push({ gen, wake: F.t }); },
  *wait(s) { yield s; },
  /** Wait (in film time) until a condition holds, checking every frame. */
  *waitFor(pred, max = 60) { const t0 = F.t; while (!pred() && F.t - t0 < max) yield 0; },
  /** Hold the clock until something loading in real time arrives (a fetch, a dataset). Film time stops. */
  *until(pred) { if (!pred()) yield { until: pred }; },
  *tween(dur, fn, ease = inOut) {
    const t0 = F.t;
    for (;;) { const k = clamp((F.t - t0) / dur, 0, 1); fn(ease(k)); if (k >= 1) return; yield 0; }
  },
  sfx(kind, opts = {}) { F.sfx.push({ kind, at: F.t, ...opts }); },
  /** Music and fire-bed levels (0–1), eased by sound.py from one mark to the next. */
  music(level, over = 2) { f.sfx('music', { level, over }); },
  fire(level, over = 2) { f.sfx('fire', { level, over }); },

  // ---- cursor
  showCursor(on = true) { F.cursor.shown = on; },
  place(target) { [F.cursor.x, F.cursor.y] = point(target); },
  *move(target, { dur = 0.9, arc = 0.12, ...opts } = {}) {
    F.cursor.shown = true;
    const [x0, y0] = [F.cursor.x, F.cursor.y];
    const [x1, y1] = typeof target === 'function' ? target() : point(target, opts);
    // A gentle arc, bowing to one side of the straight line, the way a hand moves a mouse
    const d = Math.hypot(x1 - x0, y1 - y0);
    const [cx, cy] = [(x0 + x1) / 2 - ((y1 - y0) / (d || 1)) * d * arc, (y0 + y1) / 2 + ((x1 - x0) / (d || 1)) * d * arc];
    yield* f.tween(Math.max(0.25, dur * (0.55 + Math.min(1, d / 900) * 0.45)), (k) => {
      F.cursor.x = (1 - k) ** 2 * x0 + 2 * (1 - k) * k * cx + k * k * x1;
      F.cursor.y = (1 - k) ** 2 * y0 + 2 * (1 - k) * k * cy + k * k * y1;
    });
  },
  *click() {
    F.events.push('down'); F.cursor.down = true; f.sfx('click', { down: true, x: F.cursor.x / W }); ripple();
    yield 0.09;
    F.events.push('up'); F.cursor.down = false; f.sfx('click', { down: false, x: F.cursor.x / W });
    yield 0.05;
  },
  *clickOn(target, opts = {}) { yield* f.move(target, opts); yield opts.settle ?? 0.18; yield* f.click(); },
  *drag(from, to, { dur = 1.2, ...opts } = {}) {
    yield* f.move(from, opts);
    yield 0.15;
    F.events.push('down'); F.cursor.down = true; f.sfx('click', { down: true, x: F.cursor.x / W });
    yield 0.12;
    const [x0, y0] = [F.cursor.x, F.cursor.y];
    const [x1, y1] = typeof to === 'function' ? to() : point(to);
    yield* f.tween(dur, (k) => { F.cursor.x = lerp(x0, x1, k); F.cursor.y = lerp(y0, y1, k); });
    yield 0.1;
    F.events.push('up'); F.cursor.down = false; f.sfx('click', { down: false, x: F.cursor.x / W });
  },

  /** Scroll a panel by `by` px (or until `into` is fully on screen), easing like a trackpad flick. */
  *scroll(panel, { by = null, into = null, margin = 40, dur = 0.9 } = {}) {
    const el = typeof panel === 'string' ? document.querySelector(panel) : panel;
    if (into) { const r = rect(into); by = Math.max(0, r.bottom - (H - margin)) || Math.min(0, r.top - margin); }
    const from = el.scrollTop, to = clamp(from + (by ?? 0), 0, el.scrollHeight - el.clientHeight);
    if (Math.abs(to - from) < 1) return;
    f.sfx('whoosh', { dur: dur * 0.8, dir: 1 });
    yield* f.tween(dur, (k) => { el.scrollTop = lerp(from, to, k); });
  },

  // ---- keyboard
  /** Type into whatever has focus, one real keystroke at a time (render.py presses the keys). */
  *type(text, { cps = 13 } = {}) {
    for (const ch of text) {
      F.events.push({ key: ch });
      f.sfx('key', { x: F.cursor.x / W, space: ch === ' ' });
      F.keySeed = (F.keySeed * 16807) % 2147483647;
      yield (1 / cps) * (0.7 + 0.6 * (F.keySeed / 2147483647)) * (ch === ' ' ? 1.25 : 1);
    }
  },
  /** Press a named key (Enter, Escape…). */
  *press(key) { F.events.push({ key }); f.sfx('key', { x: F.cursor.x / W, space: true }); yield 0.12; },

  // ---- video camera (a crop of the page; 1 = the full frame)
  /** Move the camera to `target` at zoom z (no target: back out to the full frame). A new move replaces one in flight. */
  *zoom(target, { z = 1.3, dur = 1.3, whoosh = true, ...opts } = {}) {
    const [x, y] = !target ? [W / 2, H / 2] : typeof target === 'function' ? target() : point(target, opts);
    const job = (F.camJob = (F.camJob ?? 0) + 1);
    const from = { ...F.cam };
    const goal = target ? z : 1;
    if (whoosh && Math.abs(goal - from.z) > 0.04) f.sfx('whoosh', { dur, dir: goal > from.z ? 1 : -1 });
    const t0 = F.t;
    while (F.camJob === job) {
      const k = inOut(clamp((F.t - t0) / dur, 0, 1));
      F.cam.cx = lerp(from.cx, x, k); F.cam.cy = lerp(from.cy, y, k); F.cam.z = lerp(from.z, goal, k);
      if (k >= 1) return;
      yield 0;
    }
  },
  zoomTo(target, opts) { f.spawn(f.zoom(target, opts)); },
  zoomOut(opts = {}) { f.spawn(f.zoom(null, opts)); },

  // ---- narration
  /** Start a line (its key in the scene's `lines`). The scene goes on while it is spoken. */
  say(key) {
    const line = F.lines.find((l) => l.id === `${F.scene.id}.${key}`);
    if (!line) throw new Error(`film: no line ${F.scene.id}.${key}`);
    const dur = F.durations[line.text] ?? 0;
    F.current = { ...line, at: F.t, end: F.t + dur, marks: F.marks[line.text] };
    F.voiced.push({ id: line.id, text: line.text, scene: F.scene.id, at: F.t, end: F.t + dur });
    F.voiceEnd = F.t + dur;
  },
  /** Wait until the narrator finishes, plus `after` seconds. */
  *voice(after = 0) { if (F.voiceEnd + after > F.t) yield F.voiceEnd + after - F.t; },
  /** Wait until the narrator reaches a word of the current line. */
  *word(w) {
    const c = F.current;
    const at = c?.marks ? cueTime(c.sentences, c.marks, w) : null;
    if (at !== null && c.at + at > F.t) yield c.at + at - F.t;
  },

  // ---- motion graphics
  /**
   * A big number that counts up, with a kicker above and a label below, centred on `at` (frame px).
   * Stays `hold` seconds (null: until f.clearStats()). A riser plays while it counts and a hit when it lands.
   */
  stat({ value, from = 0, label = '', kicker = '', at = [W / 2, H / 2], size = 120, dur = 1.8, hold = 4.5, format = null, plate = false, sound = true }) {
    const el = document.createElement('div');
    el.className = `f-stat${plate ? ' plate' : ''}`;
    el.style.left = `${at[0]}px`; el.style.top = `${at[1]}px`;
    el.innerHTML = `${kicker ? '<div class="k"></div>' : ''}<div class="v"></div>${label ? '<div class="l"></div>' : ''}<i></i>`;
    if (kicker) el.querySelector('.k').textContent = kicker;
    if (label) el.querySelector('.l').textContent = label;
    const v = el.querySelector('.v');
    v.style.fontSize = `${size}px`;
    const fmt = format ?? ((n) => Math.round(n).toLocaleString('en-CA'));
    v.textContent = fmt(from);
    $('.f-stats').appendChild(el);
    void el.offsetWidth;
    el.classList.add('on');
    if (sound) { f.sfx('riser', { dur }); f.sfx('hit', { at: F.t + dur }); }
    f.spawn((function* () {
      yield* f.tween(dur, (k) => { v.textContent = fmt(from + (value - from) * k); }, (k) => 1 - (1 - k) ** 4);
      if (hold == null) return;
      yield hold;
      hideStat(el);
    }()));
    return el;
  },
  clearStats() { for (const el of root.querySelectorAll('.f-stat:not(.off)')) hideStat(el); },

  /** Dim the frame around a control, with a glowing outline that glides from wherever it was. */
  spot(target, { pad = 10, dur = 0.6 } = {}) {
    const r = rect(target);
    const goal = { x: r.left - pad, y: r.top - pad, w: r.width + pad * 2, h: r.height + pad * 2, o: 1 };
    const from = F.spot.o > 0.05 ? { ...F.spot } : { ...goal, x: goal.x - 30, y: goal.y - 30, w: goal.w + 60, h: goal.h + 60, o: 0 };
    spotTo(goal, from, dur);
  },
  spotOff(dur = 0.5) { spotTo({ ...F.spot, o: 0 }, { ...F.spot }, dur); },

  /** Cinema bars in (true) or out. */
  letterbox(on = true, dur = 1.2) { const b = F.bars; f.spawn(f.tween(dur, (k) => { F.bars = lerp(b, on ? 1 : 0, k); })); },

  /**
   * A fire front, shaped by noise, that burns the frame to black ('cover') or burns away from it
   * ('reveal'), spreading from `origin` (0–1 of the frame), with a roar under it.
   */
  *burn(mode = 'reveal', { dur = 1.6, origin = [0.5, 0.5], sound = true } = {}) {
    if (sound) f.sfx('burn', { dur, dir: mode === 'reveal' ? -1 : 1 });
    yield* f.tween(dur, (k) => drawBurn(mode, k, origin), (k) => k);
  },
  /** The frame black at once, ready for a burn reveal (the cold open starts here). */
  cover() { drawBurn('cover', 1, [0.5, 0.5]); },

  /** Embers rising over the whole frame (above a burn cover), fading in or out. */
  embers(on = true, dur = 1.5) {
    const c = $('canvas.f-embers');
    if (on && !c.dataset.live) { c.dataset.live = '1'; startEmbers(c, () => c.dataset.live === '1'); }
    const o0 = Number(c.style.opacity || 0);
    f.spawn((function* () {
      yield* f.tween(dur, (k) => { c.style.opacity = String(lerp(o0, on ? 1 : 0, k)); });
      if (!on) delete c.dataset.live;
    }()));
  },

  // ---- titles
  chip(n, kicker, title, hold = 5) {
    $('.f-chip .n').textContent = n; $('.f-chip .k').textContent = kicker; $('.f-chip .t').textContent = title;
    const el = $('.f-chip');
    el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
    f.spawn((function* () { yield hold; el.classList.remove('on'); }()));
  },
  *fade(to, dur = 1) { const from = Number(black.style.opacity || 0); yield* f.tween(dur, (k) => { black.style.opacity = lerp(from, to, k); }); },
  endCard({ line = '', sources = '', url = '' }) {
    $('.f-card p').textContent = line; $('.f-card .src').textContent = sources; $('.f-card .url').textContent = url;
    $('.f-card').classList.add('on');
    startEmbers($('.f-card .embers'));
  },
};

function ripple() {
  const r = document.createElement('div');
  r.className = 'f-ripple';
  r.style.left = `${F.cursor.x}px`; r.style.top = `${F.cursor.y}px`;
  root.appendChild(r);
  f.spawn((function* () { yield 0.8; r.remove(); }()));
}

/** Glide the spotlight; a newer glide replaces one in flight. */
function spotTo(goal, from, dur) {
  const job = (F.spotJob = (F.spotJob ?? 0) + 1);
  f.spawn((function* () {
    const t0 = F.t;
    while (F.spotJob === job) {
      const k = inOut(clamp((F.t - t0) / dur, 0, 1));
      for (const key in goal) F.spot[key] = lerp(from[key], goal[key], k);
      if (k >= 1) return;
      yield 0;
    }
  }()));
}

function hideStat(el) {
  el.classList.remove('on'); el.classList.add('off');
  f.spawn((function* () { yield 0.8; el.remove(); }()));
}

// ------------------------------------------------------------------ burn transition
// A low-resolution field (value noise plus distance from the origin) is thresholded each frame: behind the
// front the frame is burnt through, a thin band at the front glows from white-hot to deep red, and ahead of
// it is black. It is drawn small and scaled up, so the edges come out soft, then again blurred for the glow.
const BW = 320, BH = 180, EDGE = 0.075;
const burnCanvas = $('canvas.f-burn');
const burnSmall = Object.assign(document.createElement('canvas'), { width: BW, height: BH });
const burnPixels = burnSmall.getContext('2d').createImageData(BW, BH);
const noiseField = (() => {
  let s = 1959;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = new Float32Array(BW * BH);
  for (let oct = 0, cell = 80, amp = 1; oct < 4; oct++, cell /= 2, amp /= 2) {
    const gw = Math.ceil(BW / cell) + 2;
    const grid = Array.from({ length: gw * (Math.ceil(BH / cell) + 2) }, rnd);
    for (let y = 0; y < BH; y++) for (let x = 0; x < BW; x++) {
      const gx = x / cell, gy = y / cell, ix = Math.floor(gx), iy = Math.floor(gy);
      const sx = (gx - ix) ** 2 * (3 - 2 * (gx - ix)), sy = (gy - iy) ** 2 * (3 - 2 * (gy - iy));
      const g = (i, j) => grid[(iy + j) * gw + ix + i];
      out[y * BW + x] += amp * lerp(lerp(g(0, 0), g(1, 0), sx), lerp(g(0, 1), g(1, 1), sx), sy);
    }
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of out) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  return out.map((v) => (v - lo) / (hi - lo));
})();

function drawBurn(mode, p, origin) {
  const dpr = devicePixelRatio;
  if (burnCanvas.width !== Math.round(W * dpr)) { burnCanvas.width = Math.round(W * dpr); burnCanvas.height = Math.round(H * dpr); }
  const c = burnCanvas.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, burnCanvas.width, burnCanvas.height);
  if (mode === 'reveal' ? p >= 1 : p <= 0) return; // fully clear
  const d = burnPixels.data;
  const [ox, oy] = [origin[0] * BW, origin[1] * BH];
  const far = Math.max(...[[0, 0], [BW, 0], [0, BH], [BW, BH]].map(([x, y]) => Math.hypot((x - ox) * 0.75, y - oy)));
  const th = p * (1 + EDGE) - EDGE;
  for (let i = 0; i < BW * BH; i++) {
    const x = i % BW, y = (i / BW) | 0;
    const v = 0.55 * noiseField[i] + 0.45 * (Math.hypot((x - ox) * 0.75, y - oy) / far);
    // k: 0 on the burnt side of the front, 1 on the black side
    let k = mode === 'reveal' ? (v - th) / EDGE : (th + EDGE - v) / EDGE;
    const j = i * 4;
    if (k <= 0) { d[j + 3] = 0; continue; }
    if (k >= 1) { d[j] = d[j + 1] = d[j + 2] = 0; d[j + 3] = 255; continue; }
    k = Math.sqrt(k);
    d[j] = 255 * (1 - k * 0.55); d[j + 1] = 235 * (1 - k) ** 1.4; d[j + 2] = 160 * (1 - k) ** 3;
    d[j + 3] = 255 * Math.min(1, 0.35 + k * 1.2);
  }
  burnSmall.getContext('2d').putImageData(burnPixels, 0, 0);
  c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(burnSmall, 0, 0, burnCanvas.width, burnCanvas.height);
  // The glow: the same picture blurred and added (black adds nothing, so only the front brightens)
  c.globalCompositeOperation = 'lighter';
  c.filter = `blur(${10 * dpr}px)`;
  c.globalAlpha = 0.9;
  c.drawImage(burnSmall, 0, 0, burnCanvas.width, burnCanvas.height);
  c.filter = 'none'; c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
}

/** Embers rising (behind the end card, or over the cold open): seeded, and stepped by the film clock. */
function startEmbers(canvas, alive = () => true) {
  const dpr = devicePixelRatio;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d');
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts = Array.from({ length: 140 }, () => ({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 2.2, v: 14 + rnd() * 40, ph: rnd() * 6 }));
  f.spawn((function* () {
    let last = F.t;
    while (alive()) {
      const dt = F.t - last; last = F.t;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);
      c.globalCompositeOperation = 'lighter';
      for (const p of parts) {
        p.y -= p.v * dt; p.x += Math.sin(F.t * 0.9 + p.ph) * 12 * dt;
        if (p.y < -10) { p.y = H + 10; p.x = rnd() * W; }
        const a = 0.5 + 0.4 * Math.sin(F.t * 7 + p.ph * 5);
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r * 4);
        g.addColorStop(0, `rgba(255,220,150,${a})`); g.addColorStop(0.4, `rgba(255,120,30,${a * 0.6})`); g.addColorStop(1, 'rgba(255,60,20,0)');
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, p.r * 4, 0, Math.PI * 2); c.fill();
      }
      yield 0;
    }
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, canvas.width, canvas.height);
  }()));
}

// Every lightning strike the replay draws is heard in the film as thunder
if (E.sound?.thunder) {
  const thunder = E.sound.thunder.bind(E.sound);
  E.sound.thunder = (intensity = 0.6) => { if (F.scene) f.sfx('thunder', { intensity }); return thunder(intensity); };
}

// ------------------------------------------------------------------ the scheduler
let scenes = null;

function* master() {
  for (const scene of scenes) {
    F.scene = scene;
    F.sceneAt.push({ id: scene.id, at: F.t });
    yield* scene.run(f);
  }
  F.done = true;
}

function runTasks() {
  for (let pass = 0; pass < 50; pass++) {
    let ran = false;
    for (const task of [...F.tasks]) {
      if (task.until || task.wake > F.t + 1e-6) continue;
      ran = true;
      const { value, done } = task.gen.next();
      if (done) { F.tasks.splice(F.tasks.indexOf(task), 1); continue; }
      if (value && typeof value === 'object' && value.until) task.until = value.until;
      else task.wake = F.t + (value > 0 ? value : 1e-4); // `yield 0` is the next frame
    }
    if (!ran) return;
  }
}

function cropRect() {
  const z = Math.max(1, F.cam.z);
  const w = W / z, h = H / z;
  return { x: clamp(F.cam.cx - w / 2, 0, W - w), y: clamp(F.cam.cy - h / 2, 0, H - h), width: w, height: h };
}

function draw() {
  const c = cropRect();
  hud.style.transform = `translate(${c.x}px, ${c.y}px) scale(${c.width / W})`;
  const sp = F.spot;
  spotEl.style.opacity = String(sp.o);
  spotEl.style.transform = `translate(${sp.x}px, ${sp.y}px)`;
  spotEl.style.width = `${sp.w}px`; spotEl.style.height = `${sp.h}px`;
  for (const b of bars) b.style.height = `${F.bars * BAR}px`;
  const { x, y, shown, down } = F.cursor;
  cursorEl.style.opacity = shown ? '1' : '0';
  cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  cursorEl.classList.toggle('down', down);
  const under = shown ? document.elementFromPoint(x, y) : null;
  cursorEl.classList.toggle('hand', !!under?.closest(CLICKABLE));
}

window.Film = {
  /** True once the app has its data, spread list and live picture, and the fonts are in. */
  ready() {
    const s = E.state;
    return !document.querySelector('#enter').disabled && s.story && s.spreadList && s.live && document.fonts.status === 'loaded';
  },
  /** The narration, as { id, text, sentences }, built from the loaded record (async: it reads /api/provenance). */
  async script(opts = {}) {
    // The ring summary is counted the way the Sources view counts its header, from the server's provenance
    const provenance = await fetch('/api/provenance').then((r) => (r.ok ? r.json() : null)).catch(() => null);
    scenes = buildScenes(f, { ...opts, provenance });
    F.lines = scenes.flatMap((s) => Object.entries(s.lines).map(([k, text]) => ({ id: `${s.id}.${k}`, text, sentences: splitSentences(text) })));
    return F.lines;
  },
  /** Start filming, with the voice manifest's clips (keyed by line text). */
  start(clips = {}) {
    for (const [text, c] of Object.entries(clips)) { F.durations[text] = c.duration; F.marks[text] = c.marks; }
    F.tasks = [{ gen: master(), wake: 0 }];
    draw();
  },
  /** Advance one frame. Returns the mouse, its and the keyboard's events, the crop to capture, and whether the film is over. */
  step(ms) {
    for (const task of F.tasks) if (task.until?.()) { task.until = null; task.wake = F.t; }
    if (F.tasks.some((task) => task.until)) { clock.redraw(); return { wait: true, scene: F.scene?.id }; }
    clock.advance(ms);
    F.t += ms / 1000;
    runTasks();
    draw();
    return { mouse: [F.cursor.x, F.cursor.y], events: F.events.splice(0), crop: cropRect(), scene: F.scene?.id ?? null, done: F.done, t: F.t };
  },
  /** Everything sound.py and the write-ups need. */
  timeline() {
    return {
      total: F.t, voiced: F.voiced, sfx: F.sfx,
      scenes: F.sceneAt.map((s) => { const sc = scenes.find((x) => x.id === s.id); return { ...s, title: sc.title, shows: sc.shows }; }),
      facts: scenes.facts,
    };
  },
};
