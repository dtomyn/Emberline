// Lightweight, animated SVG/canvas charts. No chart library: each chart builds its DOM once
// and then only updates attributes, so CSS transitions do the animating.
import { CAUSES, MONTHS, SEASON_START_DOY, SEASON_END_DOY, fmtHa, fmtInt } from './data.js';

export const CAUSE_COLORS = ['#ffc23d', '#ff5a36', '#a99bff'];
const SVGNS = 'http://www.w3.org/2000/svg';
const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  parent?.appendChild(n);
  return n;
};

/** Cause donut: share of hectares (outer ring) and of ignitions (inner ring). */
export function createCauseDonut(container) {
  const svg = el('svg', { viewBox: '0 0 120 120', class: 'donut', role: 'img', 'aria-label': 'Share of fires by cause' }, container);
  const rings = [
    { r: 50, w: 10, key: 'ha' },
    { r: 36, w: 6, key: 'count' },
  ].map((ring) => {
    const c = 2 * Math.PI * ring.r;
    el('circle', { cx: 60, cy: 60, r: ring.r, fill: 'none', stroke: 'var(--track)', 'stroke-width': ring.w }, svg);
    const segs = CAUSES.map((_, i) =>
      el('circle', {
        cx: 60, cy: 60, r: ring.r, fill: 'none', stroke: CAUSE_COLORS[i], 'stroke-width': ring.w,
        'stroke-dasharray': `0 ${c}`, transform: 'rotate(-90 60 60)', class: 'seg',
      }, svg));
    return { ...ring, c, segs };
  });
  const label = el('text', { x: 60, y: 57, 'text-anchor': 'middle', class: 'donut-big' }, svg);
  const sub = el('text', { x: 60, y: 71, 'text-anchor': 'middle', class: 'donut-sub' }, svg);
  sub.textContent = 'from lightning';

  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = CAUSES.map((c, i) => `<span><i style="background:${CAUSE_COLORS[i]}"></i>${c} <b data-i="${i}">0%</b></span>`).join('');
  container.appendChild(legend);

  return (summary) => {
    for (const ring of rings) {
      const total = summary.byCause.reduce((s, b) => s + b[ring.key], 0) || 1;
      let acc = 0;
      ring.segs.forEach((seg, i) => {
        const frac = summary.byCause[i][ring.key] / total;
        const gap = frac > 0.02 ? 1.5 : 0;
        seg.setAttribute('stroke-dasharray', `${Math.max(0, frac * ring.c - gap)} ${ring.c}`);
        seg.setAttribute('stroke-dashoffset', `${-acc * ring.c}`);
        acc += frac;
      });
    }
    const haTotal = summary.ha || 1;
    label.textContent = `${Math.round((summary.byCause[0].ha / haTotal) * 100)}%`;
    legend.querySelectorAll('b').forEach((b) => {
      b.textContent = `${Math.round((summary.byCause[b.dataset.i].count / (summary.count || 1)) * 100)}%`;
    });
  };
}

/** Radial "fire clock": ignitions per month, as bars radiating from a ring. */
export function createFireClock(container) {
  const svg = el('svg', { viewBox: '0 0 160 160', class: 'clock', role: 'img', 'aria-label': 'Ignitions by month' }, container);
  const r0 = 26, rMax = 72;
  el('circle', { cx: 80, cy: 80, r: r0 - 4, fill: 'none', stroke: 'var(--track)', 'stroke-width': 1 }, svg);
  const bars = MONTHS.map((m, i) => {
    const a = (i / 12) * 2 * Math.PI - Math.PI / 2 + Math.PI / 12;
    const [cx, cy] = [Math.cos(a), Math.sin(a)];
    el('line', { x1: 80 + cx * r0, y1: 80 + cy * r0, x2: 80 + cx * rMax, y2: 80 + cy * rMax, stroke: 'var(--track)', 'stroke-width': 9, 'stroke-linecap': 'round' }, svg);
    const bar = el('line', {
      x1: 80 + cx * r0, y1: 80 + cy * r0, x2: 80 + cx * rMax, y2: 80 + cy * rMax,
      stroke: 'url(#clockGrad)', 'stroke-width': 9, 'stroke-linecap': 'round', 'stroke-dasharray': `0 999`, class: 'seg',
    }, svg);
    const t = el('text', { x: 80 + cx * (r0 - 12), y: 80 + cy * (r0 - 12) + 3, 'text-anchor': 'middle', class: 'clock-label' }, svg);
    t.textContent = m[0];
    return bar;
  });
  const defs = el('defs', {}, svg);
  const g = el('radialGradient', { id: 'clockGrad', cx: 80, cy: 80, r: rMax, gradientUnits: 'userSpaceOnUse' }, defs);
  el('stop', { offset: '30%', 'stop-color': '#ff3d1f' }, g);
  el('stop', { offset: '70%', 'stop-color': '#ff9a1f' }, g);
  el('stop', { offset: '100%', 'stop-color': '#ffe9a8' }, g);

  return (summary, highlightMonth = -1) => {
    const max = Math.max(1, ...summary.byMonth);
    bars.forEach((bar, i) => {
      const len = (summary.byMonth[i] / max) * (rMax - r0);
      bar.setAttribute('stroke-dasharray', `${len} 999`);
      bar.classList.toggle('now', i === highlightMonth);
    });
  };
}

