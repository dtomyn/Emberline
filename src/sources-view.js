// Sources view, "Read the rings": every source behind Emberline as a fire-scarred tree cross-section.
//
// Fire history in the boreal forest is read from tree rings: each ring is a year, and a fire that
// wounds the cambium leaves a scar in that year's ring that later rings slowly heal over. Here:
//   - each ring is a year of the record, widened by how many fires that year had;
//   - the largest fire seasons leave scars, in the ring of their year;
//   - record sources run as glowing increment bores through the rings of the years they cover;
//   - live feeds sit in the bark (the living layer), and everything else in a halo outside it.
// Opening it burns a front outward from the pith through every year. All counts come from
// /api/provenance and the catalogue in src/provenance.js; nothing here is written by hand.
import { CONFIG } from './config.js';
import { SOURCES, GROUPS, TRUTH, sourceYears, coverageOf, funnel, citation, describePing } from './provenance.js';
import { fmtInt, fmtHa } from './data.js';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TAU = Math.PI * 2;
const SCARS = 7;           // the largest fire seasons get a scar
const BURN_MS = 2600;      // front from pith to bark
const GROUP_WEIGHT = { record: 1.7, live: 1, scene: 0.85, made: 0.85, engine: 0.75 };
const calm = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const hexRgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const rgba = (h, a) => `rgba(${hexRgb(h).join(',')},${a})`;
const smooth = (x) => { const k = Math.max(0, Math.min(1, x)); return k * k * (3 - 2 * k); };

/**
 * @param {{ getFires: () => any[], getLive: () => any }} app
 *   getFires: the loaded historical fires (used when no server is running);
 *   getLive:  the current live payload, so the card can say which tier Live is on.
 */
