// search-mode.js: Search. Finds fires in the loaded record by anything it holds: name, date, month,
// cause, size, how long they burned, distance from a community, a drawn area or a dropped pin.
//
// The query model, the plain-language search box and the exports live in search.js (shared with the
// server's /api/search). This module is the UI: the search box with chips, faceted filters that show
// what each choice would return, a brushable year histogram, a sortable result list, and the map,
// where matching fires ignite in the order they started while the rest of the record stays as dust.
import { CONFIG } from './config.js';
import { CAUSES, MONTHS, fmtHa, fmtInt, fmtDate, esc } from './data.js';
import { CAUSE_COLORS } from './charts.js';
import {
  SIZE_CLASSES, DURATIONS, SORTS, DEFAULT_RADIUS_KM, emptyQuery, normalizeQuery, mergeQuery, parseText, search,
  describe, withoutPart, toParams, fromParams, toCSV, toGeoJSON, isEmptyQuery,
} from './search.js';

const { ScatterplotLayer, PathLayer, PolygonLayer, TextLayer } = deck;
const $ = (s) => document.querySelector(s);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ADDITIVE = {
  blend: true, blendColorOperation: 'add', blendColorSrcFactor: 'src-alpha', blendColorDstFactor: 'one',
  blendAlphaOperation: 'add', blendAlphaSrcFactor: 'one', blendAlphaDstFactor: 'one-minus-src-alpha',
  depthWriteEnabled: false, depthCompare: 'always',
};
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const CAUSE_RGB = CAUSE_COLORS.map(rgb);
const HOT = [255, 246, 222];
const REVEAL_MS = 1600;  // results ignite over this long, in the order they started
const PAGE = 80;         // result rows rendered per page of scrolling
const EXAMPLES = [
  'lightning over 10,000 ha',
  'human near Prince Albert since 2010',
  'megafires 1980s',
  'june to august 2015 class:e',
  'burned longer than 3 months',
  'replay largest',
  '"shoe"',
];
const MONTH_LETTERS = 'JFMAMJJASOND';

