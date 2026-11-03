// film/clock.js: the virtual clock the explainer is filmed with (run in a stub window).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

function load() {
  const animations = [];
  const window = {
    setTimeout, clearTimeout, requestAnimationFrame: () => 0,
    document: { getAnimations: () => animations },
  };
  const context = vm.createContext({ window, performance: { now: () => 12345 }, Date: class extends Date {}, document: window.document });
  vm.runInContext(readFileSync(new URL('../film/clock.js', import.meta.url), 'utf8'), context);
  return { window, context, animations };
}

test('time only moves when the clock is advanced', () => {
  const { window, context } = load();
  assert.equal(context.performance.now(), 0);
  window.__clock.advance(40);
  assert.equal(context.performance.now(), 40);
  const d0 = context.Date.now();
  window.__clock.advance(1000);
  assert.equal(context.Date.now() - d0, 1000);
});

test('timers fire in order, at their own time, and intervals repeat', () => {
  const { window, context } = load();
  const seen = [];
  window.setTimeout(() => seen.push(['b', context.performance.now()]), 30);
  window.setTimeout(() => seen.push(['a', context.performance.now()]), 10);
  const id = window.setInterval(() => seen.push(['i', context.performance.now()]), 25);
  window.clearTimeout(window.setTimeout(() => seen.push(['cleared']), 5));
  window.__clock.advance(60);
  window.clearInterval(id);
  window.__clock.advance(100);
  assert.deepEqual(seen.map(([k, t]) => `${k}@${t}`), ['a@10', 'i@25', 'b@30', 'i@50']);
});

test('animation frames run once per advance, at the new time', () => {
  const { window } = load();
  const times = [];
  const loop = (t) => { times.push(t); window.requestAnimationFrame(loop); };
  window.requestAnimationFrame(loop);
  window.__clock.advance(33);
  window.__clock.advance(33);
  window.__clock.redraw();
  assert.deepEqual(times, [33, 66, 66]);
});

test('CSS animations are paused and set to the film clock', () => {
  const { window, animations } = load();
  const anim = { currentTime: 0, paused: false, finished: false, pause() { this.paused = true; }, finish() { this.finished = true; }, effect: { getComputedTiming: () => ({ endTime: 500 }) } };
  animations.push(anim);
  window.__clock.advance(100); // first seen now: starts at 100
  window.__clock.advance(200);
  assert.equal(anim.paused, true);
  assert.equal(anim.currentTime, 200);
  window.__clock.advance(400);
  assert.equal(anim.finished, true);
});