export function createSourcesView(app) {
  const root = document.querySelector('#sources');
  const canvas = root.querySelector('#rings');
  const ctx = canvas.getContext('2d');
  const tip = root.querySelector('#rings-tip');
  const listEl = root.querySelector('#src-list');
  const cardEl = root.querySelector('#src-card');
  const S = {
    open: false, info: null, offline: false, selected: 'cnfdb', hover: null, hoverYear: null,
    openedAt: 0, raf: 0, wood: null, geo: null, slots: [], scars: [], embers: [], pulses: [], pings: {}, lastFocus: null,
  };

  // ------------------------------------------------------------ data
  async function loadInfo() {
    if (!CONFIG.staticDataUrl) {
      try {
        const res = await fetch(`${CONFIG.apiBase}/provenance`);
        if (res.ok) return res.json();
      } catch { /* fall through to what the browser already has */ }
    }
    // No server: rebuild per-year counts from the fires the page loaded
    S.offline = true;
    const per = new Map();
    for (const f of app.getFires()) {
      const y = per.get(f.year) ?? { year: f.year, fires: 0, ha: 0 };
      y.fires++; y.ha += f.size_ha; per.set(f.year, y);
    }
    const years = [...per.values()].sort((a, b) => a.year - b.year);
    const fires = app.getFires();
    return {
      sources: years.length ? [{ source: 'cnfdb', fires: fires.length, hectares: years.reduce((s, y) => s + y.ha, 0), min_year: years[0].year, max_year: years.at(-1).year }] : [],
      runs: [], years: { cnfdb: years }, spread: {}, snapshots: {}, voice: null,
    };
  }

  const primary = () => S.info.years.cnfdb ? 'cnfdb' : Object.keys(S.info.years)[0];
  const yearsOf = (src) => S.info.years[src] ?? [];
  const runOf = (src) => S.info.runs.find((r) => r.source === src);

  // ------------------------------------------------------------ geometry
  function layout() {
    const dpr = devicePixelRatio || 1;
    const { width: w, height: h } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    const narrow = w < 560;
    const R = Math.max(60, Math.min(w / 2 - (narrow ? 84 : 150), h / 2 - (narrow ? 40 : 58)));
    const G = { dpr, w, h, cx: w / 2, cy: h / 2, R, narrow, pith: R * 0.035, heart: R * 0.78, bark: R * 0.86, halo: R * 0.95, label: R * 1.06 };

    // Ring years span every record source; ring width grows with that year's fire count
    const spans = SOURCES.map((s) => sourceYears(s, S.info)).filter(Boolean);
    const y0 = Math.min(...spans.map((s) => s[0])), y1 = Math.max(...spans.map((s) => s[1]));
    const counts = new Map(yearsOf(primary()).map((y) => [y.year, y]));
    const maxFires = Math.max(1, ...[...counts.values()].map((y) => y.fires));
    const widths = [];
    for (let y = y0; y <= y1; y++) widths.push(0.3 + Math.sqrt((counts.get(y)?.fires ?? 0) / maxFires));
    const total = widths.reduce((a, b) => a + b, 0);
    G.y0 = y0; G.y1 = y1; G.edges = [G.pith];
    let acc = 0;
    for (const wd of widths) { acc += wd; G.edges.push(G.pith + (G.heart - G.pith) * (acc / total)); }
    G.counts = counts;
    S.geo = G;

    // Angular slots: groups in order around the trunk, weighted, with gaps between groups
    const gap = 0.5;
    const units = GROUPS.reduce((s, g) => s + SOURCES.filter((x) => x.group === g.id).length * GROUP_WEIGHT[g.id] + gap, 0);
    let a = -Math.PI * 0.94; // the record wedges open on the left, where their labels read well
    S.slots = [];
    for (const g of GROUPS) {
      for (const src of SOURCES.filter((x) => x.group === g.id)) {
        const span = (GROUP_WEIGHT[g.id] / units) * TAU;
        S.slots.push({ src, a0: a, a1: a + span, mid: a + span / 2 });
        a += span;
      }
      a += (gap / units) * TAU;
    }

    // Scars: the largest seasons, spread around the trunk by the golden angle
    const top = [...counts.values()].sort((p, q) => q.ha - p.ha).slice(0, SCARS);
    const maxHa = top[0]?.ha ?? 1;
    S.scars = top.map((y, i) => ({ ...y, angle: 0.6 + i * 2.39996, half: 0.05 + 0.07 * Math.sqrt(y.ha / maxHa) }));
    S.wood = paintWood();
  }

  const wobble = (a) => 1 + 0.011 * Math.sin(2 * a + 0.7) + 0.006 * Math.sin(3 * a + 2.1) + 0.0025 * Math.sin(7 * a + 4);
  const ringR = (i) => S.geo.edges[Math.max(0, Math.min(S.geo.edges.length - 1, i))];
  const yearR = (year) => ringR(year - S.geo.y0 + 1);
  const pt = (r, a) => [S.geo.cx + r * wobble(a) * Math.sin(a), S.geo.cy - r * wobble(a) * Math.cos(a)];

  function ringPath(c, r, from = 0, to = TAU, steps = 180) {
    const n = Math.max(8, Math.round(steps * (to - from) / TAU));
    for (let k = 0; k <= n; k++) {
      const [x, y] = pt(r, from + (to - from) * (k / n));
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
  }

  // The static wood: rings, grain, drying checks, scars and bark, painted once per resize
  function paintWood() {
    const G = S.geo;
    const off = document.createElement('canvas');
    off.width = canvas.width; off.height = canvas.height;
    const c = off.getContext('2d');
    c.scale(G.dpr, G.dpr);

    const body = c.createRadialGradient(G.cx - G.R * 0.2, G.cy - G.R * 0.25, 0, G.cx, G.cy, G.bark);
    body.addColorStop(0, '#6b4528'); body.addColorStop(0.5, '#3f2615'); body.addColorStop(0.85, '#2a180c'); body.addColorStop(1, '#170d07');
    c.beginPath(); ringPath(c, G.bark); c.fillStyle = body; c.fill();

    // Earlywood / latewood bands, the busiest years a little lighter
    const maxFires = Math.max(1, ...[...G.counts.values()].map((y) => y.fires));
    for (let i = G.edges.length - 1; i > 0; i--) {
      const f = (G.counts.get(G.y0 + i - 1)?.fires ?? 0) / maxFires;
      c.beginPath(); ringPath(c, G.edges[i]);
      c.fillStyle = `rgba(${150 + 60 * f},${95 + 40 * f},${55 + 20 * f},${0.05 + 0.1 * f})`;
      c.fill();
      c.beginPath(); ringPath(c, G.edges[i]);
      c.strokeStyle = `rgba(14,7,3,${(G.y0 + i - 1) % 10 === 9 ? 0.95 : 0.7})`;
      c.lineWidth = (G.y0 + i - 1) % 10 === 9 ? 1.6 : 0.9;
      c.stroke();
    }
    // Grain: short concentric strokes
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.lineWidth = 0.5;
    for (let k = 0; k < 900; k++) {
      const r = G.pith + rnd() * (G.heart - G.pith), a = rnd() * TAU, len = 0.05 + rnd() * 0.25;
      c.beginPath(); ringPath(c, r, a, a + len, 12);
      c.strokeStyle = `rgba(${rnd() > 0.5 ? '255,220,180' : '10,5,2'},${0.04 + rnd() * 0.06})`;
      c.stroke();
    }
    // Drying checks: thin radial cracks from the pith
    for (const a of [0.3, 1.9, 3.4, 4.6, 5.7]) {
      c.beginPath();
      const reach = G.heart * (0.35 + 0.4 * ((a * 7) % 1));
      for (let r = G.pith; r < reach; r += 3) {
        const [x, y] = pt(r, a + 0.02 * Math.sin(r * 0.15));
        r === G.pith ? c.moveTo(x, y) : c.lineTo(x, y);
      }
      c.strokeStyle = 'rgba(8,4,2,0.7)'; c.lineWidth = 1.1; c.stroke();
    }
    // Scars: a charred wound in the ring of the fire year that later rings heal over
    for (const s of S.scars) { c.beginPath(); scarPath(c, s); c.fillStyle = '#0b0605'; c.fill(); }
    // Bark: rough ridged band
    c.beginPath(); ringPath(c, G.bark); ringPath(c, G.heart + 1, TAU, 0);
    c.fillStyle = '#140c08'; c.fill();
    for (let k = 0; k < 260; k++) {
      const a = (k / 260) * TAU + rnd() * 0.01;
      const [x1, y1] = pt(G.heart + 2, a), [x2, y2] = pt(G.bark - rnd() * (G.bark - G.heart) * 0.5, a + 0.004);
      c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2);
      c.strokeStyle = `rgba(70,45,30,${0.25 + rnd() * 0.35})`; c.lineWidth = 1 + rnd() * 1.4; c.stroke();
    }
    c.beginPath(); ringPath(c, G.bark); c.strokeStyle = 'rgba(0,0,0,0.8)'; c.lineWidth = 2; c.stroke();
    return off;
  }

  function scarPath(c, s) {
    const i = s.year - S.geo.y0 + 1;
    const heal = Math.min(5, S.geo.edges.length - 1 - i);
    const rIn = ringR(i - 1) - 1, rOut = ringR(i + heal);
    const steps = 14;
    for (let k = 0; k <= steps; k++) {
      const r = rIn + (rOut - rIn) * (k / steps), hw = s.half * (1 - (k / steps) ** 0.8);
      const [x, y] = pt(r, s.angle - hw);
      k ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    for (let k = steps; k >= 0; k--) {
      const r = rIn + (rOut - rIn) * (k / steps), hw = s.half * (1 - (k / steps) ** 0.8);
      const [x, y] = pt(r, s.angle + hw);
      c.lineTo(x, y);
    }
    c.closePath();
  }

  // ------------------------------------------------------------ frame
  function frame(now) {
    if (!S.open) return;
    S.raf = requestAnimationFrame(frame);
    const G = S.geo;
    const t = calm() ? 1e9 : now - S.openedAt;
    const burn = smooth(t / BURN_MS);
    const front = G.pith + (G.bark - G.pith) * burn;
    const after = Math.max(0, t - BURN_MS);
    const c = ctx;
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    c.clearRect(0, 0, G.w, G.h);

    // Ember glow behind the trunk
    const halo = c.createRadialGradient(G.cx, G.cy, G.bark * 0.8, G.cx, G.cy, G.R * 1.25);
    halo.addColorStop(0, `rgba(255,90,30,${0.16 * burn})`); halo.addColorStop(1, 'rgba(255,60,20,0)');
    c.fillStyle = halo; c.fillRect(0, 0, G.w, G.h);

    // Wood, revealed by the burning front
    c.save();
    c.beginPath(); ringPath(c, front + 2); c.clip();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(S.wood, 0, 0);
    c.setTransform(G.dpr, 0, 0, G.dpr, 0, 0);
    c.restore();

    c.globalCompositeOperation = 'lighter';
    if (burn < 1) {
      c.beginPath(); ringPath(c, front);
      c.strokeStyle = 'rgba(255,190,90,0.9)'; c.lineWidth = 3; c.shadowColor = '#ff7a1f'; c.shadowBlur = 24; c.stroke();
      c.shadowBlur = 0;
      const year = Math.round(G.y0 + (G.y1 - G.y0) * Math.min(1, (front - G.pith) / (G.heart - G.pith)));
      root.querySelector('#rings-year').textContent = year;
    } else if (!S.spanShown) {
      S.spanShown = true;
      root.querySelector('#rings-year').textContent = `${G.y0}–${G.y1}`;
    }
    drawScars(c, front, now);
    drawBores(c, after, now);
    drawBark(c, after, now);
    drawHalo(c, after);
    drawPulses(c, now);
    drawEmbers(c, burn, now);
    c.globalCompositeOperation = 'source-over';
    drawYearHover(c);
    drawLabels(c, after);
  }

  function drawScars(c, front, now) {
    for (const s of S.scars) {
      const reach = ringR(s.year - S.geo.y0 + 1);
      if (front < reach) continue;
      s.litAt ??= calm() ? now - 1e6 : now;
      const passed = now - s.litAt;
      const flare = Math.exp(-passed / 500);                   // a hot flash as the front reaches it
      const breathe = 0.55 + 0.25 * Math.sin(now / 700 + s.angle * 3);
      c.beginPath(); scarPath(c, s);
      c.strokeStyle = `rgba(255,${120 + 110 * flare},${40 + 120 * flare},${0.8 * breathe + 0.4 * flare})`;
      c.lineWidth = 1.4 + 3 * flare;
      c.shadowColor = '#ff5a1f'; c.shadowBlur = 10 + 26 * flare;
      c.stroke();
      c.shadowBlur = 0;
      const [lx, ly] = pt(ringR(s.year - S.geo.y0 + 1) + 4, s.angle + s.half + 0.06);
      c.font = "600 10px 'JetBrains Mono', monospace";
      c.fillStyle = `rgba(255,${200 + 55 * flare},${150 + 100 * flare},${0.55 + 0.45 * flare})`;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.fillText(String(s.year), lx, ly);
      if (Math.random() < 0.03 * (calm() ? 0 : 1)) {
        const [x, y] = pt(reach, s.angle);
        S.embers.push({ x, y, vx: (Math.random() - 0.5) * 0.3, vy: -0.3 - Math.random() * 0.5, life: 1 });
      }
    }
  }

  function slotAlpha(slot, after, base) {
    const i = S.slots.indexOf(slot);
    const k = smooth((after - i * 45) / 400);
    const on = S.hover === slot.src.id || S.selected === slot.src.id;
    return k * (on ? 1 : base);
  }

  // Record sources: an increment bore from the first ring they cover to the last
  function drawBores(c, after, now) {
    for (const slot of S.slots.filter((s) => s.src.group === 'record')) {
      const span = sourceYears(slot.src, S.info);
      const a = slotAlpha(slot, after, 0.85);
      if (!a) continue;
      const on = S.hover === slot.src.id || S.selected === slot.src.id;
      if (!span) {  // optional source not loaded: a dashed empty wedge
        c.setLineDash([3, 4]);
        c.beginPath(); ringPath(c, S.geo.heart * 0.98, slot.a0 + 0.02, slot.a1 - 0.02, 40);
        c.strokeStyle = rgba(slot.src.color, 0.45 * a); c.lineWidth = 1.2; c.stroke();
        c.setLineDash([]);
        continue;
      }
      const r0 = yearR(span[0] - 1), r1 = yearR(span[1]);
      if (on) {   // the whole wedge lights up
        c.beginPath(); ringPath(c, r1, slot.a0, slot.a1, 40); ringPath(c, r0, slot.a1, slot.a0, 40); c.closePath();
        c.fillStyle = rgba(slot.src.color, 0.16 * a); c.fill();
      }
      const [x0, y0] = pt(r0, slot.mid), [x1, y1] = pt(r1, slot.mid);
      const g = c.createLinearGradient(x0, y0, x1, y1);
      g.addColorStop(0, rgba(slot.src.color, 0.25 * a)); g.addColorStop(1, rgba(slot.src.color, a));
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.strokeStyle = g; c.lineWidth = on ? 5 : 3.2; c.lineCap = 'round';
      c.shadowColor = slot.src.color; c.shadowBlur = on ? 18 : 8; c.stroke(); c.shadowBlur = 0;
      // a bead runs outward along the bore, year by year
      const k = ((now / 2600) + slot.mid) % 1;
      const [bx, by] = pt(r0 + (r1 - r0) * k, slot.mid);
      c.beginPath(); c.arc(bx, by, on ? 3.2 : 2.2, 0, TAU); c.fillStyle = rgba('#ffffff', 0.7 * a); c.fill();
      // decade ticks on the longest bore
      if (!S.geo.narrow && slot.src.dbSource === primary()) {
        c.font = `500 ${S.geo.narrow ? 9 : 10}px 'JetBrains Mono', monospace`;
        c.fillStyle = `rgba(255,230,200,${0.75 * a})`;
        c.textAlign = 'center'; c.textBaseline = 'middle';
        for (let y = Math.ceil(span[0] / 20) * 20; y <= span[1]; y += 20) {
          const [tx, ty] = pt(yearR(y) - 0.5 * (yearR(y) - yearR(y - 1)), slot.mid - 0.07);
          c.fillText(String(y), tx, ty);
        }
      }
    }
  }

  // Live feeds: glowing bands in the bark with a packet running along each
  function drawBark(c, after, now) {
    const G = S.geo;
    for (const slot of S.slots.filter((s) => s.src.group === 'live')) {
      const a = slotAlpha(slot, after, 0.75);
      if (!a) continue;
      const on = S.hover === slot.src.id || S.selected === slot.src.id;
      const live = 0.7 + 0.3 * Math.sin(now / 420 + slot.mid * 5);
      const r = (G.heart + G.bark) / 2;
      c.beginPath(); ringPath(c, r, slot.a0 + 0.015, slot.a1 - 0.015, 50);
      c.strokeStyle = rgba(slot.src.color, a * live * (slot.src.truth === 'simulated' ? 0.55 : 1));
      c.lineWidth = (G.bark - G.heart) * (on ? 0.75 : 0.5); c.lineCap = 'butt';
      if (slot.src.truth === 'simulated') c.setLineDash([4, 3]);
      c.shadowColor = slot.src.color; c.shadowBlur = on ? 22 : 10; c.stroke(); c.shadowBlur = 0; c.setLineDash([]);
      const k = ((now / 1500) + slot.mid) % 1;
      const [px, py] = pt(r, slot.a0 + (slot.a1 - slot.a0) * k);
      c.beginPath(); c.arc(px, py, 2.4, 0, TAU); c.fillStyle = `rgba(255,255,255,${0.85 * a})`; c.fill();
    }
  }

  // Scene, made-here and engine: arcs in a halo outside the bark
  function drawHalo(c, after) {
    for (const slot of S.slots.filter((s) => !['record', 'live'].includes(s.src.group))) {
      const a = slotAlpha(slot, after, 0.6);
      if (!a) continue;
      const on = S.hover === slot.src.id || S.selected === slot.src.id;
      c.beginPath(); ringPath(c, S.geo.halo, slot.a0 + 0.02, slot.a1 - 0.02, 40);
      c.strokeStyle = rgba(slot.src.color, a); c.lineWidth = on ? 6 : 3; c.lineCap = 'round';
      c.shadowColor = slot.src.color; c.shadowBlur = on ? 16 : 4; c.stroke(); c.shadowBlur = 0;
    }
  }

  function drawLabels(c, after) {
    const G = S.geo;
    const small = G.narrow;
    for (const slot of S.slots) {
      const a = slotAlpha(slot, after, 0.8);
      if (!a) continue;
      const on = S.hover === slot.src.id || S.selected === slot.src.id;
      const outer = slot.src.group === 'record' ? (sourceYears(slot.src, S.info) ? yearR(sourceYears(slot.src, S.info)[1]) : G.heart)
        : slot.src.group === 'live' ? G.bark : G.halo + 4;
      const [x0, y0] = pt(outer + 4, slot.mid), [x1, y1] = pt(G.label, slot.mid);
      c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
      c.strokeStyle = rgba(slot.src.color, 0.35 * a); c.lineWidth = 1; c.stroke();
      const right = Math.sin(slot.mid) >= 0;
      const tx = x1 + (right ? 5 : -5);
      c.textAlign = right ? 'left' : 'right'; c.textBaseline = 'middle';
      c.font = `${on ? 600 : 500} ${small ? 10 : 12.5}px 'Space Grotesk', system-ui, sans-serif`;
      c.fillStyle = on ? '#fff' : `rgba(243,239,233,${0.85 * a})`;
      c.fillText(slot.src.short ?? slot.src.name, tx, y1 - (small ? 0 : 6));
      if (small) continue;
      const span = sourceYears(slot.src, S.info);
      const sub = span ? `${span[0]}–${span[1]}` : slot.src.optional && slot.src.group === 'record' ? 'not loaded'
        : slot.src.group === 'live' ? (slot.src.truth === 'simulated' ? 'SIMULATED' : 'live') : TRUTH[slot.src.truth].toLowerCase();
      c.font = "400 10px 'JetBrains Mono', monospace";
      c.fillStyle = slot.src.truth === 'simulated' ? `rgba(201,184,255,${a})` : `rgba(154,149,142,${a})`;
      c.fillText(slot.src.truth === 'simulated' && span ? `${sub} · SIMULATED` : sub, tx, y1 + 8);
    }
  }

  function drawYearHover(c) {
    if (S.hoverYear == null) return;
    const i = S.hoverYear - S.geo.y0 + 1;
    c.beginPath(); ringPath(c, ringR(i)); ringPath(c, ringR(i - 1), TAU, 0);
    c.fillStyle = 'rgba(255,210,122,0.28)'; c.fill();
    c.beginPath(); ringPath(c, ringR(i)); c.strokeStyle = 'rgba(255,230,180,0.9)'; c.lineWidth = 1; c.stroke();
  }

  function drawEmbers(c, burn, now) {
    if (calm()) return;
    if (burn < 1 && Math.random() < 0.6) {
      const a = Math.random() * TAU, [x, y] = pt(S.geo.pith + (S.geo.bark - S.geo.pith) * burn, a);
      S.embers.push({ x, y, vx: Math.sin(a) * 0.4, vy: -0.4 - Math.random() * 0.8, life: 1 });
    }
    S.embers = S.embers.filter((e) => (e.life -= 0.012) > 0);
    for (const e of S.embers) {
      e.x += e.vx + Math.sin(now / 300 + e.y * 0.05) * 0.15; e.y += e.vy;
      c.beginPath(); c.arc(e.x, e.y, 1.6 * e.life + 0.4, 0, TAU);
      c.fillStyle = `rgba(255,${150 + 80 * e.life},80,${0.8 * e.life})`; c.fill();
    }
  }

  function drawPulses(c, now) {
    S.pulses = S.pulses.filter((p) => now - p.at < 1400);
    for (const p of S.pulses) {
      const k = (now - p.at) / 1400;
      const slot = S.slots.find((s) => s.src.id === p.id);
      if (!slot) continue;
      c.beginPath(); ringPath(c, S.geo.halo * (1 - k * 0.95), slot.a0 - k, slot.a1 + k, 60);
      c.strokeStyle = rgba(p.ok ? slot.src.color : '#ff5a36', 0.8 * (1 - k)); c.lineWidth = 2 + 4 * (1 - k); c.stroke();
    }
  }

  // ------------------------------------------------------------ hit testing
  function hit(ev) {
    const G = S.geo, r0 = canvas.getBoundingClientRect();
    const x = ev.clientX - r0.left - G.cx, y = ev.clientY - r0.top - G.cy;
    let a = Math.atan2(x, -y);
    const r = Math.hypot(x, y) / wobble(a);
    const slotAt = (group) => S.slots.find((s) => group.includes(s.src.group) && [a, a + TAU, a - TAU].some((v) => v >= s.a0 && v < s.a1));
    if (r > G.bark + 2 && r < G.label + 30) return { src: slotAt(['scene', 'made', 'engine', 'live', 'record'])?.src };
    if (r > G.heart && r <= G.bark + 2) return { src: slotAt(['live'])?.src };
    if (r <= G.heart && r > G.pith) {
      const slot = slotAt(['record']);
      const span = slot && sourceYears(slot.src, S.info);
      const near = slot && Math.abs(((a - slot.mid + Math.PI * 3) % TAU) - Math.PI) * r < 9;
      if (slot && span && near && r >= yearR(span[0] - 1) - 4 && r <= yearR(span[1]) + 4) return { src: slot.src };
      const i = G.edges.findIndex((e) => e >= r);
      if (i > 0) return { year: G.y0 + i - 1 };
    }
    return {};
  }

  function onMove(ev) {
    if (!S.geo) return;
    const h = hit(ev);
    S.hover = h.src?.id ?? null;
    S.hoverYear = h.year ?? null;
    canvas.style.cursor = h.src ? 'pointer' : 'default';
    if (h.year != null) {
      const y = S.geo.counts.get(h.year);
      const scar = S.scars.find((s) => s.year === h.year);
      const cov = coverageOf(h.year, S.info).map((s) => `<i style="--c:${s.color}"></i>${esc(s.short)}`).join('');
      tip.innerHTML = `<b>${h.year}</b>${scar ? ' <span class="scar">fire scar</span>' : ''}<br>${y ? `${fmtInt(y.fires)} fires · ${fmtHa(y.ha)} ha` : 'no fires in this database'}<div class="cov">${cov}</div>`;
    } else if (h.src) {
      tip.innerHTML = `<b>${esc(h.src.name)}</b><br><span>${esc(TRUTH[h.src.truth])} · click to read</span>`;
    }
    tip.hidden = !(h.year != null || h.src);
    const r0 = canvas.getBoundingClientRect();
    tip.style.left = `${Math.min(ev.clientX - r0.left + 14, r0.width - 220)}px`;
    tip.style.top = `${ev.clientY - r0.top + 14}px`;
  }

  // ------------------------------------------------------------ panel
  function renderList() {
    listEl.innerHTML = GROUPS.map((g) => `
      <div class="src-group"><h4>${esc(g.name)} <small>${esc(g.where)}</small></h4><div>
      ${SOURCES.filter((s) => s.group === g.id).map((s) => `
        <button type="button" data-id="${s.id}" style="--c:${s.color}" aria-pressed="${s.id === S.selected}">
          <i></i><span title="${esc(s.name)}">${esc(s.short)}</span><em class="t-${s.truth}">${esc(TRUTH[s.truth])}</em>
        </button>`).join('')}</div></div>`).join('');
  }

  function stats(src) {
    const I = S.info, rows = [];
    if (src.dbSource) {
      const s = I.sources.find((x) => x.source === src.dbSource);
      if (!s) rows.push(['In this database', `Not loaded. <code>${esc(src.loader)}</code> adds it.`]);
      else {
        rows.push(['In this database', `<b>${fmtInt(s.fires)}</b> fires, ${s.min_year}–${s.max_year}, ${fmtHa(s.hectares)} ha`]);
        const run = runOf(src.dbSource);
        if (run) rows.push(['Loaded', `${esc(run.finished_at?.slice(0, 16).replace('T', ' '))} UTC from <code>${esc(run.input.split(/[\\/]/).pop())}</code>`]);
      }
    }
    if (src.spread === 'perimeters') {
      const sp = I.spread;
      rows.push(['In this database', sp?.fires ? `<b>${fmtInt(sp.fires)}</b> perimeters of fires ≥ 10,000 ha, ${sp.minYear}–${sp.maxYear}, ${fmtHa(sp.ha)} ha (${fmtInt(sp.wfs ?? 0)} via WFS, ${fmtInt(sp.shp ?? 0)} via shapefile)` : `Not loaded. <code>${esc(src.loader)}</code> adds it.`]);
    }
    if (src.spread === 'hotspots') {
      const sp = I.spread;
      rows.push(['In this database', sp?.hotspots ? `<b>${fmtInt(sp.hotspots)}</b> detections inside those perimeters` : `Not loaded. <code>${esc(src.loader)}</code> adds it.`]);
      if (sp?.sensors?.length) rows.push(['By sensor', sp.sensors.map((x) => `${esc(x.sensor)} ${fmtInt(x.n)}`).join(' · ')]);
    }
    if (['spsa-incidents', 'cwfis-24h'].includes(src.id) && I.snapshots?.n) {
      rows.push(['Kept by Emberline', `${fmtInt(I.snapshots.n)} real live snapshots since ${esc(I.snapshots.first.slice(0, 10))}`]);
    }
    const live = app.getLive();
    if (src.group === 'live' && live?.label && src.id !== 'cldn' && src.id !== 'cwfis-m3' && src.id !== 'spsa-communities') {
      const using = (live.source === 'spsa' && src.id === 'spsa-incidents') || (live.source === 'cwfis' && src.id === 'cwfis-24h') || (live.simulated && src.id === 'live-sim');
      rows.push(['Live mode now', using ? `<b>In use:</b> ${esc(live.label)}` : `Standing by. In use: ${esc(live.label)}`]);
    }
    if (src.id === 'spsa-communities' && live?.communities?.length) rows.push(['Live mode now', `${fmtInt(live.communities.length)} communities loaded`]);
    if (src.voice) {
      rows.push(['In this build', I.voice ? `<b>${fmtInt(I.voice.clips)}</b> clips, ${esc(I.voice.engine)} · ${esc(I.voice.voice)}, made ${esc(I.voice.madeAt?.slice(0, 10))}` : 'No clips yet; the browser voice stands in (labelled).']);
    }
    return rows;
  }

  function renderCard() {
    const src = SOURCES.find((s) => s.id === S.selected);
    const run = src.dbSource ? runOf(src.dbSource) : src.spread ? runOf('spread') : null;
    const steps = funnel(run);
    const top = steps[0]?.n || 1;
    const ping = S.pings[src.id];
    const today = new Date().toISOString().slice(0, 10);
    cardEl.style.setProperty('--c', src.color);
    cardEl.innerHTML = `
      <p class="src-kicker">${esc(GROUPS.find((g) => g.id === src.group).name)} · <span class="t-${src.truth}">${esc(TRUTH[src.truth])}</span></p>
      <h3>${esc(src.name)}</h3>
      <p class="src-owner">${esc(src.owner)}</p>
      <p>${esc(src.gives)}</p>
      <dl class="src-facts">${stats(src).map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join('')}
        <dt>How</dt><dd>${esc(src.how)}</dd>
        <dt>Licence</dt><dd>${src.licence ? (src.licence.url ? `<a href="${esc(src.licence.url)}" target="_blank" rel="noopener">${esc(src.licence.name)}</a>` : esc(src.licence.name)) : 'None stated by the service.'}</dd>
      </dl>
      ${steps.length > 2 ? `<div class="funnel" aria-label="Rows read to rows loaded">${steps.map((s) => `
        <div class="${s.n < 0 ? 'cut' : ''}"><span>${esc(s.label)}</span><b>${s.n < 0 ? '−' : ''}${fmtInt(Math.abs(s.n))}</b>
        <i style="width:${Math.max(1.5, (Math.abs(s.n) / top) * 100)}%"></i></div>`).join('')}</div>` : ''}
      <p class="glabel">Exact request</p>
      <pre class="src-req">${esc(readable(src.request))}</pre>
      <div class="src-actions">
        ${src.page ? `<a class="ghost small" href="${esc(src.page)}" target="_blank" rel="noopener">Source page ↗</a>` : ''}
        ${src.ping ? `<button type="button" class="ghost small src-ping" ${S.offline ? 'disabled title="Needs the Emberline server"' : ''}>Ask the source now</button>` : ''}
        <button type="button" class="ghost small src-cite">Copy citation</button>
      </div>
      <p class="src-ping-out ${ping?.ok === false ? 'bad' : ''}" aria-live="polite">${ping ? esc(ping.pending ? 'Asking…' : describePing(ping)) : ''}</p>`;
    cardEl.querySelector('.src-ping')?.addEventListener('click', () => doPing(src));
    cardEl.querySelector('.src-cite').addEventListener('click', async (e) => {
      const text = citation(src, today);
      try { await navigator.clipboard.writeText(text); e.target.textContent = 'Copied'; } catch { prompt('Citation', text); }
    });
  }

  // Query strings shown decoded, so CQL filters read as written
  const readable = (req) => req.split('\n').map((line) => { try { return decodeURIComponent(line.replace(/\+/g, ' ')); } catch { return line; } }).join('\n');

  async function doPing(src) {
    S.pings[src.id] = { pending: true };
    renderCard();
    let out;
    try { out = await (await fetch(`${CONFIG.apiBase}/provenance/ping/${src.id}`)).json(); } catch (err) { out = { ok: false, ms: 0, error: err.message }; }
    S.pings[src.id] = out;
    S.pulses.push({ id: src.id, at: performance.now(), ok: out.ok });
    if (S.selected === src.id) renderCard();
  }

  function select(id) {
    S.selected = id;
    listEl.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === id)));
    renderCard();
    if (S.geo?.narrow) cardEl.scrollIntoView({ behavior: calm() ? 'auto' : 'smooth', block: 'start' });
  }

  function summary() {
    const I = S.info;
    const records = I.sources.filter((s) => s.source !== 'mock').reduce((sum, s) => sum + s.fires, 0) + (I.spread?.fires ?? 0) + (I.spread?.hotspots ?? 0);
    root.querySelector('#rings-sum').innerHTML = `<b>${SOURCES.length}</b> sources · <b>${fmtInt(records)}</b> real records loaded · <b>${S.geo.y1 - S.geo.y0 + 1}</b> rings · <b>0</b> data files in the repository`;
    root.querySelector('#rings-year').textContent = `${S.geo.y0}–${S.geo.y1}`;
    if (S.offline) root.querySelector('#rings-sum').innerHTML += ' · <span class="muted">offline: counts from the loaded file</span>';
  }

  // ------------------------------------------------------------ open / close
  function restart() {
    S.openedAt = performance.now();
    S.embers = [];
    S.spanShown = false;
    for (const sc of S.scars) delete sc.litAt;
  }

  async function open(id) {
    if (S.open) { if (id) select(id); return; }
    S.lastFocus = document.activeElement;
    S.open = true;
    root.hidden = false;
    document.body.classList.add('sources-open');
    requestAnimationFrame(() => root.classList.add('on'));
    if (!S.info) S.info = await loadInfo();
    if (!S.open) return;
    if (id) S.selected = id;
    renderList();
    layout();
    summary();
    renderCard();
    root.querySelector('.src-close').focus();
    restart();
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(frame);
  }

  function close() {
    if (!S.open) return;
    S.open = false;
    cancelAnimationFrame(S.raf);
    root.classList.remove('on');
    document.body.classList.remove('sources-open');
    setTimeout(() => { if (!S.open) root.hidden = true; }, 400);
    S.lastFocus?.focus?.();
  }

  // ------------------------------------------------------------ wiring
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerleave', () => { S.hover = null; S.hoverYear = null; tip.hidden = true; });
  canvas.addEventListener('click', (ev) => { const h = hit(ev); if (h.src) select(h.src.id); });
  listEl.addEventListener('click', (e) => { const b = e.target.closest('button[data-id]'); if (b) select(b.dataset.id); });
  listEl.addEventListener('pointerover', (e) => { S.hover = e.target.closest('button[data-id]')?.dataset.id ?? null; });
  listEl.addEventListener('pointerleave', () => { S.hover = null; });
  root.querySelector('.src-close').addEventListener('click', close);
  root.querySelector('#rings-replay').addEventListener('click', restart);
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    if (e.key === 'Tab') {  // keep focus inside while open
      const f = [...root.querySelectorAll('button:not([disabled]), a[href]')];
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f.at(-1).focus(); }
      else if (!e.shiftKey && document.activeElement === f.at(-1)) { e.preventDefault(); f[0].focus(); }
    }
  });
  addEventListener('resize', () => { if (S.open && S.info) layout(); });

  return { open, close, get isOpen() { return S.open; } };
}
