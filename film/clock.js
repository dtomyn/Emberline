// film/clock.js: a virtual clock for filming Emberline one exact frame at a time.
//
// Injected by film/render.py before any page script runs. It replaces the page's sense of time
// (performance.now, Date.now, requestAnimationFrame, setTimeout, setInterval) with a clock that only
// moves when the renderer calls __clock.advance(ms). CSS transitions and animations are paused and
// set to the same clock through the Web Animations API. So every camera flight, counter, fade and
// ember lands on the same frame on every run, however slowly the frames are actually drawn.
// Network requests and MapLibre's workers still run in real time; the renderer waits for tiles.
(() => {
  const real = {
    now: performance.now.bind(performance), dateNow: Date.now, setTimeout: window.setTimeout.bind(window),
    clearTimeout: window.clearTimeout.bind(window), raf: window.requestAnimationFrame.bind(window),
  };
  const dateZero = real.dateNow();
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id → { fn, args, at, every }
  let frames = new Map();   // id → callback
  const anims = new WeakMap(); // Animation → virtual start time

  performance.now = () => now;
  Date.now = () => dateZero + now;
  window.setTimeout = (fn, ms = 0, ...args) => { const id = nextId++; timers.set(id, { fn, args, at: now + Math.max(0, Number(ms) || 0) }); return id; };
  window.setInterval = (fn, ms = 0, ...args) => { const id = nextId++; const every = Math.max(1, Number(ms) || 0); timers.set(id, { fn, args, at: now + every, every }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  window.requestAnimationFrame = (cb) => { const id = nextId++; frames.set(id, cb); return id; };
  window.cancelAnimationFrame = (id) => { frames.delete(id); };

  const run = (fn, args) => { try { typeof fn === 'function' ? fn(...args) : null; } catch (e) { setTimeoutReal(() => { throw e; }); } };
  const setTimeoutReal = (fn, ms = 0) => real.setTimeout(fn, ms);

  /** Fire every timer due up to `to`, in time order, moving the clock to each one as it fires. */
  function runTimers(to) {
    for (let guard = 0; guard < 10000; guard++) {
      let id = null, t = Infinity;
      for (const [k, v] of timers) if (v.at <= to && v.at < t) { t = v.at; id = k; }
      if (id === null) return;
      const timer = timers.get(id);
      now = Math.max(now, timer.at);
      if (timer.every) timer.at += timer.every; else timers.delete(id);
      run(timer.fn, timer.args);
    }
  }

  /** One animation frame at the current time: every waiting rAF callback once. */
  function runFrames() {
    const due = frames;
    frames = new Map();
    for (const cb of due.values()) run(cb, [now]);
  }

  /** CSS animations and transitions follow the virtual clock too. */
  function syncAnimations() {
    for (const a of document.getAnimations()) {
      if (!anims.has(a)) { anims.set(a, now); a.pause(); }
      const t = now - anims.get(a);
      const end = a.effect?.getComputedTiming().endTime;
      if (Number.isFinite(end) && t >= end) { a.finish(); continue; }
      a.currentTime = t;
    }
  }

  window.__clock = {
    real,
    get now() { return now; },
    /** Move time forward by ms and draw one frame there. */
    advance(ms) {
      const to = now + ms;
      runTimers(to);
      now = to;
      runFrames();
      syncAnimations();
      return now;
    },
    /** Draw again at the same moment (after tiles arrive, say), without moving time. */
    redraw() { runTimers(now); runFrames(); syncAnimations(); },
    /** Wait in real time (the page's own setTimeout is virtual). */
    sleep: (ms) => new Promise((r) => real.setTimeout(r, ms)),
  };
})();
