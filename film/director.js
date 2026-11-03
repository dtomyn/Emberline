// film/director.js: films the explainer inside the running app.
//
// film/render.py loads Emberline with film/clock.js (virtual time), then this module. The scenes in
// film/scenes.js are generator functions: they move a drawn cursor (the real mouse follows it, so
// hovers and clicks are the app's own), start narration lines, push a video camera in and out, and
// raise titles. render.py calls Film.step(ms) once per frame, performs the mouse events it returns,
// waits for map tiles, and captures the crop rectangle it returns. Sound effects and voice timings are
// collected here and mixed by film/sound.py afterwards.
import { cueTime, splitSentences } from '/src/narration.js';
import { buildScenes } from './scenes.js';

const E = window.emberline;
const clock = window.__clock;
const W = innerWidth, H = innerHeight;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, k) => a + (b - a) * k;
export const inOut = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2);
const CLICKABLE = 'button, a, [role=tab], input, select, label, .sl-row, .ybar, .threat, #track, #spread-track';

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
  filter: drop-shadow(0 0 30px rgba(255,100,20,.55)); font-variant-numeric: tabular-nums; }
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
root.innerHTML = `
  <div class="f-hud">
    <div class="f-chip"><span class="n"></span><div><div class="k"></div><div class="t"></div></div></div>
    <div class="f-card"><canvas class="embers"></canvas><div><h1>Ember<span>line</span></h1><p></p><div class="src"></div><div class="url"></div></div></div>
    <div class="f-black"></div>
  </div>
  <div class="f-cursor" style="opacity:0">
    <svg class="arrow" viewBox="0 0 30 30"><path d="M5 3 L5 24 L10.5 18.8 L14.2 27 L18 25.3 L14.4 17.3 L21.5 17.3 Z" fill="#fff" stroke="#14110f" stroke-width="1.6" stroke-linejoin="round"/></svg>
    <svg class="hand" viewBox="0 0 30 30"><path d="M11 13 V5.5 a2 2 0 0 1 4 0 V12 M15 11.5 a2 2 0 0 1 4 0 V13 M19 12.5 a2 2 0 0 1 4 0 V18 c0 5 -3 8.5 -7.5 8.5 h-1 c-3 0 -4.6 -1.3 -6.3 -3.8 L4.6 17.6 a2 2 0 0 1 3.2 -2.3 L11 18.5" fill="#fff" stroke="#14110f" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" transform="translate(-6 -2)"/></svg>
  </div>`;
document.body.appendChild(root);
const $ = (s) => root.querySelector(s);
// The camera's crop also draws the HUD, counter-scaled so titles stay the same size on screen
const hud = $('.f-hud'), cursorEl = $('.f-cursor'), black = $('.f-black');
// The arrow's tip sits at (5, 3) in its 30 px box; the hand's fingertip lands about there too
const hand = cursorEl.querySelector('.hand');
hand.style.transform = 'translate(0, 0)';

// ------------------------------------------------------------------ film state
const F = {
  t: 0, done: false, scene: null, sceneAt: [],
  cursor: { x: W * 0.82, y: H * 0.88, shown: false, down: false },
  cam: { cx: W / 2, cy: H / 2, z: 1 },
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

  // ---- video camera (a crop of the page; 1 = the full frame)
  *zoom(target, { z = 1.3, dur = 1.3, whoosh = true, ...opts } = {}) {
    const [x, y] = target ? point(target, opts) : [W / 2, H / 2];
    const from = { ...F.cam };
    const goal = target ? z : 1;
    if (whoosh && Math.abs(goal - from.z) > 0.04) f.sfx('whoosh', { dur, dir: goal > from.z ? 1 : -1 });
    yield* f.tween(dur, (k) => { F.cam.cx = lerp(from.cx, x, k); F.cam.cy = lerp(from.cy, y, k); F.cam.z = lerp(from.z, goal, k); });
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

/** Embers rising behind the end card: seeded, and stepped by the film clock. */
function startEmbers(canvas) {
  const dpr = devicePixelRatio;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const c = canvas.getContext('2d');
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const parts = Array.from({ length: 140 }, () => ({ x: rnd() * W, y: rnd() * H, r: 0.6 + rnd() * 2.2, v: 14 + rnd() * 40, ph: rnd() * 6 }));
  f.spawn((function* () {
    let last = F.t;
    for (;;) {
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
  /** The narration, as { id, text, sentences }, built from the loaded record. */
  script(opts = {}) {
    scenes = buildScenes(f, opts);
    F.lines = scenes.flatMap((s) => Object.entries(s.lines).map(([k, text]) => ({ id: `${s.id}.${k}`, text, sentences: splitSentences(text) })));
    return F.lines;
  },
  /** Start filming, with the voice manifest's clips (keyed by line text). */
  start(clips = {}) {
    for (const [text, c] of Object.entries(clips)) { F.durations[text] = c.duration; F.marks[text] = c.marks; }
    F.tasks = [{ gen: master(), wake: 0 }];
    draw();
  },
  /** Advance one frame. Returns the mouse, its events, the crop to capture, and whether the film is over. */
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