/** Clickable bar chart of hectares burned per year. */
export function createYearBars(container, onPick) {
  container.classList.add('yearbars');
  let bars = [];
  return (yearly, activeYear) => {
    if (bars.length !== yearly.length) {
      container.innerHTML = '';
      bars = yearly.map((y) => {
        const b = document.createElement('button');
        b.className = 'ybar';
        b.innerHTML = `<span class="fill"></span><span class="yl">${String(y.year).slice(2)}</span>`;
        b.addEventListener('click', () => onPick(y.year));
        container.appendChild(b);
        return b;
      });
    }
    const max = Math.max(1, ...yearly.map((y) => y.ha));
    yearly.forEach((y, i) => {
      bars[i].querySelector('.fill').style.transform = `scaleY(${Math.max(0.02, y.ha / max)})`;
      bars[i].classList.toggle('active', y.year === activeYear);
      bars[i].title = `${y.year}: ${fmtInt(y.count)} fires · ${fmtHa(y.ha)} ha`;
      bars[i].setAttribute('aria-label', bars[i].title);
    });
  };
}

/**
 * Season-axis timeline: every fire season (Apr–Oct) side by side, weekly hectares as glowing bars.
 * Returns { draw(weekly, ys), xForT(year, doy) }.
 */
export function createTimelineCanvas(canvas) {
  const ctx = canvas.getContext('2d');
  let last = null;
  const draw = (weekly, ys) => {
    last = { weekly, ys };
    const dpr = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, width * dpr);
    canvas.height = Math.max(1, height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const n = ys.length * weekly.weeks;
    const bw = width / n;
    const maxLog = Math.log10(1 + Math.max(1, ...weekly.series));
    const grad = ctx.createLinearGradient(0, height, 0, 0);
    grad.addColorStop(0, 'rgba(255,61,31,0.35)');
    grad.addColorStop(0.6, 'rgba(255,140,31,0.85)');
    grad.addColorStop(1, 'rgba(255,233,168,1)');
    ctx.fillStyle = grad;
    for (let i = 0; i < n; i++) {
      const v = weekly.series[i];
      if (!v) continue;
      const h = (Math.log10(1 + v) / maxLog) * (height - 16);
      ctx.fillRect(i * bw + 0.15 * bw, height - 14 - h, Math.max(0.6, bw * 0.7), h);
    }
    // Season separators + year labels
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.font = '10px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ys.forEach((y, i) => {
      const x = (i / ys.length) * width;
      ctx.fillRect(x, 0, 1, height - 12);
      if (ys.length < 30 || i % 2 === 0) ctx.fillText(String(y).slice(2), x + width / ys.length / 2, height - 2);
    });
  };
  const ro = new ResizeObserver(() => last && draw(last.weekly, last.ys));
  ro.observe(canvas);
  return { draw };
}

/** Map a (year, doy) pair to a 0..1 position on the season axis, and back. */
export function seasonAxis(ys) {
  const span = SEASON_END_DOY - SEASON_START_DOY;
  return {
    toX(year, doy) {
      const yi = year - ys[0];
      return (yi + Math.min(1, Math.max(0, (doy - SEASON_START_DOY) / span))) / ys.length;
    },
    fromX(x) {
      const pos = Math.min(0.99999, Math.max(0, x)) * ys.length;
      const yi = Math.floor(pos);
      return { year: ys[0] + yi, doy: SEASON_START_DOY + (pos - yi) * span };
    },
  };
}