export function createSearchMode({ map, toast, getFires, getCommunities, getSpreadIds, openCard, onUse }) {
  const S = {
    active: false, base: emptyQuery(), parsed: null, q: emptyQuery(), r: null, rank: null,
    shown: PAGE, hover: null, selected: null, revealAt: -1e9, tool: null, drawStart: null, drawBox: null,
    consumed: false, radius: DEFAULT_RADIUS_KM, brush: null, timer: 0,
  };
  const input = $('#sx-input');

  // ---------------------------------------------------------------- query state
  // The controls hold S.base; the search box is read live and laid over it. Enter (or touching a
  // control) "commits": what the box understood becomes filters, and only unrecognized words stay.
  function effective() {
    const text = input.value;
    S.parsed = text.trim() ? parseText(text, { communities: getCommunities() }) : null;
    const patch = S.parsed ? { ...S.parsed.patch, text: S.parsed.text } : { text: '' };
    return mergeQuery({ ...S.base, text: '' }, patch);
  }
  function commit() {
    if (!S.parsed) return;
    const q = effective();
    input.value = S.parsed.text;
    S.base = { ...q, text: '' };
    S.parsed = null;
  }
  /** Change the controls' query: edit(q => { q.causes = [...] }) */
  function edit(fn, opts) {
    commit();
    const q = normalizeQuery(S.base);
    fn(q);
    S.base = normalizeQuery(q);
    run(opts);
  }

  function run({ reveal = true, fit = false } = {}) {
    const fires = getFires();
    if (!fires.length) return;
    S.q = normalizeQuery(effective());
    if (S.q.near) S.radius = S.q.near.km;
    S.r = search(fires, S.q, { spreadIds: getSpreadIds() });
    // Each result's place in date order, for the ignition reveal
    const res = S.r.results;
    const order = res.map((_, i) => i).sort((a, b) => (res[a].t ?? 0) - (res[b].t ?? 0));
    S.rank = new Float32Array(res.length);
    order.forEach((idx, k) => { S.rank[idx] = res.length > 1 ? k / (res.length - 1) : 0; });
    if (reveal) S.revealAt = performance.now();
    S.shown = PAGE;
    S.hover = null;
    render();
    if (S.active) history.replaceState(null, '', `#${hash()}`);
    if (fit) fitResults();
  }

  const hash = () => { const p = toParams(S.q).toString(); return p ? `search?${p}` : 'search'; };

  // ---------------------------------------------------------------- rendering: left panel
  function render() {
    renderChips();
    renderFacets();
    renderResults();
  }

  function renderChips() {
    const parts = describe(S.q);
    $('#sx-chips').innerHTML = parts.map((p) => `<button class="sx-chip" data-key="${p.key}" title="Remove this filter">${esc(p.text)}<i aria-hidden="true">×</i></button>`).join('')
      + (parts.length > 1 ? '<button class="sx-chip clear" data-key="*">Clear all</button>' : '');
    const notes = S.parsed?.notes ?? [];
    const pending = S.parsed && JSON.stringify(normalizeQuery(mergeQuery({ ...emptyQuery() }, S.parsed.patch))) !== JSON.stringify(normalizeQuery(emptyQuery()));
    $('#sx-hint').innerHTML = notes.map((n) => `<span class="warn">${esc(n)}</span>`).join(' ')
      || (pending ? 'Read as filters above. <kbd>Enter</kbd> keeps them; other words search fire names.' : '');
    $('#sx-examples').hidden = !isEmptyQuery(S.q);
  }

  function facetCount(name, key) { return S.r?.facets[name].get(key)?.count ?? 0; }

  function renderFacets() {
    const q = S.q;
    // Cause chips
    $('#sx-causes').innerHTML = CAUSES.map((c, i) => {
      const on = q.causes.includes(c);
      return `<button class="chip ${on || !q.causes.length ? 'on' : ''} ${on ? 'picked' : ''}" data-cause="${c}" style="--c:${CAUSE_COLORS[i]}" aria-pressed="${on}"><i></i>${c}<small>${fmtInt(facetCount('cause', c))}</small></button>`;
    }).join('');
    // Month strip
    const mc = MONTHS.map((_, m) => facetCount('month', m));
    const mMax = Math.max(1, ...mc);
    $('#sx-months').innerHTML = MONTHS.map((name, m) => {
      const on = q.months.includes(m);
      return `<button class="sx-mbar ${on ? 'on' : ''} ${q.months.length && !on ? 'off' : ''}" data-month="${m}" aria-pressed="${on}" title="${name}: ${fmtInt(mc[m])} fires">
        <span class="b" style="--h:${(Math.sqrt(mc[m] / mMax) * 100).toFixed(1)}%"></span><span class="l">${MONTH_LETTERS[m]}</span></button>`;
    }).join('');
    // Size classes and durations: bar rows
    const rows = (el, list, facet, picked, attr) => {
      const counts = list.map((x) => facetCount(facet, x.id));
      const max = Math.max(1, ...counts);
      $(el).innerHTML = list.map((x, i) => {
        const on = picked.includes(x.id);
        return `<button class="sx-frow ${on ? 'on' : ''} ${picked.length && !on ? 'off' : ''}" data-${attr}="${x.id}" aria-pressed="${on}">
          <span class="k">${facet === 'cls' ? `<b>${x.id}</b>` : ''}${x.label}</span><span class="n">${fmtInt(counts[i])}</span><i style="--w:${((counts[i] / max) * 100).toFixed(1)}%"></i></button>`;
      }).join('');
    };
    rows('#sx-classes', SIZE_CLASSES, 'cls', q.classes, 'cls');
    rows('#sx-durs', DURATIONS, 'dur', q.durs, 'dur');
    const noOut = facetCount('dur', 'none');
    $('#sx-dur-note').textContent = noOut ? `${fmtInt(noOut)} fires have no out date and are left out when this is set.` : '';
    // Protection zones (only when the record has any)
    const zones = [...(S.r?.facets.zone.keys() ?? [])].filter((z) => z !== 'None');
    $('#sx-zone-group').hidden = !zones.length && !q.zones.length;
    $('#sx-zones').innerHTML = ['None', ...zones].map((z) => {
      const on = q.zones.includes(z);
      return `<button class="chip ${on ? 'on picked' : ''}" data-zone="${esc(z)}" aria-pressed="${on}" style="--c:var(--ember)"><i></i>${z === 'None' ? 'Not recorded' : esc(z)}<small>${fmtInt(facetCount('zone', z))}</small></button>`;
    }).join('');
    // Numeric inputs: never overwrite the one being typed in
    const setVal = (sel, v) => { const el = $(sel); if (document.activeElement !== el) el.value = v ?? ''; };
    setVal('#sx-from', q.from); setVal('#sx-to', q.to);
    setVal('#sx-min', q.sizeMin); setVal('#sx-max', q.sizeMax);
    setVal('#sx-dmin', q.durMin); setVal('#sx-dmax', q.durMax);
    $('#sx-named').checked = q.named;
    $('#sx-spread').checked = q.spread;
    $('#sx-spread').disabled = !getSpreadIds().size && !q.spread;
    // Place
    $('#sx-radius').value = S.radius;
    $('#sx-radius-out').textContent = `${fmtInt(S.radius)} km`;
    if (document.activeElement !== $('#sx-place')) $('#sx-place').value = q.near?.label && !/°|pin/.test(q.near.label) ? q.near.label : '';
    $('#sx-pin').classList.toggle('on', S.tool === 'pin');
    $('#sx-draw').classList.toggle('on', S.tool === 'draw');
    $('#sx-place-note').textContent = getCommunities().length
      ? `${fmtInt(getCommunities().length)} SPSA communities (live layer).`
      : 'Community names load from the live SPSA layer. Pins and boxes work without it.';
  }

  // ---------------------------------------------------------------- rendering: right panel
  const counters = { count: { v: 0, t: 0 }, ha: { v: 0, t: 0 } };
  function renderResults() {
    const r = S.r;
    if (!r) return;
    const all = getFires();
    counters.count.t = r.count;
    counters.ha.t = r.ha;
    const totalHa = all.reduce((s, f) => s + f.size_ha, 0);
    const share = totalHa ? r.ha / totalHa : 0;
    $('#sx-share').textContent = !totalHa ? '–' : share > 0 && share < 0.0001 ? '< 0.01%' : `${(share * 100).toFixed(share < 0.01 ? 2 : 1)}%`;
    const parts = describe(r.query);
    $('#sx-sentence').innerHTML = parts.length
      ? `${fmtInt(r.count)} of ${fmtInt(all.length)} fires: ${parts.map((p) => `<b>${esc(p.text)}</b>`).join(' · ')}`
      : `Every fire in the record, ${fmtInt(all.length)} of them. Search or pick filters to narrow it.`;
    renderHistogram();
    $('#sx-sort').value = r.query.sort;
    $('#sx-sort option[value="km"]').disabled = !r.query.near;
    $('#sx-dir').textContent = r.query.dir === 'asc' ? '↑' : '↓';
    $('#sx-dir').title = r.query.dir === 'asc' ? 'Ascending (click to flip)' : 'Descending (click to flip)';
    renderList();
    $('#sx-api').hidden = Boolean(CONFIG.staticDataUrl || CONFIG.staticSite); // no server to answer /api/search
  }

  function renderHistogram() {
    const all = getFires();
    const y0 = all[0]?.year ?? 0, y1 = all[all.length - 1]?.year ?? 0;
    const counts = [];
    for (let y = y0; y <= y1; y++) counts.push(facetCount('year', y));
    const max = Math.max(1, ...counts);
    const q = S.q;
    const [a, b] = S.brush ?? [q.from ?? -Infinity, q.to ?? Infinity];
    const filtered = S.brush || q.from != null || q.to != null;
    $('#sx-hist').innerHTML = counts.map((c, i) => {
      const y = y0 + i;
      const on = y >= Math.min(a, b) && y <= Math.max(a, b);
      return `<span class="hb ${filtered ? (on ? 'on' : 'off') : ''}" data-year="${y}" title="${y}: ${fmtInt(c)} fires"><i style="--h:${(Math.sqrt(c / max) * 100).toFixed(1)}%"></i>${y % 10 === 0 ? `<em>${y}</em>` : ''}</span>`;
    }).join('');
    $('#sx-hist-out').textContent = q.from == null && q.to == null ? `${y0}–${y1}` : describe(q).find((p) => p.key === 'years')?.text ?? '';
  }

  function renderList() {
    const list = S.r.results;
    const shown = list.slice(0, S.shown);
    const spreadIds = getSpreadIds();
    const maxLog = Math.log10((list.reduce((m, f) => Math.max(m, f.size_ha), 0) || 1) + 1);
    const el = $('#sx-list');
    el.innerHTML = shown.length ? shown.map((f, i) => {
      const meta = [fmtDate(f.ignition_date), f.days != null ? `${f.days} d` : null, f._km != null && S.q.near ? `${Math.round(f._km)} km` : null].filter(Boolean).join(' · ');
      return `<button class="sx-row ${S.selected === f ? 'on' : ''}" data-i="${i}" style="--c:${CAUSE_COLORS[f.causeIdx ?? CAUSES.indexOf(f.general_cause)]}">
        <span class="sx-name"><i class="dot"></i>${esc(f.label)}${spreadIds.has(f.fire_id) ? '<em class="sp" title="Has a True Spread Replay">spread</em>' : ''}<small>${meta}</small></span>
        <span class="sx-ha">${fmtHa(f.size_ha)}<small>ha · ${f.cls}</small></span>
        <b style="--w:${((Math.log10(f.size_ha + 1) / maxLog) * 100).toFixed(1)}%"></b></button>`;
    }).join('') + (list.length > S.shown ? `<p class="sx-more muted small">Showing ${fmtInt(S.shown)} of ${fmtInt(list.length)}. Scroll for more.</p>` : '')
      : '<p class="sx-empty">No fires match. Remove a filter above, or widen the years.</p>';
  }

  function tickCounters(dt) {
    for (const [k, c] of Object.entries(counters)) {
      c.v = Math.abs(c.t - c.v) < 0.5 ? c.t : c.v + (c.t - c.v) * (1 - Math.exp(-dt * 9));
      const el = $(`#sx-k-${k}`);
      const text = k === 'ha' ? fmtHa(c.v) : fmtInt(c.v);
      if (el.textContent !== text) el.textContent = text;
    }
  }

  // ---------------------------------------------------------------- map
  function fitResults() {
    const res = S.r?.results ?? [];
    if (!res.length) return;
    if (S.q.near && !S.q.bbox) {
      const { lat, lon, km } = S.q.near, dLat = km / 111, dLon = km / (111 * Math.cos((lat * Math.PI) / 180));
      map.fitBounds([[lon - dLon, lat - dLat], [lon + dLon, lat + dLat]], { padding: padding(), duration: 1800, maxZoom: 10 });
      return;
    }
    let w = 180, s = 90, e = -180, n = -90;
    for (const f of res) { w = Math.min(w, f.longitude); e = Math.max(e, f.longitude); s = Math.min(s, f.latitude); n = Math.max(n, f.latitude); }
    if (res.length === 1) { map.flyTo({ center: [w, s], zoom: 8, duration: 1800 }); return; }
    map.fitBounds([[w, s], [e, n]], { padding: padding(), duration: 1800, maxZoom: 9 });
  }
  const padding = () => (innerWidth > 900 ? { top: 90, bottom: 40, left: 340, right: 400 } : 40);

  const nearRing = (now) => {
    const n = S.q.near;
    if (!n) return [];
    const k = ((now / 2600) % 1);
    const center = [n.lon, n.lat];
    return [
      new ScatterplotLayer({ id: 'sx-near', data: [n], getPosition: () => center, getRadius: n.km * 1000, filled: true, getFillColor: [255, 122, 31, 16],
        stroked: true, getLineColor: [255, 180, 100, 190], lineWidthMinPixels: 1.4, updateTriggers: { getRadius: n.km } }),
      new ScatterplotLayer({ id: 'sx-near-sweep', data: [n], getPosition: () => center, getRadius: n.km * 1000 * k, filled: false,
        stroked: true, getLineColor: [255, 200, 120, 120 * (1 - k)], lineWidthMinPixels: 2, parameters: ADDITIVE, updateTriggers: { getRadius: k, getLineColor: k } }),
      new ScatterplotLayer({ id: 'sx-near-dot', data: [n], getPosition: () => center, radiusUnits: 'pixels', getRadius: 4, getFillColor: [255, 246, 222, 255], parameters: ADDITIVE }),
      new TextLayer({ id: 'sx-near-label', data: [n], getPosition: () => center, getText: () => `${n.label ?? 'Pin'} · ${fmtInt(n.km)} km`,
        getSize: 12, getColor: [255, 236, 210, 235], getPixelOffset: [0, -16], fontFamily: 'Space Grotesk, sans-serif', fontWeight: 600,
        outlineWidth: 3, outlineColor: [0, 0, 0, 200], fontSettings: { sdf: true }, updateTriggers: { getText: [n.label, n.km] } }),
    ];
  };
  const boxLayers = () => {
    const b = S.drawBox ?? S.q.bbox;
    if (!b) return [];
    const [w, s, e, n] = b;
    const ring = [[w, s], [e, s], [e, n], [w, n], [w, s]];
    return [
      new PolygonLayer({ id: 'sx-box', data: [ring], getPolygon: (d) => d, filled: true, getFillColor: [255, 122, 31, S.drawBox ? 26 : 14], stroked: false }),
      new PathLayer({ id: 'sx-box-glow', data: [ring], getPath: (d) => d, getColor: [255, 120, 40, 50], widthMinPixels: 7, parameters: ADDITIVE }),
      new PathLayer({ id: 'sx-box-line', data: [ring], getPath: (d) => d, getColor: [255, 190, 120, 220], widthMinPixels: 1.4 }),
    ];
  };

  function layers(now, dt) {
    if (S.r) tickCounters(dt);
    const all = getFires();
    const res = S.r?.results ?? [];
    const t = (now - S.revealAt) / REVEAL_MS; // 0 → 1 while the results ignite; flashes finish by 1.3
    const revealing = t < 1.35;
    // u: how far fire i is through its ignition flash (<0 not yet, 0–1 flashing, >1 settled)
    const u = (i) => (revealing ? (t - S.rank[i] * 0.85) / 0.3 : 2);
    const colorAt = (d, i, base, alpha, flashAlpha) => {
      const x = u(i);
      if (x < 0) return [0, 0, 0, 0];
      if (x >= 1) return [...base, alpha];
      return [HOT[0] + (base[0] - HOT[0]) * x, HOT[1] + (base[1] - HOT[1]) * x, HOT[2] + (base[2] - HOT[2]) * x, flashAlpha + (alpha - flashAlpha) * x];
    };
    const cause = (d) => CAUSE_RGB[d.causeIdx ?? Math.max(0, CAUSES.indexOf(d.general_cause))];
    // Thousands of overlapping additive circles burn out to a solid mass; thin them as results grow
    const k = clamp(Math.sqrt(1200 / Math.max(1, res.length)), 0.28, 1);
    const out = [
      // The whole record as faint dust, so the matches read against everything
      new ScatterplotLayer({ id: 'sx-context', data: all, getPosition: (d) => d.position, radiusUnits: 'pixels', getRadius: 1, getFillColor: [255, 228, 200, 22], parameters: ADDITIVE }),
      ...boxLayers(),
      ...nearRing(now),
      new ScatterplotLayer({
        id: 'sx-glow', data: res, getPosition: (d) => d.position, radiusMinPixels: 3,
        getRadius: (d, { index }) => { const x = u(index); return (d.radius * 1.2 + 900) * (x >= 0 && x < 1 ? 1 + 2.5 * (1 - x) : 1); },
        getFillColor: (d, { index }) => colorAt(d, index, cause(d), 26 * k, 170 * k), parameters: ADDITIVE,
        updateTriggers: { getRadius: revealing ? t : 'done', getFillColor: revealing ? t : `done${k}` },
      }),
      new ScatterplotLayer({
        id: 'sx-hits', data: res, getPosition: (d) => d.position, getRadius: (d) => d.radius, radiusMinPixels: 1.8, pickable: true,
        stroked: true, lineWidthMinPixels: 0.6, getLineColor: (d, { index }) => colorAt(d, index, cause(d), 200 * k, 255),
        getFillColor: (d, { index }) => colorAt(d, index, cause(d), 92 * k, 255 * k), parameters: ADDITIVE,
        autoHighlight: true, highlightColor: [255, 255, 255, 140],
        updateTriggers: { getFillColor: revealing ? t : `done${k}`, getLineColor: revealing ? t : `done${k}` },
      }),
    ];
    const marks = [S.selected && { f: S.selected, c: [255, 210, 122] }, S.hover && S.hover !== S.selected && { f: S.hover, c: [255, 255, 255] }].filter(Boolean);
    if (marks.length) {
      const p = (now / 900) % 1;
      out.push(new ScatterplotLayer({
        id: 'sx-mark', data: marks, getPosition: (d) => d.f.position, radiusUnits: 'pixels', getRadius: 9 + 9 * p, filled: false, stroked: true,
        lineWidthUnits: 'pixels', getLineWidth: 2, getLineColor: (d) => [...d.c, 255 * (1 - p)], parameters: ADDITIVE, updateTriggers: { getRadius: p, getLineColor: p },
      }));
    }
    return out;
  }

  function tooltip({ object, layer }) {
    if (layer?.id !== 'sx-hits' || !object) return null;
    const f = object;
    const extra = [f.days != null ? `burned ${f.days} day${f.days === 1 ? '' : 's'}` : null, f._km != null && S.q.near ? `${Math.round(f._km)} km from ${esc(S.q.near.label ?? 'pin')}` : null].filter(Boolean).join(' · ');
    return { html: `<b>${esc(f.label)}</b><br/>${fmtDate(f.ignition_date)} · ${f.general_cause}<br/>${fmtHa(f.size_ha)} ha · class ${f.cls}${extra ? `<br/><small>${extra}</small>` : ''}<br/><small>click for details</small>`, className: 'deck-tooltip' };
  }

  // Pin and box tools take over the next click / drag on the map
  function setTool(tool) {
    S.tool = S.tool === tool ? null : tool;
    S.drawStart = null; S.drawBox = null;
    if (S.tool === 'draw') map.dragPan.disable(); else map.dragPan.enable();
    map.getCanvas().style.cursor = S.tool ? 'crosshair' : '';
    if (S.tool) toast(S.tool === 'pin' ? 'Click the map to drop a pin. Fires within the radius will match.' : 'Drag on the map to draw a box.');
    renderFacets();
  }
  map.on('click', (e) => {
    if (S.tool !== 'pin' || !S.active) return;
    S.consumed = true;
    const { lat, lng } = e.lngLat;
    setTool(null);
    edit((q) => { q.near = { lat, lon: lng, km: S.radius, label: 'Dropped pin' }; }, { fit: true });
  });
  map.on('mousedown', (e) => { if (S.tool === 'draw' && S.active) { S.drawStart = e.lngLat; e.preventDefault(); } });
  map.on('mousemove', (e) => {
    if (S.tool !== 'draw' || !S.drawStart) return;
    const a = S.drawStart, b = e.lngLat;
    S.drawBox = [Math.min(a.lng, b.lng), Math.min(a.lat, b.lat), Math.max(a.lng, b.lng), Math.max(a.lat, b.lat)];
  });
  map.on('mouseup', () => {
    if (S.tool !== 'draw' || !S.drawStart) return;
    const box = S.drawBox;
    S.consumed = true;
    setTool(null);
    if (box && box[2] - box[0] > 0.01 && box[3] - box[1] > 0.01) edit((q) => { q.bbox = box; }, { fit: true });
  });

  // ---------------------------------------------------------------- wiring
  function setNearFromInput() {
    const name = $('#sx-place').value.trim().toLowerCase();
    if (!name) return;
    const c = getCommunities().find((x) => x.name?.toLowerCase() === name) ?? getCommunities().find((x) => x.name?.toLowerCase().startsWith(name));
    if (!c) { toast(getCommunities().length ? `No SPSA community called “${$('#sx-place').value}”.` : 'Community names need the live SPSA layer, which has not loaded yet.'); return; }
    $('#sx-place').value = c.name;
    edit((q) => { q.near = { lat: c.latitude, lon: c.longitude, km: S.radius, label: c.name }; }, { fit: true });
  }
  function communitiesChanged() {
    const names = [...new Set(getCommunities().map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    $('#sx-communities').innerHTML = names.map((n) => `<option value="${esc(n)}"></option>`).join('');
    if (S.active) renderFacets();
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }
  const stamp = () => new Date().toISOString().slice(0, 10);

  function wire() {
    input.addEventListener('input', () => { clearTimeout(S.timer); S.timer = setTimeout(() => run(), 90); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); clearTimeout(S.timer); commit(); run({ fit: Boolean(S.q.near || S.q.bbox) }); }
      if (e.key === 'Escape') input.blur();
      if (e.key === 'ArrowDown') { e.preventDefault(); $('#sx-list .sx-row')?.focus(); }
    });
    $('#sx-examples').innerHTML = `<span class="muted small">Try</span>${EXAMPLES.map((x) => `<button class="sx-ex">${esc(x)}</button>`).join('')}`;
    $('#sx-examples').addEventListener('click', (e) => {
      const b = e.target.closest('.sx-ex');
      if (!b) return;
      input.value = b.textContent;
      S.base = emptyQuery();
      commit();
      run({ fit: true });
    });
    $('#sx-chips').addEventListener('click', (e) => {
      const key = e.target.closest('.sx-chip')?.dataset.key;
      if (!key) return;
      if (key === '*') { input.value = ''; S.parsed = null; S.base = emptyQuery(); run(); return; }
      commit();
      if (key === 'text') input.value = '';
      S.base = withoutPart(S.base, key);
      run();
    });
    const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);
    $('#sx-causes').addEventListener('click', (e) => { const c = e.target.closest('[data-cause]')?.dataset.cause; if (c) edit((q) => { q.causes = toggle(q.causes, c); }); });
    $('#sx-months').addEventListener('click', (e) => { const m = e.target.closest('[data-month]')?.dataset.month; if (m != null) edit((q) => { q.months = toggle(q.months, Number(m)); }); });
    $('#sx-classes').addEventListener('click', (e) => { const c = e.target.closest('[data-cls]')?.dataset.cls; if (c) edit((q) => { q.classes = toggle(q.classes, c); }); });
    $('#sx-durs').addEventListener('click', (e) => { const d = e.target.closest('[data-dur]')?.dataset.dur; if (d) edit((q) => { q.durs = toggle(q.durs, d); }); });
    $('#sx-zones').addEventListener('click', (e) => { const z = e.target.closest('[data-zone]')?.dataset.zone; if (z) edit((q) => { q.zones = toggle(q.zones, z); }); });
    for (const [sel, key] of [['#sx-from', 'from'], ['#sx-to', 'to'], ['#sx-min', 'sizeMin'], ['#sx-max', 'sizeMax'], ['#sx-dmin', 'durMin'], ['#sx-dmax', 'durMax']]) {
      $(sel).addEventListener('change', (e) => edit((q) => { q[key] = e.target.value === '' ? null : Number(e.target.value); }));
    }
    $('#sx-named').addEventListener('change', (e) => edit((q) => { q.named = e.target.checked; }));
    $('#sx-spread').addEventListener('change', (e) => edit((q) => { q.spread = e.target.checked; }));
    $('#sx-place').addEventListener('change', setNearFromInput);
    $('#sx-place').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); setNearFromInput(); } });
    $('#sx-radius').addEventListener('input', (e) => {
      S.radius = Number(e.target.value);
      $('#sx-radius-out').textContent = `${fmtInt(S.radius)} km`;
      if (S.q.near) edit((q) => { if (q.near) q.near = { ...q.near, km: S.radius }; }, { reveal: false });
    });
    $('#sx-radius').addEventListener('change', () => { if (S.q.near) fitResults(); });
    $('#sx-pin').addEventListener('click', () => setTool('pin'));
    $('#sx-draw').addEventListener('click', () => setTool('draw'));
    $('#sx-view').addEventListener('click', () => {
      const b = map.getBounds();
      edit((q) => { q.bbox = [b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]; });
    });
    $('#sx-reset').addEventListener('click', () => { input.value = ''; S.parsed = null; S.base = emptyQuery(); setTool(null); S.tool = null; run(); });

    // Year histogram: click a year, shift-click to extend, drag to brush a range, click the only year again to clear
    const hist = $('#sx-hist');
    const yearAt = (ev) => {
      const bars = [...hist.children];
      const r = hist.getBoundingClientRect();
      const i = clamp(Math.floor(((ev.clientX - r.left) / r.width) * bars.length), 0, bars.length - 1);
      return Number(bars[i]?.dataset.year);
    };
    hist.addEventListener('pointerdown', (ev) => {
      const y = yearAt(ev);
      if (!y) return;
      hist.setPointerCapture(ev.pointerId);
      const q = S.q;
      const anchor = ev.shiftKey && (q.from != null || q.to != null) ? (Math.abs(y - (q.from ?? y)) > Math.abs(y - (q.to ?? y)) ? q.from : q.to) : y;
      S.brush = [anchor, y];
      renderHistogram();
    });
    hist.addEventListener('pointermove', (ev) => {
      const y = yearAt(ev);
      $('#sx-hist-tip').textContent = y ? `${y} · ${fmtInt(facetCount('year', y))} fires · ${fmtHa(S.r?.facets.year.get(y)?.ha ?? 0)} ha` : '';
      if (S.brush && y && y !== S.brush[1]) { S.brush[1] = y; renderHistogram(); }
    });
    hist.addEventListener('pointerleave', () => { $('#sx-hist-tip').textContent = ''; });
    hist.addEventListener('pointerup', () => {
      if (!S.brush) return;
      const [a, b] = S.brush;
      S.brush = null;
      const same = a === b && S.q.from === a && S.q.to === a;
      edit((q) => { if (same) { q.from = null; q.to = null; } else { q.from = Math.min(a, b); q.to = Math.max(a, b); } });
    });
    $('#sx-hist-clear').addEventListener('click', () => edit((q) => { q.from = null; q.to = null; }));

    // Results
    $('#sx-sort').addEventListener('change', (e) => edit((q) => { q.sort = e.target.value; q.dir = { size: 'desc', date: 'desc', days: 'desc', name: 'asc', km: 'asc' }[q.sort]; }, { reveal: false }));
    $('#sx-dir').addEventListener('click', () => edit((q) => { q.dir = q.dir === 'asc' ? 'desc' : 'asc'; }, { reveal: false }));
    const list = $('#sx-list');
    const rowFire = (e) => { const i = e.target.closest('.sx-row')?.dataset.i; return i != null ? S.r.results[Number(i)] : null; };
    list.addEventListener('click', (e) => { const f = rowFire(e); if (f) { S.selected = f; renderList(); openCard(f, true); } });
    list.addEventListener('pointerover', (e) => { S.hover = rowFire(e); });
    list.addEventListener('pointerleave', () => { S.hover = null; });
    list.addEventListener('focusin', (e) => { S.hover = rowFire(e); });
    list.addEventListener('keydown', (e) => {
      const row = e.target.closest('.sx-row');
      if (!row) return;
      if (e.key === 'ArrowDown') { e.preventDefault(); row.nextElementSibling?.matches('.sx-row') && row.nextElementSibling.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); (row.previousElementSibling ?? input).focus(); }
    });
    list.addEventListener('scroll', () => {
      if (list.scrollTop + list.clientHeight > list.scrollHeight - 200 && S.r && S.shown < S.r.count) { S.shown += PAGE; renderList(); }
    });
    $('#sx-fit').addEventListener('click', fitResults);
    $('#sx-csv').addEventListener('click', () => {
      download(`emberline-search-${stamp()}.csv`, toCSV(S.r.results, { near: Boolean(S.q.near) }), 'text/csv');
      toast(`${fmtInt(S.r.count)} fires saved as CSV.`);
    });
    $('#sx-geojson').addEventListener('click', () => {
      download(`emberline-search-${stamp()}.geojson`, JSON.stringify(toGeoJSON(S.r.results, { query: describe(S.q).map((p) => p.text) })), 'application/geo+json');
      toast(`${fmtInt(S.r.count)} fires saved as GeoJSON.`);
    });
    $('#sx-api').addEventListener('click', () => window.open(`${CONFIG.apiBase}/search?${toParams(S.q)}`, '_blank', 'noopener'));
    $('#sx-link').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(location.href); toast('Link copied. It opens this exact search.'); } catch { toast(location.href, 6000); }
    });
    const use = (mode) => {
      if (!S.r?.count) { toast('Nothing to show: the search has no results.'); return; }
      const ys = S.r.results.map((f) => f.year);
      onUse(mode, { query: S.q, parts: describe(S.q).map((p) => p.text), count: S.r.count, from: S.q.from ?? Math.min(...ys), to: S.q.to ?? Math.max(...ys) });
    };
    $('#sx-replay').addEventListener('click', () => use('timeline'));
    $('#sx-explore').addEventListener('click', () => use('explore'));
  }
  wire();

  return {
    state: S,
    layers,
    tooltip,
    get hash() { return hash(); },
    /** True once after a pin or box tool used a map click, so the app doesn't also treat it as a pick. */
    consumeClick() { const c = S.consumed; S.consumed = false; return c; },
    enter() {
      S.active = true;
      communitiesChanged();
      run({ fit: S.pendingFit });
      S.pendingFit = false;
      if (!input.value && innerWidth > 900) setTimeout(() => input.focus({ preventScroll: true }), 300);
    },
    exit() { S.active = false; setTool(null); S.tool = null; map.getCanvas().style.cursor = ''; },
    focus() { input.focus(); input.select(); },
    /** Open a search from a URL hash ("search?cause=Lightning&…") or a query object. */
    setQuery(q, { fit = true } = {}) {
      const n = typeof q === 'string' ? fromParams(q.split('?')[1] ?? '') : normalizeQuery(q);
      input.value = n.text;
      S.base = { ...n, text: '' };
      S.parsed = null;
      if (S.active) run({ fit }); else S.pendingFit = fit && !isEmptyQuery(n);
    },
    /** The dataset changed: run the current query again. */
    refresh() { S.selected = null; S.hover = null; if (S.active) run(); },
    communitiesChanged,
    /** Highlight a fire chosen elsewhere (map click). */
    select(f) { S.selected = f; if (S.active) renderList(); },
  };
}
