/* ==========================================================================
   Astera Studio mockup: app logic
   --------------------------------------------------------------------------
   No framework and no build step. One `state` object; every screen is a
   function that returns an HTML string from that state, and `render()`
   redraws the current route. Charts are hand-drawn SVG that redraw when
   their container resizes.

   Sections:
     1. Helpers & formatting        6. Dashboard view
     2. State & persistence         7. Pipelines list + detail views
     3. Data queries (chart specs)  8. Chat view + question matching
     4. SVG charts                  9. Sheets, toasts, menus, confirm
     5. Shell, router, render      10. Pipeline run simulation + events
   ========================================================================== */
(function () {
  'use strict';

  const D = window.STUDIO_DATA;

  /* ======================================================================
     1. Helpers & formatting
     ====================================================================== */
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name, cls = '') => `<svg class="icon ${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;
  const uid = () => Math.random().toString(36).slice(2, 9);
  const reducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fmtInt = (n) => (n == null ? '—' : Math.round(n).toLocaleString('en-US'));

  function fmtValue(v, format, compact) {
    if (v == null || Number.isNaN(v)) return '—';
    switch (format) {
      case 'currency': // values are in $K
        if (Math.abs(v) >= 1000) {
          const m = v / 1000;
          return '$' + (compact ? String(+m.toFixed(2)) : m.toFixed(2)) + 'M';
        }
        return '$' + Math.round(v) + 'K';
      case 'percent':
        return (compact ? String(+v.toFixed(1)) : v.toFixed(1)) + '%';
      case 'dollars':
        return '$' + Math.round(v).toLocaleString('en-US');
      default:
        if (compact && Math.abs(v) >= 1000) return String(+(v / 1000).toFixed(1)) + 'K';
        return fmtInt(v);
    }
  }

  function relTime(ts) {
    const s = Math.max(0, (Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return `${m} min ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d} day${d === 1 ? '' : 's'} ago`;
  }
  function ageText(ts) {
    const m = Math.round((Date.now() - ts) / 60000);
    if (m < 60) return `${Math.max(m, 0)} min`;
    const h = Math.round(m / 60);
    if (h < 48) return `${h}h`;
    return `${Math.round(h / 24)} days`;
  }
  // <time> elements tick every second (see tick())
  const timeEl = (ts, kind = 'rel') => `<time data-ts="${ts}" data-kind="${kind}">${kind === 'age' ? ageText(ts) : relTime(ts)}</time>`;
  const elapsed = (ts) => {
    const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };
  const fmtDur = (sec) => (sec == null ? '—' : sec < 60 ? `${sec.toFixed(1)}s` : `${Math.floor(sec / 60)}m ${String(Math.round(sec % 60)).padStart(2, '0')}s`);

  const STATUS = {
    succeeded: { label: 'Succeeded', icon: 'check' },
    failed: { label: 'Failed', icon: 'fail' },
    running: { label: 'Running', icon: 'running' },
    scheduled: { label: 'Scheduled', icon: 'clock' },
    queued: { label: 'Queued', icon: 'dash' },
    skipped: { label: 'Not run', icon: 'dash' },
    disabled: { label: 'Turned off', icon: 'pause' },
  };
  // Status is always icon + text, never colour alone
  const statusBadge = (status, label) => {
    const s = STATUS[status] || STATUS.queued;
    return `<span class="status status--${status}">${icon(s.icon)}${esc(label || s.label)}</span>`;
  };
  const TYPE_ICON = { excel: 'excel', filter: 'filter', database: 'database', join: 'join', transform: 'transform', output: 'output' };

  /* ======================================================================
     2. State & persistence
     ====================================================================== */
  const store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) { /* private mode: keep in memory */ } },
    remove(key) { try { localStorage.removeItem(key); } catch (e) { /* ignore */ } },
  };

  const state = {
    pipelines: JSON.parse(JSON.stringify(D.PIPELINES)), // mutable copy; resets on reload
    history: {},          // pipelineId -> recent runs
    runs: {},             // pipelineId -> active simulated run
    justRan: {},          // pipelineId -> timestamp of a run started here
    drafts: {},           // "pipelineId/stepId" -> unsaved step edits
    filters: { range: 'q3', region: 'all' },
    pins: store.get('studio.pins', []), // pinned chat answers (persisted)
    chat: { messages: [], busy: false, context: null, pendingContext: null },
    sidebarPref: null,    // null = automatic for the screen size
    lastRouteKey: null,
    scrollToPin: null,
  };

  // Seed a small run history so each pipeline has some context
  state.pipelines.forEach((p) => {
    const DAY = 864e5;
    const h = [];
    if (p.status === 'failed') h.push({ at: p.lastRunAt, status: 'failed', note: 'Join with database timed out' });
    if (p.status === 'running') h.push({ at: p.lastRunAt, status: 'running', note: 'In progress' });
    const lastOk = p.dataUpdatedAt;
    for (let i = 0; i < 3; i++) h.push({ at: lastOk - i * DAY, status: 'succeeded', note: i === 0 ? 'Scheduled run' : 'Scheduled run' });
    state.history[p.id] = h;
  });

  const getPipeline = (id) => state.pipelines.find((p) => p.id === id);
  const getStep = (p, id) => p && p.steps.find((s) => s.id === id);
  const metricDef = (id) => D.VOCAB.metrics.find((m) => m.id === id);
  const regionName = (id) => (id === 'all' ? 'All regions' : (D.REGIONS.find((r) => r.id === id) || {}).name || id);
  const dashboardName = (id) => (D.DASHBOARDS.find((d) => d.id === id) || {}).name || id;
  const savePins = () => store.set('studio.pins', state.pins);

  // Effective status: a simulated run in progress overrides the stored one
  function pipelineStatus(p) { return state.runs[p.id] ? 'running' : p.status; }
  function runProgress(p) {
    const run = state.runs[p.id];
    if (run) return { index: run.i + 1, total: run.steps.length, step: getStep(p, run.steps[run.i]), live: true };
    if (p.status === 'running') {
      const idx = p.steps.findIndex((s) => s.status === 'running');
      return { index: idx + 1, total: p.steps.length, step: p.steps[idx], live: false };
    }
    return null;
  }

  /* ======================================================================
     3. Data queries: a "spec" describes a chart; computeSeries() fills it
     ====================================================================== */
  const partsFor = (rangeId) => D.RANGES[rangeId].buckets.flatMap((b) => b.parts);
  const regionsFor = (region) => (region === 'all' ? D.REGIONS : D.REGIONS.filter((r) => r.id === region));

  function sumTable(table, rid, parts) {
    let s = 0, any = false;
    parts.forEach(([m, w]) => { const v = table[rid][m]; if (v != null) { s += v * w; any = true; } });
    return any ? s : null;
  }

  // Revenue, orders, margin and AOV for a set of regions over a set of month parts
  function kpiValues(regions, parts) {
    let revenue = 0, orders = 0, marginW = 0, target = 0, any = false;
    regions.forEach((r) => {
      const v = sumTable(D.REVENUE, r.id, parts);
      if (v == null) return;
      any = true;
      revenue += v;
      target += sumTable(D.TARGET, r.id, parts) || 0;
      orders += (v * 1000) / r.aov;
      marginW += v * r.margin;
    });
    if (!any) return null;
    return { revenue, target, orders, margin: marginW / revenue, aov: (revenue * 1000) / orders };
  }

  function returnsRate(regions, parts, category) {
    let w = 0, mult = 0;
    regions.forEach((r) => { const v = sumTable(D.REVENUE, r.id, parts); if (v != null) { w += v; mult += v * r.returnsMult; } });
    if (!w) return null;
    let mw = 0, mm = 0;
    parts.forEach(([m, wt]) => { mw += wt; mm += wt * D.RETURNS_MONTH_MULT[m]; });
    const base = category ? category.returnRate : D.CATEGORIES.reduce((a, c) => a + c.share * c.returnRate, 0);
    return base * (mult / w) * (mm / mw);
  }

  function metricValue(metric, regions, parts) {
    const k = kpiValues(regions, parts);
    switch (metric) {
      case 'attainment': return k ? { actual: k.revenue, target: k.target } : null;
      case 'revenue': return k ? k.revenue : null;
      case 'orders': return k ? k.orders : null;
      case 'aov': return k ? k.aov : null;
      case 'margin': return k ? k.margin : null;
      case 'returns': return returnsRate(regions, parts);
      default: return null;
    }
  }

  // The region furthest below target in a range (used to pick a metro breakdown)
  function worstRegion(range) {
    const parts = partsFor(range);
    let worst = null;
    D.REGIONS.forEach((r) => {
      const a = sumTable(D.REVENUE, r.id, parts), t = sumTable(D.TARGET, r.id, parts);
      if (a == null || !t) return;
      if (!worst || a / t < worst.pct) worst = { id: r.id, pct: a / t };
    });
    return worst ? worst.id : 'southeast';
  }

  function resolveSpec(spec) {
    const s = Object.assign({}, spec);
    if (s.dimension === 'metro' && s.region === 'all') s.region = worstRegion(s.range);
    return s;
  }

  const DIM_LABEL = { region: 'region', month: 'month', category: 'category', metro: 'metro', stage: 'stage' };
  function specTitle(spec) {
    const m = metricDef(spec.metric);
    const dim = spec.dimension === 'month' && spec.range === 'last30' ? 'week' : DIM_LABEL[spec.dimension];
    if (spec.dimension === 'metro') return `${m.label} by metro · ${regionName(spec.region)}`;
    return `${m.label} by ${dim}`;
  }
  function specFilterLabel(spec) {
    if (spec.metric === 'pipeline') return `Current snapshot · ${regionName(spec.region)}`;
    return `${D.RANGES[spec.range].short} · ${regionName(spec.region)}`;
  }
  // Duplicate detection key: the same chart asked in different words → same key
  const pinKey = (spec) => [spec.metric, spec.dimension, spec.chartType, spec.range, spec.region].join('|');

  function metroRows(region, parts) {
    const r = D.REGIONS.find((x) => x.id === region);
    const a = sumTable(D.REVENUE, r.id, parts), t = sumTable(D.TARGET, r.id, parts);
    if (a == null) return [];
    const norm = r.metros.reduce((acc, [, share, mult]) => acc + share * mult, 0);
    return r.metros.map(([name, share, mult]) => ({ label: name, actual: (a * share * mult) / norm, target: (t || 0) * share }));
  }

  // Returns { labels, ids, series:[{key,name,values}], format, empty, emptyReason }
  function computeSeries(specIn) {
    const spec = resolveSpec(specIn);
    const m = metricDef(spec.metric);
    const regions = regionsFor(spec.region);
    const range = D.RANGES[spec.range];
    const parts = partsFor(spec.range);
    const out = { labels: [], ids: [], series: [], format: m.format, spec };
    const isAtt = spec.metric === 'attainment';
    const actual = [], target = [];
    const push = (label, id, v) => {
      if (v == null) return;
      out.labels.push(label); out.ids.push(id);
      if (isAtt) { actual.push(v.actual); target.push(v.target); } else actual.push(v);
    };

    if (spec.metric === 'pipeline') {
      if (spec.dimension === 'stage') {
        D.STAGES.forEach((st, i) => push(st, st, regions.reduce((a, r) => a + D.OPPORTUNITIES[r.id][i], 0)));
      } else {
        regions.forEach((r) => push(r.name, r.id, D.OPPORTUNITIES[r.id].reduce((a, b) => a + b, 0)));
      }
    } else if (spec.dimension === 'region') {
      regions.forEach((r) => push(r.name, r.id, metricValue(spec.metric, [r], parts)));
    } else if (spec.dimension === 'month') {
      range.buckets.forEach((b) => push(b.label, b.label, metricValue(spec.metric, regions, b.parts)));
    } else if (spec.dimension === 'category') {
      const total = metricValue('revenue', regions, parts);
      if (total != null) {
        const rows = D.CATEGORIES.map((c) => ({ c, v: spec.metric === 'returns' ? returnsRate(regions, parts, c) : total * c.share }));
        rows.sort((a, b) => b.v - a.v).forEach(({ c, v }) => push(c.name, c.id, v));
      }
    } else if (spec.dimension === 'metro') {
      metroRows(spec.region, parts).forEach((row) => push(row.label, row.label, isAtt ? row : row.actual));
    }

    if (isAtt) out.series = [{ key: 'actual', name: 'Actual', values: actual }, { key: 'target', name: 'Target', values: target }];
    else out.series = [{ key: 'value', name: m.label, values: actual }];

    out.empty = out.labels.length === 0 || (out.labels.length === 1 && spec.dimension === 'month' && spec.chartType === 'line' && false);
    if (out.empty) {
      const sw = spec.region === 'southwest';
      out.emptyReason = sw
        ? `No sales data for Southwest in ${range.short}. The Southwest territory started selling in October 2026.`
        : `No data matches ${specFilterLabel(spec)}.`;
    }
    return out;
  }

  // Plain-language 2–3 sentence summary, generated from the same numbers as the chart
  function summarize(data) {
    const { spec, labels, series, format } = data;
    if (data.empty) return esc(data.emptyReason);
    const f = (v) => fmtValue(v, format);
    const where = spec.region === 'all' ? 'across all US regions' : `in ${regionName(spec.region)}`;
    const when = { last30: 'over the last 30 days', last90: 'over the last 90 days', q3: 'in Q3 2026', last6: 'over the last 6 months' }[spec.range];
    const vals = series[0].values;
    const idx = vals.map((v, i) => i);
    const byVal = idx.slice().sort((a, b) => vals[b] - vals[a]);
    const top = byVal[0], bottom = byVal[byVal.length - 1];
    const total = vals.reduce((a, b) => a + b, 0);
    const pct = (a, t) => Math.round((a / t) * 100);

    if (spec.metric === 'attainment') {
      const t = series[1].values;
      const rows = labels.map((l, i) => ({ l, a: vals[i], t: t[i], p: vals[i] / t[i] }));
      if (spec.dimension === 'month') {
        const sa = vals.reduce((a, b) => a + b, 0), st = t.reduce((a, b) => a + b, 0);
        const beat = rows.filter((r) => r.a >= r.t).length;
        const worst = rows.slice().sort((a, b) => a.p - b.p)[0];
        return `Revenue was at <strong>${pct(sa, st)}% of target</strong> ${when} ${where} (${f(sa)} vs ${f(st)}). It beat target in ${beat} of ${rows.length} periods; the biggest gap was <strong>${esc(worst.l)}</strong> at ${pct(worst.a, worst.t)}%.`;
      }
      const missed = rows.filter((r) => r.a < r.t).sort((a, b) => a.p - b.p);
      const best = rows.slice().sort((a, b) => b.p - a.p)[0];
      const unit = spec.dimension === 'metro' ? 'metros' : 'regions';
      if (!missed.length) return `Every one of the ${rows.length} ${unit} hit target ${when}. <strong>${esc(best.l)}</strong> led at ${pct(best.a, best.t)}% of target.`;
      const w = missed[0];
      let s = `<strong>${missed.length} of ${rows.length} ${spec.dimension === 'metro' ? 'metros in ' + regionName(spec.region) : 'active regions'}</strong> missed target ${when}. <strong>${esc(w.l)}</strong> was furthest behind at ${pct(w.a, w.t)}% of target (${f(w.a)} vs ${f(w.t)})`;
      s += missed[1] ? `; ${esc(missed[1].l)} finished at ${pct(missed[1].a, missed[1].t)}%.` : '.';
      if (best.a >= best.t) s += ` ${esc(best.l)} led at ${pct(best.a, best.t)}%.`;
      if (spec.dimension === 'region' && spec.region === 'all' && spec.range !== 'last30') s += ' Southwest isn’t shown because it only started selling in October.';
      return s;
    }
    if (spec.dimension === 'month') {
      const first = vals[0], last = vals[vals.length - 1];
      const change = first ? ((last - first) / first) * 100 : 0;
      const unit = spec.range === 'last30' ? 'week' : 'month';
      if (spec.metric === 'revenue' || spec.metric === 'orders') {
        return `${spec.metric === 'revenue' ? 'Net revenue' : 'Orders'} totalled <strong>${f(total)}</strong> ${when} ${where}, ${change >= 0 ? 'up' : 'down'} <strong>${Math.abs(change).toFixed(1)}%</strong> from the first ${unit} to the last. <strong>${esc(labels[top])}</strong> was the strongest ${unit} at ${f(vals[top])}.`;
      }
      return `${metricDef(spec.metric).label} moved from ${f(first)} to <strong>${f(last)}</strong> ${when} ${where}. The high was ${esc(labels[top])} (${f(vals[top])}) and the low was ${esc(labels[bottom])} (${f(vals[bottom])}).`;
    }
    if (spec.metric === 'returns') {
      const overall = returnsRate(regionsFor(spec.region), partsFor(spec.range));
      return `<strong>${esc(labels[top])}</strong> has the highest return rate at ${f(vals[top])}, about ${(vals[top] / vals[bottom]).toFixed(1)}× ${esc(labels[bottom])} (${f(vals[bottom])}). The overall return rate ${where} is <strong>${f(overall)}</strong> ${when}.`;
    }
    if (spec.metric === 'pipeline') {
      if (spec.dimension === 'stage') {
        const late = vals[3] + vals[4];
        return `There’s <strong>${f(total)}</strong> in open pipeline ${where}. <strong>${f(late)}</strong> is in Negotiation or Verbal commit and is the most likely to close this quarter. The CRM sync is running right now, so these numbers may still change.`;
      }
      return `<strong>${esc(labels[top])}</strong> has the most open pipeline at ${f(vals[top])} (${pct(vals[top], total)}% of ${f(total)}). ${esc(labels[bottom])} has the least at ${f(vals[bottom])}.`;
    }
    if (spec.metric === 'revenue') {
      return `<strong>${esc(labels[top])}</strong> brought in the most net revenue ${when} at ${f(vals[top])} (${pct(vals[top], total)}% of ${f(total)} ${where}). ${labels.length > 1 ? `${esc(labels[byVal[1]])} was second at ${f(vals[byVal[1]])}, and ${esc(labels[bottom])} was lowest at ${f(vals[bottom])}.` : ''}`;
    }
    return `<strong>${esc(labels[top])}</strong> is highest for ${metricDef(spec.metric).label.toLowerCase()} ${when} at ${f(vals[top])}. ${labels.length > 1 ? `${esc(labels[bottom])} is lowest at ${f(vals[bottom])}.` : ''}`;
  }

  /* ======================================================================
     4. SVG charts: tap/click/keyboard to select; no hover-only behaviour
     ====================================================================== */
  function niceScale(maxVal) {
    if (!(maxVal > 0)) return { max: 1, ticks: [0, 1] };
    const rough = maxVal / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    const max = Math.ceil(maxVal / step) * step;
    const ticks = [];
    for (let v = 0; v <= max + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { max, ticks };
  }
  function niceRange(lo, hi) {
    const span = hi - lo || Math.abs(hi) * 0.2 || 1;
    let low = Math.max(0, lo - span * 0.5), high = hi + span * 0.15;
    const rough = (high - low) / 4;
    const mag = Math.pow(10, Math.floor(Math.log10(rough)));
    const n = rough / mag;
    const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * mag;
    low = Math.floor(low / step) * step; high = Math.ceil(high / step) * step;
    const ticks = [];
    for (let v = low; v <= high + step / 2; v += step) ticks.push(+v.toFixed(6));
    return { min: low, max: high, ticks };
  }
  const clip = (s, n) => (s.length > n ? s.slice(0, Math.max(1, n - 1)) + '…' : s);
  function barPath(x, y, w, h, r) {
    r = Math.min(r, h, w / 2);
    if (h <= 0) return '';
    return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
  }
  function hbarPath(x, y, w, h, r) {
    r = Math.min(r, w, h / 2);
    if (w <= 0) return '';
    return `M${x},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h - r}Q${x + w},${y + h} ${x + w - r},${y + h}H${x}Z`;
  }

  // Chart container API: mountChart(el, data, { type, height, drill })
  const chartRO = 'ResizeObserver' in window ? new ResizeObserver((entries) => {
    entries.forEach((e) => {
      const el = e.target;
      if (el._chart && Math.abs(el.clientWidth - (el._chart.lastW || 0)) > 2) drawChart(el);
    });
  }) : null;

  function mountChart(el, data, opts) {
    el._chart = { data, opts: opts || {}, sel: null };
    el.innerHTML = '<div class="chart__plot"></div><div class="readout" aria-live="polite"></div>';
    drawChart(el);
    if (chartRO) chartRO.observe(el);
  }

  function drawChart(el) {
    const c = el._chart;
    const plot = el.querySelector('.chart__plot');
    const W = Math.floor(plot.clientWidth || el.clientWidth);
    if (W < 60) return;
    c.lastW = W;
    plot.innerHTML = c.opts.type === 'hbar' ? drawHBar(c, W) : drawXY(c, W);
    updateReadout(el);
  }

  function selectPoint(el, i, refocus) {
    const c = el._chart;
    c.sel = c.sel === i ? null : i;
    drawChart(el);
    if (refocus) { const h = el.querySelector(`.hit[data-i="${i}"]`); if (h) h.focus({ preventScroll: true }); }
  }

  function ariaFor(c, i) {
    const { labels, series, format } = c.data;
    return `${labels[i]}: ` + series.map((s) => `${s.name} ${fmtValue(s.values[i], format)}`).join(', ');
  }

  function drawXY(c, W) {
    const { labels, series, format } = c.data;
    const type = c.opts.type === 'line' ? 'line' : 'bar';
    const H = c.opts.height || (W < 480 ? 210 : 250);
    const all = series.flatMap((s) => s.values).filter((v) => v != null);
    // Bars always start at zero; lines may use a tighter range so the trend is readable
    const { min, max, ticks } = type === 'line' ? niceRange(Math.min(...all), Math.max(...all)) : Object.assign({ min: 0 }, niceScale(Math.max(...all, 0)));
    const yl = ticks.map((t) => fmtValue(t, format, true));
    const left = Math.max(...yl.map((l) => l.length)) * 6.6 + 12;
    const top = 14, bottom = 30, right = 6;
    const pw = W - left - right, ph = H - top - bottom;
    const n = labels.length, band = pw / n;
    const y = (v) => top + ph - ((v - min) / (max - min)) * ph;
    const xc = (i) => left + band * (i + 0.5);
    const sel = c.sel;
    let g = '';

    if (sel != null) g += `<rect class="sel-band" x="${left + band * sel}" y="${top - 6}" width="${band}" height="${ph + 6}" rx="6"/>`;
    ticks.forEach((t, k) => {
      const yy = y(t);
      g += `<line class="${k === 0 ? 'baseline' : 'gridline'}" x1="${left}" x2="${W - right}" y1="${yy}" y2="${yy}"/>`;
      g += `<text x="${left - 8}" y="${yy + 4}" text-anchor="end">${esc(yl[k])}</text>`;
    });
    const every = band < 34 ? 2 : 1;
    const maxChars = Math.max(3, Math.floor(band / 6.8));
    labels.forEach((l, i) => {
      if (i % every) return;
      g += `<text class="axis-label" x="${xc(i)}" y="${H - 10}" text-anchor="middle">${esc(clip(l, maxChars))}</text>`;
    });

    const primary = series[0].values, tgt = series[1] ? series[1].values : null;
    if (type === 'bar') {
      const bw = Math.min(44, band * 0.58);
      primary.forEach((v, i) => {
        const yy = y(v);
        g += `<path class="bar ${sel != null && sel !== i ? 'is-dim' : ''}" d="${barPath(xc(i) - bw / 2, yy, bw, top + ph - yy, 4)}"/>`;
        if (tgt) g += `<line class="target-tick" x1="${xc(i) - bw / 2 - 5}" x2="${xc(i) + bw / 2 + 5}" y1="${y(tgt[i])}" y2="${y(tgt[i])}"/>`;
      });
      if (sel != null) g += `<text class="value-label" x="${xc(sel)}" y="${Math.min(y(primary[sel]), tgt ? y(tgt[sel]) : 1e9) - 7}" text-anchor="middle">${esc(fmtValue(primary[sel], format, true))}</text>`;
    } else {
      const pts = primary.map((v, i) => [xc(i), y(v)]);
      if (pts.length > 1) g += `<path class="area" d="M${pts[0][0]},${top + ph} ${pts.map((p) => `L${p[0]},${p[1]}`).join(' ')} L${pts[pts.length - 1][0]},${top + ph}Z"/>`;
      if (tgt) g += `<path class="line line--target" d="${tgt.map((v, i) => `${i ? 'L' : 'M'}${xc(i)},${y(v)}`).join(' ')}"/>`;
      g += `<path class="line" d="${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ')}"/>`;
      if (sel != null) g += `<line class="baseline" x1="${xc(sel)}" x2="${xc(sel)}" y1="${top}" y2="${top + ph}" stroke-dasharray="3 3"/>`;
      pts.forEach((p, i) => { g += `<circle class="dot" cx="${p[0]}" cy="${p[1]}" r="${sel === i ? 6 : 4}"/>`; });
      if (tgt && sel != null) g += `<circle class="dot dot--target" cx="${xc(sel)}" cy="${y(tgt[sel])}" r="4.5"/>`;
      if (sel != null) g += `<text class="value-label" x="${Math.min(Math.max(xc(sel), left + 24), W - 24)}" y="${y(primary[sel]) - 12}" text-anchor="middle">${esc(fmtValue(primary[sel], format, true))}</text>`;
    }
    // Tap targets: a full-height column per data point (≥44px tall, as wide as the band)
    labels.forEach((l, i) => {
      g += `<rect class="hit" data-i="${i}" x="${left + band * i}" y="0" width="${band}" height="${H}" tabindex="0" role="button" aria-pressed="${sel === i}" aria-label="${esc(ariaFor(c, i))}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="${esc(c.opts.label || 'Chart')}">${g}</svg>`;
  }

  function drawHBar(c, W) {
    const { labels, series, format } = c.data;
    const rowH = 44;
    const H = labels.length * rowH + 4;
    const labelW = Math.min(Math.round(W * 0.4), 190);
    const valueW = 62;
    const pw = Math.max(40, W - labelW - valueW - 8);
    const primary = series[0].values, tgt = series[1] ? series[1].values : null;
    const max = Math.max(...primary, ...(tgt || [0])) || 1;
    const sel = c.sel;
    let g = '';
    labels.forEach((l, i) => {
      const y0 = i * rowH;
      const w = (primary[i] / max) * pw;
      if (sel === i) g += `<rect class="sel-band" x="0" y="${y0 + 2}" width="${W}" height="${rowH - 4}" rx="6"/>`;
      g += `<text class="hbar-label" x="4" y="${y0 + rowH / 2 + 4}">${esc(clip(l, Math.floor(labelW / 7)))}</text>`;
      g += `<path class="bar ${sel != null && sel !== i ? 'is-dim' : ''}" d="${hbarPath(labelW, y0 + 13, w, rowH - 26, 4)}"/>`;
      let end = labelW + w;
      if (tgt) { const tx = labelW + (tgt[i] / max) * pw; end = Math.max(end, tx); g += `<line class="target-tick" x1="${tx}" x2="${tx}" y1="${y0 + 8}" y2="${y0 + rowH - 8}"/>`; }
      g += `<text class="value-label" x="${end + 6}" y="${y0 + rowH / 2 + 4}">${esc(fmtValue(primary[i], format, true))}</text>`;
      g += `<rect class="hit" data-i="${i}" x="0" y="${y0}" width="${W}" height="${rowH}" tabindex="0" role="button" aria-pressed="${sel === i}" aria-label="${esc(ariaFor(c, i))}"/>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-label="${esc(c.opts.label || 'Chart')}">${g}</svg>`;
  }

  function updateReadout(el) {
    const c = el._chart, r = el.querySelector('.readout');
    if (!r) return;
    const drill = c.opts.drill;
    if (c.sel == null) {
      const what = c.opts.type === 'line' ? 'point' : 'bar';
      r.innerHTML = `<span class="readout__hint">${icon('info', 'icon--sm')}Tap a ${what} to see its values${drill ? ' and break it down' : ''}</span>`;
      return;
    }
    const i = c.sel, { labels, series, format, ids } = c.data;
    let vals = series.map((s) => `<span>${esc(s.name)} <strong>${esc(fmtValue(s.values[i], format))}</strong></span>`).join('');
    if (series[1]) vals += `<span>Attainment <strong>${Math.round((series[0].values[i] / series[1].values[i]) * 100)}%</strong></span>`;
    const drillBtn = drill ? `<button type="button" class="btn btn--sm" data-action="open-drill" data-region="${esc(ids[i])}" data-range="${esc(drill.range)}">Break down ${esc(labels[i])}${icon('chevron-right')}</button>` : '';
    r.innerHTML = `<div class="readout__values"><strong>${esc(labels[i])}</strong>${vals}</div>${drillBtn}`;
  }

  // Tap/click and keyboard on chart hit areas (event delegation)
  document.addEventListener('click', (e) => {
    const hit = e.target.closest && e.target.closest('.chart .hit');
    if (!hit) return;
    const el = hit.closest('.chart');
    selectPoint(el, +hit.dataset.i, e.detail === 0);
  });
  document.addEventListener('keydown', (e) => {
    const hit = e.target.closest && e.target.closest('.chart .hit');
    if (!hit || (e.key !== 'Enter' && e.key !== ' ')) return;
    e.preventDefault();
    selectPoint(hit.closest('.chart'), +hit.dataset.i, true);
  });

  function legendHTML(data, type) {
    if (data.series.length < 2) return '';
    const tgt = type === 'line' ? 'swatch--dash' : 'swatch--tick';
    return `<div class="chart-legend"><span><i class="swatch"></i>Actual</span><span><i class="swatch ${tgt}"></i>Target</span></div>`;
  }
  function chartTypeFor(spec) { return spec.chartType; }

  function sparkline(values) {
    const v = values.filter((x) => x != null);
    if (v.length < 2) return '';
    const w = 84, h = 28, min = Math.min(...v), max = Math.max(...v), rng = max - min || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 3 - ((x - min) / rng) * (h - 6)}`).join(' ');
    return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  /* ======================================================================
     5. Shell, router, render
     ====================================================================== */
  const layout = () => (window.innerWidth < 768 ? 'phone' : window.innerWidth < 1280 ? 'tablet' : 'desktop');

  function parseRoute(hash) {
    const parts = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    switch (parts[0]) {
      case 'chat': return { name: 'chat' };
      case 'pipelines': return { name: 'pipelines' };
      case 'pipeline': return getPipeline(parts[1]) ? { name: 'pipeline', id: parts[1], step: parts[2] || null } : { name: 'pipelines' };
      case 'dashboard': return { name: 'dashboard', id: D.DASHBOARDS.some((d) => d.id === parts[1]) ? parts[1] : 'sales-overview' };
      default: return { name: 'dashboard', id: 'sales-overview' };
    }
  }
  const routeKey = (r) => r.name + ':' + (r.id || '');

  // Navigation goes through go() so unsaved step edits can be protected
  let guardPassed = false;
  let currentHash = location.hash;
  async function go(hash, opts) {
    const replace = opts && opts.replace;
    if (!(await canLeave(parseRoute(location.hash), parseRoute(hash)))) return;
    if (replace) { history.replaceState(null, '', hash); currentHash = hash; render(); }
    else if (location.hash !== hash) { guardPassed = true; location.hash = hash; }
    else render();
  }
  window.addEventListener('hashchange', async () => {
    if (guardPassed) { guardPassed = false; currentHash = location.hash; render(); return; }
    const target = location.hash;
    const ok = await canLeave(parseRoute(currentHash), parseRoute(target), true);
    if (!ok) { history.replaceState(null, '', currentHash); return; }
    currentHash = target; render();
  });

  // Ask before throwing away unsaved step edits
  async function canLeave(from, to, alreadyMoved) {
    if (from.name !== 'pipeline' || !from.step) return true;
    if (to.name === 'pipeline' && to.id === from.id && to.step === from.step) return true;
    const key = `${from.id}/${from.step}`;
    const draft = state.drafts[key];
    if (!draft || !isDirty(from.id, from.step)) return true;
    if (alreadyMoved) history.replaceState(null, '', currentHash);
    const step = getStep(getPipeline(from.id), from.step);
    const ok = await confirmDialog({
      title: 'Discard unsaved changes?',
      message: `You changed settings on “${step.name}” that haven’t been saved.`,
      confirmLabel: 'Discard changes', cancelLabel: 'Keep editing', danger: true,
    });
    if (ok) {
      delete state.drafts[key];
      if (alreadyMoved) { guardPassed = false; currentHash = location.hash; }
    }
    return ok;
  }

  const main = $('#main');

  function renderShell(route, mode) {
    const app = $('#app');
    const pref = state.sidebarPref || (window.innerWidth < 1024 ? 'rail' : 'expanded');
    app.dataset.sidebar = pref;
    const tgl = $('.topbar__sidebar-toggle');
    tgl.setAttribute('aria-expanded', String(pref === 'expanded'));
    tgl.setAttribute('aria-label', pref === 'expanded' ? 'Collapse sidebar' : 'Expand sidebar');

    const failed = state.pipelines.filter((p) => pipelineStatus(p) === 'failed');
    const cur = (cond) => (cond ? 'aria-current="page"' : '');
    const pinsIn = (id) => state.pins.filter((p) => p.dashboardId === id).length;
    const pipeSub = (p) => {
      const st = pipelineStatus(p);
      const s = STATUS[st];
      return `<span class="nav-link__sub nav-link__sub--${st}">${icon(s.icon)}${s.label}</span>`;
    };
    $('#sidebar-nav').innerHTML = `
      <div class="nav--full">
        <a class="nav-link" href="#chat" ${cur(route.name === 'chat')}>${icon('vega')}<span class="nav-link__text"><span class="nav-link__title">Ask Vega</span></span></a>
        <div class="nav-section">
          <p class="nav-section__title">Dashboards</p>
          ${D.DASHBOARDS.map((d) => `<a class="nav-link" href="#dashboard/${d.id}" ${cur(route.name === 'dashboard' && route.id === d.id)}>${icon('dashboard')}<span class="nav-link__text"><span class="nav-link__title truncate">${esc(d.name)}</span>${pinsIn(d.id) ? `<span class="nav-link__sub">${pinsIn(d.id)} pinned</span>` : ''}</span></a>`).join('')}
        </div>
        <div class="nav-section">
          <p class="nav-section__title">Pipelines</p>
          <a class="nav-link" href="#pipelines" ${cur(route.name === 'pipelines')}>${icon('pipeline')}<span class="nav-link__text"><span class="nav-link__title">All pipelines</span></span></a>
          ${state.pipelines.map((p) => `<a class="nav-link" href="#pipeline/${p.id}" ${cur(route.name === 'pipeline' && route.id === p.id)}><span class="icon"></span><span class="nav-link__text"><span class="nav-link__title truncate">${esc(p.name)}</span>${pipeSub(p)}</span></a>`).join('')}
        </div>
      </div>
      <div class="nav--rail">
        <a class="nav-link" href="#chat" ${cur(route.name === 'chat')}>${icon('vega')}<span class="nav-link__text"><span class="nav-link__title">Chat</span></span></a>
        <a class="nav-link" href="#dashboard" ${cur(route.name === 'dashboard')}>${icon('dashboard')}<span class="nav-link__text"><span class="nav-link__title">Dashboard</span></span></a>
        <a class="nav-link" href="#pipelines" ${cur(route.name === 'pipelines' || route.name === 'pipeline')}>${icon('pipeline')}<span class="nav-link__text"><span class="nav-link__title">Pipelines</span>${failed.length ? `<span class="rail-badge">${icon('fail')}${failed.length} failed</span>` : ''}</span></a>
      </div>`;

    // Phone tab bar
    const tab = route.name === 'pipeline' ? 'pipelines' : route.name;
    $$('.tabbar__item').forEach((a) => (a.dataset.tab === tab ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
    const badge = $('#tab-badge');
    badge.hidden = !failed.length;
    badge.innerHTML = failed.length ? `${failed.length}<span class="sr-only"> failed pipeline</span>` : '';

    // Topbar title
    let title = '';
    if (route.name === 'chat') title = `<span class="truncate">Ask Vega</span>`;
    else if (route.name === 'dashboard') title = `<span class="truncate">${esc(dashboardName(route.id))}</span>`;
    else if (route.name === 'pipelines') title = `<span class="truncate">Pipelines</span>`;
    else if (route.name === 'pipeline') {
      const p = getPipeline(route.id);
      title = mode === 'phone'
        ? `<a class="icon-btn" href="#pipelines" aria-label="Back to pipelines">${icon('chevron-left')}</a><span class="truncate">${esc(p.name)}</span>`
        : `<a class="crumb" href="#pipelines">Pipelines</a>${icon('chevron-right', 'icon--sm')}<span class="truncate">${esc(p.name)}</span>`;
    }
    $('#topbar-title').innerHTML = title;
    const plainTitle = route.name === 'pipeline' ? getPipeline(route.id).name : route.name === 'dashboard' ? dashboardName(route.id) : route.name === 'chat' ? 'Ask Vega' : 'Pipelines';
    document.title = `${plainTitle} · Astera Studio`;
  }

  function render() {
    const route = parseRoute(location.hash);
    const mode = layout();
    const key = routeKey(route);
    const changed = key !== state.lastRouteKey;
    const focusId = document.activeElement && document.activeElement.id;
    const sel = focusId && document.activeElement.selectionStart != null ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null;
    const scrollY = window.scrollY;

    renderShell(route, mode);
    if (chartRO) chartRO.disconnect();
    let html = '';
    if (route.name === 'chat') html = chatView(mode);
    else if (route.name === 'dashboard') html = dashboardView(route, mode);
    else if (route.name === 'pipelines') html = pipelinesView(mode);
    else if (route.name === 'pipeline') html = pipelineView(route, mode);
    main.innerHTML = html;
    if (changed) { const v = $('.view', main); if (v) v.classList.add('view--enter'); }

    mountViewCharts(main);
    afterRender(route, mode);
    syncStepSheet(route, mode);
    $$('.sheet .chart').forEach((el) => el._chart && chartRO && chartRO.observe(el));

    if (changed) {
      state.lastRouteKey = key;
      if (route.name === 'chat') scrollChatToEnd(false);
      else window.scrollTo(0, 0);
      if (state.lastRouteKeyInit) main.focus({ preventScroll: true });
      state.lastRouteKeyInit = true;
    } else {
      window.scrollTo(0, scrollY);
      if (focusId) {
        const f = document.getElementById(focusId);
        if (f && !$('.sheet-backdrop')) {
          f.focus({ preventScroll: true });
          if (sel && f.setSelectionRange) try { f.setSelectionRange(sel[0], sel[1]); } catch (e) { /* ignore */ }
        }
      }
    }
    if (state.scrollToPin) {
      const card = document.getElementById('pin-' + state.scrollToPin);
      state.scrollToPin = null;
      if (card) card.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' });
    }
  }

  // Charts are emitted as placeholders <div class="chart" data-chart='{spec}'> and mounted here
  const chartRegistry = new Map();
  function chartSlot(id, spec, opts) {
    chartRegistry.set(id, { spec, opts: opts || {} });
    return `<div class="chart" id="chart-${id}" data-chart-id="${id}"></div>`;
  }
  function mountViewCharts(root) {
    $$('.chart[data-chart-id]', root).forEach((el) => {
      const entry = chartRegistry.get(el.dataset.chartId);
      if (!entry) return;
      const data = computeSeries(entry.spec);
      mountChart(el, data, Object.assign({ type: chartTypeFor(entry.spec), label: specTitle(entry.spec) }, entry.opts));
    });
  }

  function afterRender(route, mode) {
    // KPI swipe dots
    const kpis = $('.kpis', main), dots = $$('.kpi-dots span', main);
    if (kpis && dots.length) {
      kpis.addEventListener('scroll', () => {
        const cards = $$('.kpi', kpis);
        const i = Math.round(kpis.scrollLeft / (cards[0].offsetWidth + 12));
        dots.forEach((d, k) => d.classList.toggle('is-active', k === Math.min(i, dots.length - 1)));
      }, { passive: true });
    }
    fitCanvas();
  }

  /* ======================================================================
     6. Dashboard view
     ====================================================================== */
  // The four core charts are specs too, so they can be pinned/asked about the same way
  function coreCharts() {
    const { range, region } = state.filters;
    return [
      { id: 'rev-vs-target', pipeline: 'sales-daily', cls: 'chart-card--wide chart-card--priority',
        spec: { metric: 'attainment', dimension: region === 'all' ? 'region' : 'metro', chartType: 'bar', range, region }, drill: region === 'all' },
      { id: 'revenue-trend', pipeline: 'revenue-monthly', cls: 'chart-card--narrow',
        spec: { metric: 'revenue', dimension: 'month', chartType: 'line', range, region } },
      { id: 'open-pipeline', pipeline: 'opportunity-sync', cls: '', note: 'Snapshot: not affected by the date range',
        spec: { metric: 'pipeline', dimension: 'stage', chartType: 'hbar', range, region } },
      { id: 'returns-rate', pipeline: 'returns-weekly', cls: '',
        spec: { metric: 'returns', dimension: 'category', chartType: 'hbar', range, region } },
    ];
  }

  // Freshness + status line for a chart, and the stale-data warning when its pipeline failed
  function freshnessHTML(p) {
    const st = pipelineStatus(p);
    const prog = runProgress(p);
    let text;
    if (prog) text = `step ${prog.index} of ${prog.total} · data from ${timeEl(p.dataUpdatedAt)}`;
    else if (st === 'failed') text = `Updated ${timeEl(p.dataUpdatedAt)}`;
    else if (st === 'scheduled') text = `Updated ${timeEl(p.dataUpdatedAt)} · next run ${esc(p.nextRunLabel)}`;
    else text = `Updated ${timeEl(p.dataUpdatedAt)}`;
    return `<div class="freshness">${statusBadge(st)}<span>${text}</span><span aria-hidden="true">·</span><a href="#pipeline/${p.id}">${esc(p.name)}</a></div>`;
  }
  function staleHTML(p) {
    const st = pipelineStatus(p);
    if (st === 'failed') {
      return `<div class="stale" role="alert"><span class="stale__text">${icon('warning')}<span><strong>Data is ${timeEl(p.dataUpdatedAt, 'age')} old</strong>: pipeline failed. These numbers may be out of date.</span></span>
        <a class="btn btn--warn btn--sm" href="#pipeline/${p.id}">View &amp; fix pipeline</a></div>`;
    }
    if (state.runs[p.id] && p.status === 'failed') {
      return `<div class="stale">${icon('running', 'spin')}<span>Refreshing. Data stays ${timeEl(p.dataUpdatedAt, 'age')} old until the run finishes.</span></div>`;
    }
    return '';
  }

  function chartCardHTML(o) {
    const p = getPipeline(o.pipeline);
    const data = computeSeries(o.spec);
    const title = o.title || specTitle(data.spec);
    const askSpec = esc(JSON.stringify(o.spec));
    const body = data.empty
      ? `<div class="chart-empty">${icon('filter', 'icon--lg')}<p>${esc(data.emptyReason)}</p>${o.pin ? '' : '<button type="button" class="btn btn--sm" data-action="reset-filters">Reset filters</button>'}</div>`
      : `${legendHTML(data, o.spec.chartType)}${chartSlot(o.id, o.spec, { drill: o.drill ? { range: o.spec.range } : null })}`;
    const menu = o.pin ? `
      <div class="menu-wrap">
        <button type="button" class="icon-btn" data-action="toggle-menu" data-menu="m-${o.pin.id}" aria-haspopup="true" aria-expanded="false" aria-label="More actions for ${esc(title)}">${icon('more')}</button>
        <div class="menu" id="m-${o.pin.id}" role="menu" hidden>
          <button type="button" role="menuitem" data-action="ask-about" data-spec="${askSpec}" data-title="${esc(title)}">${icon('vega')}Ask Vega about this</button>
          <a role="menuitem" href="#pipeline/${p.id}">${icon('pipeline')}View source pipeline</a>
          <button type="button" role="menuitem" class="danger" data-action="remove-pin" data-pin="${o.pin.id}">${icon('close')}Remove from dashboard</button>
        </div>
      </div>` : '';
    return `
      <article class="card chart-card ${o.cls || ''}" ${o.pin ? `id="pin-${o.pin.id}"` : ''}>
        <div class="chart-card__head">
          <div class="chart-card__titles">
            <h2>${o.pin ? `<button type="button" class="truncate-btn" data-action="expand" aria-expanded="false">${esc(title)}</button>` : esc(title)}</h2>
            ${o.pin ? `<p class="pin-card__question truncate">“${esc(o.pin.question)}” · ${esc(specFilterLabel(o.spec))}</p>` : ''}
            ${freshnessHTML(p)}
          </div>
          ${menu}
        </div>
        ${staleHTML(p)}
        ${o.note ? `<p class="chart-card__note">${icon('info', 'icon--sm')}${esc(o.note)}</p>` : ''}
        ${body}
        ${o.pin ? '' : `<div class="chart-card__actions">
          <button type="button" class="btn btn--vega btn--sm" data-action="ask-about" data-spec="${askSpec}" data-title="${esc(title)}">${icon('vega')}Ask Vega about this</button>
          <a class="btn btn--ghost btn--sm" href="#pipeline/${p.id}">${icon('pipeline')}View pipeline</a>
        </div>`}
      </article>`;
  }

  function kpiHTML() {
    const { range, region } = state.filters;
    const regs = regionsFor(region);
    const cur = kpiValues(regs, partsFor(range));
    const R = D.RANGES[range];
    const prev = R.prior ? kpiValues(regs, R.prior) : null;
    const monthly = [1, 2, 3, 4, 5, 6].map((m) => kpiValues(regs, [[m, 1]]));
    const defs = [
      { key: 'revenue', label: 'Net revenue', fmt: (v) => fmtValue(v, 'currency') },
      { key: 'margin', label: 'Gross margin', fmt: (v) => fmtValue(v, 'percent'), pts: true },
      { key: 'orders', label: 'Orders', fmt: (v) => fmtInt(v) },
      { key: 'aov', label: 'Avg order value', fmt: (v) => fmtValue(v, 'dollars') },
    ];
    const p = getPipeline('revenue-monthly');
    const cards = defs.map((d) => {
      const v = cur ? cur[d.key] : null;
      let delta = `<span class="delta">${R.prior ? 'No prior data' : 'No comparison period'}</span>`;
      if (cur && prev && prev[d.key]) {
        const ch = d.pts ? v - prev[d.key] : ((v - prev[d.key]) / prev[d.key]) * 100;
        const up = ch >= 0;
        delta = `<span class="delta delta--${up ? 'up' : 'down'}">${up ? '▲' : '▼'} ${Math.abs(ch).toFixed(1)}${d.pts ? ' pts' : '%'} <span class="muted">${esc(R.priorLabel)}</span></span>`;
      }
      if (!cur) delta = `<span class="delta">No data for these filters</span>`;
      return `<div class="card kpi"><span class="kpi__label">${d.label}</span><span class="kpi__value">${v == null ? '—' : d.fmt(v)}</span>
        <div class="kpi__foot">${delta}${sparkline(monthly.map((x) => (x ? x[d.key] : null)))}</div></div>`;
    }).join('');
    return `<section aria-label="Key metrics, fed by ${esc(p.name)}"><div class="kpis">${cards}</div><div class="kpi-dots" aria-hidden="true">${defs.map((d, i) => `<span class="${i ? '' : 'is-active'}"></span>`).join('')}</div></section>`;
  }

  // Overall "is my data OK?" summary used by the header, the phone strip and the health sheet
  function dataHealth(pipelineIds) {
    const ps = pipelineIds.map(getPipeline);
    const failed = ps.filter((p) => pipelineStatus(p) === 'failed');
    const running = ps.filter((p) => state.runs[p.id]);
    const newest = Math.max(...ps.map((p) => p.dataUpdatedAt));
    return { ps, failed, running, newest };
  }

  function dataStripHTML(h) {
    if (h.failed.length) {
      const p = h.failed[0];
      return `<div class="data-strip data-strip--bad">${icon('warning', 'icon--lg')}
        <span class="data-strip__text"><span class="data-strip__title">${h.failed.length} chart has stale data</span><span class="data-strip__sub">${esc(p.name)} failed · data ${timeEl(p.dataUpdatedAt, 'age')} old</span></span>
        <a class="btn btn--danger btn--sm" href="#pipeline/${p.id}">Fix</a>
        <button type="button" class="btn btn--ghost btn--sm" data-action="open-health" aria-label="Data health details">Details</button></div>`;
    }
    if (h.running.length) {
      const p = h.running[0], prog = runProgress(p);
      return `<div class="data-strip">${icon('running', 'icon--lg spin')}
        <span class="data-strip__text"><span class="data-strip__title">Refreshing ${esc(p.name)}</span><span class="data-strip__sub">Step ${prog.index} of ${prog.total} · <span data-elapsed="${state.runs[p.id].startedAt}">${elapsed(state.runs[p.id].startedAt)}</span></span></span>
        <button type="button" class="btn btn--ghost btn--sm" data-action="open-health">Details</button></div>`;
    }
    return `<div class="data-strip data-strip--good">${icon('check', 'icon--lg')}
      <span class="data-strip__text"><span class="data-strip__title">Your data is OK</span><span class="data-strip__sub">Latest update ${timeEl(h.newest)} · ${h.ps.length} pipelines checked</span></span>
      <button type="button" class="btn btn--ghost btn--sm" data-action="open-health">Details</button></div>`;
  }

  function filterControlsHTML() {
    const { range, region } = state.filters;
    const isDefault = range === 'q3' && region === 'all';
    return `<div class="dash-controls dash-controls--inline" role="group" aria-label="Dashboard filters">
        <div class="segmented" role="group" aria-label="Date range">
          ${Object.values(D.RANGES).map((r) => `<button type="button" data-action="set-range" data-range="${r.id}" aria-pressed="${r.id === range}">${esc(r.short)}</button>`).join('')}
        </div>
        <label class="sr-only" for="region-select">Region</label>
        <select class="select" id="region-select" data-action="set-region">
          ${['all', ...D.REGIONS.map((r) => r.id)].map((id) => `<option value="${id}" ${id === region ? 'selected' : ''}>${esc(regionName(id))}</option>`).join('')}
        </select>
        ${isDefault ? '' : `<button type="button" class="btn btn--ghost btn--sm" data-action="reset-filters">${icon('reset')}Reset</button>`}
      </div>`;
  }

  function dashboardView(route, mode) {
    chartRegistry.clear();
    const dash = D.DASHBOARDS.find((d) => d.id === route.id);
    const pins = state.pins.filter((p) => p.dashboardId === dash.id);
    // Dashboard switcher: a native select on desktop; on iPad the title itself is the
    // switcher, and on iPhone it's a chip. Both open a sheet (no iOS zoom-on-focus).
    const switcher = `<label class="sr-only" for="dash-select">Switch dashboard</label>
      <select class="select dash-select-desktop" id="dash-select" data-action="switch-dashboard">${D.DASHBOARDS.map((d) => `<option value="${d.id}" ${d.id === dash.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
    const switchLabel = `aria-haspopup="dialog" aria-label="${esc(dash.name)}. Switch dashboard"`;
    const titleHTML = `<h1><span class="dash-h1-text">${esc(dash.name)}</span><button type="button" class="dash-title-btn" data-action="open-dashboards" ${switchLabel}><span class="truncate">${esc(dash.name)}</span>${icon('chevron-down')}</button></h1>`;
    const dashChip = `<button type="button" class="chip dash-chip" data-action="open-dashboards" ${switchLabel}>${icon('dashboard')}<span class="truncate">${esc(dash.name)}</span>${icon('chevron-down', 'icon--sm')}</button>`;

    const pinCards = pins.map((pin) => chartCardHTML({
      id: 'pin-' + pin.id, pipeline: D.sourceFor(pin.spec.metric, pin.spec.dimension), spec: pin.spec, pin, cls: 'pin-card', title: pin.title,
    })).join('');

    if (!dash.core) {
      const ids = [...new Set(pins.map((p) => D.sourceFor(p.spec.metric, p.spec.dimension)))];
      const h = ids.length ? dataHealth(ids) : null;
      return `<div class="view view--dashboard">
        ${h ? dataStripHTML(h) : ''}
        <header class="view-header">
          <div class="view-header__text"><p class="view-header__eyebrow">${esc(D.company)} · Dashboard</p>${titleHTML}</div>
          <div class="view-header__actions">${switcher}</div>
        </header>
        <div class="filter-chip-row">${dashChip}</div>
        ${pins.length ? `<div class="pins">${pinCards}</div>` : `
          <div class="empty">
            <div class="empty__icon">${icon('pin', 'icon--lg')}</div>
            <h2>No charts here yet</h2>
            <p>${esc(dash.description)}. Ask Vega a question in Chat, then tap <strong>Pin to dashboard</strong> on the answer to add it here.</p>
            <a class="btn btn--primary" href="#chat">${icon('vega')}Ask Vega a question</a>
          </div>`}
      </div>`;
    }

    const charts = coreCharts();
    const h = dataHealth(['sales-daily', 'revenue-monthly', 'opportunity-sync', 'returns-weekly']);
    const overall = h.failed.length ? 'failed' : h.running.length ? 'running' : 'succeeded';
    const { range, region } = state.filters;
    const isDefault = range === 'q3' && region === 'all';
    const healthCards = h.ps.map((p) => {
      const st = pipelineStatus(p), prog = runProgress(p);
      const sub = prog ? `Step ${prog.index} of ${prog.total}` : st === 'failed' ? `Data ${timeEl(p.dataUpdatedAt, 'age')} old` : st === 'scheduled' ? `Next run ${esc(p.nextRunLabel)}` : `Updated ${timeEl(p.dataUpdatedAt)}`;
      return `<a class="health__item ${st === 'failed' ? 'health__item--failed' : ''}" href="#pipeline/${p.id}">
        <span class="health__name truncate">${esc(p.name)}</span>
        <span class="health__row">${statusBadge(st)}<span class="xsmall muted truncate">${sub}</span></span></a>`;
    }).join('');

    return `<div class="view view--dashboard">
      ${dataStripHTML(h)}
      <header class="view-header">
        <div class="view-header__text">
          <p class="view-header__eyebrow">${esc(D.company)} · Dashboard</p>
          ${titleHTML}
          <div class="freshness" style="margin-top:6px">${statusBadge(overall, overall === 'failed' ? '1 pipeline failed' : overall === 'running' ? 'Refreshing' : 'All data fresh')}
            <span>Latest update ${timeEl(h.newest)}${h.failed.length ? ' · 1 chart has stale data' : ''}</span></div>
        </div>
        <div class="view-header__actions">${switcher}${filterControlsHTML()}</div>
      </header>
      <div class="filter-chip-row">
        ${dashChip}
        <button type="button" class="chip ${isDefault ? '' : 'chip--brand'}" data-action="open-filters" aria-label="Filters: ${esc(D.RANGES[range].short)}, ${esc(regionName(region))}">${icon('sliders')}${esc(D.RANGES[range].short)} · ${esc(regionName(region))}</button>
        ${isDefault ? '' : `<button type="button" class="chip" data-action="reset-filters">${icon('reset')}Reset</button>`}
      </div>
      <section class="health" aria-label="Pipeline status">${healthCards}</section>
      ${kpiHTML()}
      <section class="charts" aria-label="Charts">${charts.map(chartCardHTML).join('')}</section>
      <div class="section-title"><h2>Pinned from chat</h2><a class="link-btn" href="#chat">${icon('plus', 'icon--sm')}Add from chat</a></div>
      ${pins.length ? `<div class="pins">${pinCards}</div>` : `<div class="empty"><div class="empty__icon">${icon('pin', 'icon--lg')}</div><p>Answers you pin from Chat show up here, with the same freshness and status checks as the charts above.</p><a class="btn" href="#chat">${icon('vega')}Ask Vega</a></div>`}
    </div>`;
  }

  /* ======================================================================
     7. Pipelines list + pipeline detail
     ====================================================================== */
  function pipelinesView() {
    const cards = state.pipelines.map((p) => {
      const st = pipelineStatus(p), prog = runProgress(p);
      const flow = p.steps.filter((s) => s.type !== 'database').map((s) => `<span class="mini-flow__step ${s.status === 'failed' ? 'mini-flow__step--failed' : s.status === 'running' ? 'mini-flow__step--running' : ''}" title="${esc(s.name)}">${icon(TYPE_ICON[s.type])}</span>`).join('<span class="mini-flow__sep"></span>');
      return `<a class="card pl-card" href="#pipeline/${p.id}">
        <div class="pl-card__top"><div style="min-width:0"><h2 class="truncate">${esc(p.name)}</h2><p class="small muted">${esc(p.description)}</p></div>${statusBadge(st, prog ? `Running · step ${prog.index} of ${prog.total}` : null)}</div>
        <div class="mini-flow" aria-hidden="true">${flow}</div>
        ${st === 'failed' ? `<div class="stale"><span class="stale__text">${icon('warning')}<span>${esc((p.steps.find((s) => s.status === 'failed') || {}).name || 'A step')} failed · data ${timeEl(p.dataUpdatedAt, 'age')} old</span></span></div>` : ''}
        <dl class="pl-card__meta">
          <div><dt>Last run</dt><dd>${timeEl(p.lastRunAt)}</dd></div>
          <div><dt>Schedule</dt><dd class="truncate">${esc(p.schedule)}</dd></div>
          <div><dt>Owner</dt><dd>${esc(p.owner)}</dd></div>
        </dl></a>`;
    }).join('');
    return `<div class="view"><header class="view-header"><div class="view-header__text"><p class="view-header__eyebrow">${esc(D.company)}</p><h1>Pipelines</h1></div></header><div class="pl-list">${cards}</div></div>`;
  }

  const FIELDS = {
    excel: [
      { key: 'file', label: 'Source file', kind: 'select', options: () => D.STEP_OPTIONS.files },
      { key: 'sheet', label: 'Sheet name', kind: 'text' },
      { key: 'headerRow', label: 'Header row', kind: 'number', suffix: 'row number' },
    ],
    filter: [
      { key: 'condition', label: 'Keep rows where', kind: 'text', help: "For example: status != 'Cancelled'" },
      { key: 'dateFrom', label: 'Orders from', kind: 'date', help: 'Rows before this date are dropped.' },
    ],
    database: [
      { key: 'connection', label: 'Connection', kind: 'readonly' },
      { key: 'table', label: 'Table', kind: 'readonly', help: 'Pointing at a different table is a structural edit (desktop).' },
      { key: 'columns', label: 'Columns', kind: 'text' },
    ],
    join: [
      { key: 'joinType', label: 'Join type', kind: 'select', options: () => D.STEP_OPTIONS.joinTypes },
      { key: 'joinKey', label: 'Join key', kind: 'readonly' },
      { key: 'timeoutSec', label: 'Connection timeout', kind: 'number', suffix: 'seconds', help: 'Between 5 and 300 seconds.' },
      { key: 'credentials', label: 'Credentials reference', kind: 'select', options: () => D.STEP_OPTIONS.credentials },
    ],
    transform: [{ key: 'expressions', label: 'Expressions', kind: 'textarea', help: 'One per line, in the form name = expression.' }],
    output: [
      { key: 'dashboard', label: 'Dashboard', kind: 'readonly' },
      { key: 'chart', label: 'Chart', kind: 'readonly' },
      { key: 'writeMode', label: 'Write mode', kind: 'select', options: () => D.STEP_OPTIONS.writeModes },
    ],
  };
  const TOGGLEABLE = ['filter', 'transform'];

  function validateField(key, value) {
    const v = String(value == null ? '' : value).trim();
    switch (key) {
      case 'timeoutSec': {
        if (!v) return 'Enter a timeout in seconds.';
        const n = Number(v);
        if (!Number.isInteger(n)) return 'Use a whole number of seconds.';
        if (n < 5 || n > 300) return 'Timeout must be between 5 and 300 seconds.';
        return null;
      }
      case 'headerRow': {
        const n = Number(v);
        if (!v || !Number.isInteger(n) || n < 1 || n > 50) return 'Header row must be a whole number from 1 to 50.';
        return null;
      }
      case 'sheet': return v ? null : 'Enter the sheet name.';
      case 'columns': return v ? null : 'List at least one column.';
      case 'condition':
        if (!v) return 'Enter a condition, or turn this step off instead.';
        if (!/(!=|>=|<=|=|<|>|\bin\b|\blike\b)/i.test(v)) return "Use a comparison, e.g. status != 'Cancelled'.";
        return null;
      case 'dateFrom': {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) return 'Enter a valid date.';
        if (Date.parse(v) > Date.now()) return 'The date can’t be in the future.';
        if (v < '2025-01-01') return 'The source file starts in January 2025. Pick a later date.';
        return null;
      }
      case 'expressions':
        if (!v) return 'Add at least one expression.';
        if (v.split('\n').some((line) => line.trim() && !line.includes('='))) return 'Each line needs the form name = expression.';
        return null;
      default: return null;
    }
  }

  function draftFor(p, s) { return state.drafts[`${p.id}/${s.id}`]; }
  function draftValues(p, s) {
    const d = draftFor(p, s);
    return d ? d.values : Object.assign({}, s.config, { enabled: s.enabled });
  }
  function isDirty(pid, sid) {
    const p = getPipeline(pid), s = getStep(p, sid), d = state.drafts[`${pid}/${sid}`];
    if (!d) return false;
    return Object.keys(d.values).some((k) => String(d.values[k]) !== String(k === 'enabled' ? s.enabled : s.config[k]));
  }
  function draftErrors(p, s) {
    const vals = draftValues(p, s), errs = {};
    (FIELDS[s.type] || []).forEach((f) => { if (f.kind !== 'readonly') { const e = validateField(f.key, vals[f.key]); if (e) errs[f.key] = e; } });
    return errs;
  }

  function stepSubtitle(s) {
    const c = s.config;
    return { excel: c.file, filter: c.condition, database: c.table, join: `on ${c.joinKey}`, transform: (c.expressions || '').split('\n')[0], output: c.dashboard }[s.type] || '';
  }
  function rowsText(s) {
    if (s.rowsOut == null && s.rowsIn == null) return 'No rows yet';
    if (s.rowsIn == null) return `${fmtInt(s.rowsOut)} rows`;
    return `${fmtInt(s.rowsIn)} → ${s.rowsOut == null ? '…' : fmtInt(s.rowsOut)} rows`;
  }
  const stepStatus = (s) => (!s.enabled && s.status !== 'running' ? 'disabled' : s.status);

  // Header with status, run controls and banners (shared by all three layouts)
  function pipelineHeaderHTML(p, mode) {
    const st = pipelineStatus(p), prog = runProgress(p);
    const failedStep = p.steps.find((s) => s.status === 'failed');
    const busy = !!prog;
    let banner = '';
    if (prog) {
      const pct = prog.live ? Math.round(((prog.index - 0.5) / prog.total) * 100) : 0;
      banner = `<div class="run-banner" role="status">
        <div class="run-banner__row"><span>${icon('running', 'spin')} Running · step ${prog.index} of ${prog.total}: ${esc(prog.step.name)}</span>
        <span class="tabular">${prog.live ? `<span data-elapsed="${state.runs[p.id].startedAt}">${elapsed(state.runs[p.id].startedAt)}</span>` : `started ${timeEl(p.lastRunAt)}`}</span></div>
        <div class="progress ${prog.live ? '' : 'progress--indeterminate'}"><div class="progress__bar" style="width:${pct}%"></div></div></div>`;
    } else if (st === 'failed' && failedStep) {
      banner = `<div class="error-banner" role="alert"><span class="error-banner__text">${icon('warning')}<span><strong>${esc(failedStep.name)} failed:</strong> ${esc(failedStep.error)}</span></span>
        <button type="button" class="btn btn--sm" data-action="select-step" data-pipeline="${p.id}" data-step="${failedStep.id}">Open step</button></div>`;
    } else if (state.justRan[p.id] && st === 'succeeded') {
      banner = `<div class="success-banner" role="status">${icon('check')}<span>Run succeeded ${timeEl(p.lastRunAt)}. ${esc(p.steps[p.steps.length - 1].config.dashboard)} now has fresh data.</span>
        <a class="link-btn" href="#dashboard" style="margin-left:auto">View dashboard</a></div>`;
    }
    const lightEditHint = mode !== 'desktop'
      ? `<p class="hint">${icon('desktop')}<span>From ${mode === 'phone' ? 'your phone' : 'iPad'} you can check runs, change step settings, turn steps on or off, and re-run. <strong>Structural edits (adding, removing or rewiring steps) are available on desktop.</strong></span></p>` : '';
    return `<div class="pl-head">
      <div class="pl-head__row">
        <div class="pl-head__title">
          <h1><button type="button" class="truncate-btn" data-action="expand" aria-expanded="false">${esc(p.name)}</button></h1>
          ${statusBadge(st)}
        </div>
        <div class="pl-head__actions">
          <button type="button" class="btn btn--primary" data-action="rerun-pipeline" data-pipeline="${p.id}" ${busy ? 'disabled aria-disabled="true"' : ''}>
            ${busy ? `${icon('running', 'spin')}Running · step ${prog.index} of ${prog.total}` : `${icon('play')}Re-run pipeline`}</button>
        </div>
      </div>
      <div class="pl-head__meta">
        <span>${icon('clock', 'icon--sm')}Last run ${timeEl(p.lastRunAt)}</span>
        <span>${icon('reset', 'icon--sm')}${esc(p.schedule)}</span>
        <span>Data updated ${timeEl(p.dataUpdatedAt)}</span>
        <span>Owner: ${esc(p.owner)}</span>
      </div>
      ${banner}
      ${lightEditHint}
    </div>`;
  }

  // ---- Desktop canvas: positioned nodes + SVG connector curves ----
  const NODE = { w: 156, h: 128, gapX: 26, gapY: 24 };
  function nodePositions(p) {
    // Two sources stack in column 0; the join sits between the rows
    const pos = {};
    const midY = (NODE.h + NODE.gapY) / 2;
    p.steps.forEach((s) => {
      const col = { excel: 0, database: 0, filter: 1, join: 2, transform: 3, output: 4 }[s.type];
      let y = s.type === 'excel' || s.type === 'filter' ? 0 : s.type === 'database' ? NODE.h + NODE.gapY : midY;
      if (s.type === 'database') pos[s.id] = { x: col * (NODE.w + NODE.gapX) + (NODE.w + NODE.gapX) / 2, y };
      else pos[s.id] = { x: col * (NODE.w + NODE.gapX), y };
    });
    return pos;
  }
  function canvasHTML(p, selected) {
    const pos = nodePositions(p);
    const W = 5 * NODE.w + 4 * NODE.gapX, H = 2 * NODE.h + NODE.gapY;
    let edges = '';
    p.steps.forEach((s) => s.inputs.forEach((inId) => {
      const a = pos[inId], b = pos[s.id], src = getStep(p, inId);
      const x1 = a.x + NODE.w, y1 = a.y + NODE.h / 2, x2 = b.x, y2 = b.y + NODE.h / 2, dx = (x2 - x1) / 2;
      const cls = s.status === 'failed' ? 'edge--failed' : s.status === 'running' ? 'edge--active' : (src.status === 'succeeded' && s.status === 'succeeded') ? 'edge--done' : '';
      edges += `<path class="edge ${cls}" d="M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2}"/>`;
    }));
    const nodes = p.steps.map((s) => {
      const st = stepStatus(s);
      return `<button type="button" class="node node--${st}" style="left:${pos[s.id].x}px;top:${pos[s.id].y}px;width:${NODE.w}px;height:${NODE.h}px"
          data-action="select-step" data-pipeline="${p.id}" data-step="${s.id}" aria-pressed="${s.id === selected}" aria-label="${esc(s.name)}, ${STATUS[st].label}, ${rowsText(s)}">
        <span class="node__top"><span class="node__type">${icon(TYPE_ICON[s.type])}</span><span class="node__name">${esc(s.name)}</span></span>
        <span class="node__rows truncate">${esc(stepSubtitle(s))}</span>
        <span class="node__foot">${statusBadge(st)}</span>
        <span class="node__rows">${rowsText(s)}</span>
        ${s.inputs.length ? '<span class="node__port node__port--in"></span>' : ''}${s.type !== 'output' ? '<span class="node__port node__port--out"></span>' : ''}
      </button>`;
    }).join('');
    return `<div class="card canvas-card">
      <div class="canvas-toolbar"><h2 class="small">Pipeline canvas</h2>
        <div style="display:flex;gap:8px"><button type="button" class="btn btn--sm" data-action="structural">${icon('plus')}Add step</button></div></div>
      <div class="canvas-wrap" id="canvas-wrap"><div class="canvas" id="canvas" style="width:${W}px;height:${H}px" data-w="${W}" data-h="${H}">
        <svg class="edges" width="${W}" height="${H}" aria-hidden="true">${edges}</svg>${nodes}</div></div>
    </div>`;
  }
  // Scale the canvas down to fit its column (no horizontal scrolling)
  function fitCanvas() {
    const wrap = $('#canvas-wrap'), cv = $('#canvas');
    if (!wrap || !cv) return;
    const avail = wrap.clientWidth - 32;
    const scale = Math.min(1, avail / +cv.dataset.w);
    cv.style.transform = `scale(${scale})`;
    wrap.style.height = `${+cv.dataset.h * scale + 48}px`;
  }

  // ---- Timeline (phone) / step list (iPad): join shown as an indented sub-row ----
  function timelineHTML(p, selected) {
    const joinedSources = new Set(p.steps.filter((s) => s.type === 'join').flatMap((s) => s.inputs.filter((id) => getStep(p, id).type === 'database')));
    const items = p.steps.filter((s) => !joinedSources.has(s.id)).map((s) => {
      const st = stepStatus(s);
      const subs = s.type === 'join' ? s.inputs.filter((id) => joinedSources.has(id)).map((id) => {
        const src = getStep(p, id), sst = stepStatus(src);
        return `<button type="button" class="step-sub" data-action="select-step" data-pipeline="${p.id}" data-step="${src.id}" aria-current="${src.id === selected}">
          ${icon('plus')}<span style="display:flex;flex-direction:column;gap:2px;min-width:0;flex:1"><span class="truncate">joined with: <strong>${esc(src.config.table)}</strong></span>
          <span class="xsmall muted" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">${statusBadge(sst)}${fmtInt(src.rowsOut)} rows · ${esc(src.config.connection.split(' ')[0])}</span></span>${icon('chevron-right')}</button>`;
      }).join('') : '';
      return `<li class="timeline__item ${st === 'succeeded' ? 'timeline__item--done' : ''}">
        <button type="button" class="step-row" data-action="select-step" data-pipeline="${p.id}" data-step="${s.id}" aria-current="${s.id === selected}">
          <span class="step-dot step-dot--${st}">${icon(STATUS[st].icon)}</span>
          <span class="step-row__body">
            <span class="step-row__name">${icon(TYPE_ICON[s.type])}<span class="truncate">${esc(s.name)}</span></span>
            <span class="step-row__meta truncate">${esc(stepSubtitle(s))}</span>
            <span class="step-row__meta">${STATUS[st].label} · ${rowsText(s)}${s.durationSec != null ? ' · ' + fmtDur(s.durationSec) : ''}</span>
            ${s.status === 'failed' ? `<span class="step-row__err">${esc(s.error)}</span>` : ''}
          </span>
          <span class="step-row__right">${icon('chevron-right')}</span>
        </button>${subs}</li>`;
    }).join('');
    return `<ol class="timeline" aria-label="Pipeline steps">${items}</ol>`;
  }

  function runHistoryHTML(p) {
    return `<div><h3 style="margin-bottom:8px">Recent runs</h3><ul class="source-list">${state.history[p.id].slice(0, 4).map((r) =>
      `<li style="display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:36px">${statusBadge(r.status)}<span class="small muted">${timeEl(r.at)}</span><span class="small truncate" style="flex:1;text-align:right">${esc(r.note || '')}</span></li>`).join('')}</ul></div>`;
  }

  function pipelineSummaryHTML(p) {
    return `<div class="step-detail">
      <div><p class="small muted">Pipeline overview</p><h2>${esc(p.name)}</h2></div>
      <p class="small">${esc(p.description)}</p>
      <dl class="stats">
        <div><dt>Steps</dt><dd>${p.steps.length}</dd></div>
        <div><dt>Schedule</dt><dd>${esc(p.schedule)}</dd></div>
        <div><dt>Last run</dt><dd>${timeEl(p.lastRunAt)}</dd></div>
        <div><dt>Data updated</dt><dd>${timeEl(p.dataUpdatedAt)}</dd></div>
      </dl>
      ${runHistoryHTML(p)}
      <p class="hint">${icon('info')}<span>Select a step on the canvas to see its settings, rows and errors.</span></p>
    </div>`;
  }

  // Step details + light-edit form (used by the desktop inspector, iPad pane and phone sheet)
  function stepDetailHTML(p, s, mode) {
    const st = stepStatus(s);
    const vals = draftValues(p, s);
    const errs = draftErrors(p, s);
    const run = state.runs[p.id];
    const locked = !!runProgress(p);
    const inputs = s.inputs.map((id) => getStep(p, id));
    const fields = (FIELDS[s.type] || []).map((f) => {
      const id = `f-${p.id}-${s.id}-${f.key}`;
      const v = vals[f.key];
      const err = errs[f.key];
      const common = `id="${id}" data-field="${f.key}" data-pipeline="${p.id}" data-step="${s.id}" ${locked ? 'disabled' : ''} aria-describedby="${id}-help ${id}-err" ${err ? 'aria-invalid="true"' : ''}`;
      let control;
      if (f.kind === 'select') {
        const opts = f.options();
        const list = opts.includes(v) ? opts : [v, ...opts];
        control = `<select class="select" ${common}>${list.map((o) => `<option ${o === v ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>`;
      } else if (f.kind === 'textarea') control = `<textarea class="textarea" rows="3" ${common}>${esc(v)}</textarea>`;
      else if (f.kind === 'readonly') control = `<input class="input" id="${id}" value="${esc(v)}" readonly aria-describedby="${id}-help">`;
      else {
        const inputType = f.kind === 'number' ? 'number" inputmode="numeric' : f.kind === 'date' ? 'date' : 'text';
        control = `<input class="input" type="${inputType}" value="${esc(v)}" ${common}>`;
        if (f.suffix) control = `<span class="input-suffix">${control}<span class="small muted">${esc(f.suffix)}</span></span>`;
      }
      return `<div class="field"><label for="${id}">${esc(f.label)}${f.kind === 'readonly' ? ` <span class="muted xsmall">${icon('lock', 'icon--sm')}</span>` : ''}</label>${control}
        <p class="field__help" id="${id}-help">${esc(f.help || '')}</p>
        <p class="field__error" id="${id}-err" ${err ? '' : 'hidden'}>${icon('warning', 'icon--sm')}<span>${esc(err || '')}</span></p></div>`;
    }).join('');

    const toggle = TOGGLEABLE.includes(s.type) ? `
      <div class="toggle-row"><div><label for="f-${p.id}-${s.id}-enabled" style="font-weight:600;font-size:14px">Run this step</label><p class="xsmall muted">When off, rows pass through unchanged.</p></div>
        <span class="switch"><input type="checkbox" role="switch" id="f-${p.id}-${s.id}-enabled" data-field="enabled" data-pipeline="${p.id}" data-step="${s.id}" ${vals.enabled ? 'checked' : ''} ${locked ? 'disabled' : ''}><span class="switch__track"></span></span></div>` : '';

    return `<div class="step-detail" data-step-detail="${p.id}/${s.id}">
      <div class="step-detail__head">
        <span class="node__type">${icon(TYPE_ICON[s.type])}</span>
        <div class="step-detail__title">
          ${mode === 'phone' ? '' : `<h2>${esc(s.name)}</h2>`}
          <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">${statusBadge(st)}<span class="xsmall muted">${s.lastRunAt ? 'Last run ' + timeEl(s.lastRunAt) : 'Not run yet'}</span></div>
        </div>
        ${mode === 'desktop' ? `<button type="button" class="icon-btn" data-action="deselect-step" data-pipeline="${p.id}" aria-label="Close step details">${icon('close')}</button>` : ''}
      </div>
      <dl class="stats">
        <div><dt>Rows in</dt><dd>${s.rowsIn == null ? (s.inputs.length ? '—' : 'Source') : fmtInt(s.rowsIn)}</dd></div>
        <div><dt>Rows out</dt><dd>${s.rowsOut == null ? '—' : fmtInt(s.rowsOut)}</dd></div>
        <div><dt>Duration</dt><dd>${fmtDur(s.durationSec)}</dd></div>
        <div><dt>Last run</dt><dd>${s.lastRunAt ? timeEl(s.lastRunAt) : '—'}</dd></div>
      </dl>
      ${inputs.length > 1 ? `<p class="small muted">Inputs: ${inputs.map((i) => `<strong>${esc(i.name)}</strong> (${fmtInt(i.rowsOut)} rows)`).join(' + ')}</p>` : ''}
      ${s.status === 'failed' ? `<div class="step-error" role="alert"><strong style="display:flex;gap:6px;align-items:center">${icon('warning')}Error</strong><span>${esc(s.error)}</span>${s.hint ? `<span class="step-error__hint">${esc(s.hint)}</span>` : ''}</div>` : ''}
      ${s.status === 'skipped' ? `<p class="hint">${icon('info')}<span>Not run: an earlier step failed.</span></p>` : ''}
      <form class="form" data-step-form="${p.id}/${s.id}" novalidate onsubmit="return false">
        <div class="form__title"><h3>Settings</h3><span class="xsmall muted" data-dirty-label>${isDirty(p.id, s.id) ? 'Unsaved changes' : ''}</span></div>
        ${toggle}${fields}
      </form>
      <div class="step-actions" data-step-actions="${p.id}/${s.id}">${stepActionsHTML(p, s)}</div>
      ${mode === 'phone' ? `<p class="hint">${icon('desktop')}<span>Structural edits are available on desktop.</span></p>` : ''}
    </div>`;
  }

  function stepActionsHTML(p, s) {
    const prog = runProgress(p);
    if (prog) {
      return `<button type="button" class="btn btn--primary btn--block" disabled aria-disabled="true">${icon('running', 'spin')}Running · step ${prog.index} of ${prog.total}</button>`;
    }
    const dirty = isDirty(p.id, s.id);
    const invalid = Object.keys(draftErrors(p, s)).length > 0;
    if (dirty) {
      return `<div class="step-actions__row">
          <button type="button" class="btn" data-action="discard-step" data-pipeline="${p.id}" data-step="${s.id}">Discard</button>
          <button type="button" class="btn" data-action="save-step" data-pipeline="${p.id}" data-step="${s.id}" ${invalid ? 'disabled' : ''}>Save changes</button>
        </div>
        <button type="button" class="btn btn--primary btn--block" data-action="rerun-step" data-pipeline="${p.id}" data-step="${s.id}" ${invalid ? 'disabled' : ''}>${icon('play')}Save &amp; re-run from this step</button>
        ${invalid ? '<p class="field__error">' + icon('warning', 'icon--sm') + '<span>Fix the highlighted fields to save.</span></p>' : ''}`;
    }
    return `<button type="button" class="btn btn--primary btn--block" data-action="rerun-step" data-pipeline="${p.id}" data-step="${s.id}">${icon('play')}Re-run from this step</button>`;
  }

  function defaultStep(p) { const f = p.steps.find((s) => s.status === 'failed' || s.status === 'running'); return f ? f.id : p.steps[0].id; }

  function pipelineView(route, mode) {
    const p = getPipeline(route.id);
    const head = pipelineHeaderHTML(p, mode);
    if (mode === 'desktop') {
      const s = route.step ? getStep(p, route.step) : null;
      return `<div class="view">${head}<div class="pl-layout pl-layout--desktop">${canvasHTML(p, s && s.id)}
        <aside class="card inspector" aria-label="Inspector">${s ? stepDetailHTML(p, s, mode) : pipelineSummaryHTML(p)}</aside></div></div>`;
    }
    if (mode === 'tablet') {
      const s = getStep(p, route.step) || getStep(p, defaultStep(p));
      return `<div class="view">${head}<div class="pl-layout pl-layout--split">
        <section class="card" style="padding:8px" aria-label="Steps"><h2 class="small muted" style="padding:8px 8px 4px">${p.steps.length} steps</h2>${timelineHTML(p, s.id)}<div style="padding:12px 8px">${runHistoryHTML(p)}</div></section>
        <section class="card detail-pane" aria-label="Step details">${stepDetailHTML(p, s, mode)}</section></div></div>`;
    }
    return `<div class="view">${head}<section class="card" style="padding:8px" aria-label="Steps">${timelineHTML(p, route.step)}</section>
      <div class="card" style="padding:16px;margin-top:16px">${runHistoryHTML(p)}</div></div>`;
  }

  // On phone, the selected step lives in a bottom sheet driven by the URL (#pipeline/id/step)
  let stepSheet = null;
  function syncStepSheet(route, mode) {
    const want = mode === 'phone' && route.name === 'pipeline' && route.step ? `${route.id}/${route.step}` : null;
    if (!want) { if (stepSheet) { stepSheet.close(true); stepSheet = null; } return; }
    const p = getPipeline(route.id), s = getStep(p, route.step);
    if (!s) return;
    const body = stepDetailHTML(p, s, mode);
    if (stepSheet && stepSheet.key === want) {
      const b = $('.sheet__body', stepSheet.el), top = b.scrollTop;
      const fid = document.activeElement && document.activeElement.id;
      b.innerHTML = body; b.scrollTop = top;
      if (fid && document.getElementById(fid)) document.getElementById(fid).focus({ preventScroll: true });
      return;
    }
    if (stepSheet) stepSheet.close(true);
    stepSheet = openSheet({
      title: `<span style="display:flex;align-items:center;gap:8px">${esc(s.name)}</span>`,
      body,
      onRequestClose: () => closeStepSheet(p.id),
    });
    stepSheet.key = want;
  }
  async function closeStepSheet(pid) {
    const r = parseRoute(location.hash);
    if (!(await canLeave(r, { name: 'pipeline', id: pid, step: null }))) return;
    if (state.pushedStep) { state.pushedStep = false; guardPassed = true; history.back(); }
    else go(`#pipeline/${pid}`, { replace: true });
  }

  /* ======================================================================
     8. Chat view + question matching
     ====================================================================== */
  const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasWord = (q, w) => new RegExp(`\\b${reEsc(w)}\\b`).test(q);
  const findIn = (q, list) => list.find((item) => item.synonyms.some((syn) => hasWord(q, syn)));

  function defaultChart(dim) { return dim === 'month' ? 'line' : dim === 'category' || dim === 'stage' ? 'hbar' : 'bar'; }

  /* Turn a typed question into a chart spec.
     In production an LLM would produce this spec (metric, dimension, chart
     type, filters) from the question and the semantic layer. Here we detect
     words from the vocabulary in data.js; anything we can't map gets an
     honest "I don't have data for that" instead of a made-up chart. */
  function interpret(raw, ctx) {
    const q = ' ' + raw.toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9%\s-]/g, ' ').replace(/\s+/g, ' ') + ' ';
    let metric = findIn(q, D.VOCAB.metrics);
    const dimHit = findIn(q, D.VOCAB.dimensions);
    let dim = dimHit && dimHit.id;
    const rangeHit = findIn(q, D.VOCAB.ranges);
    const metro = D.REGIONS.flatMap((r) => r.metros.map(([n]) => ({ n, r: r.id }))).find((x) => hasWord(q, x.n.toLowerCase()));
    const regionHit = D.REGIONS.find((r) => hasWord(q, r.name.toLowerCase())) || (metro && D.REGIONS.find((r) => r.id === metro.r));
    const chartWord = /\bline\b/.test(q) ? 'line' : /\b(bar|bars|column|columns)\b/.test(q) ? 'bar' : null;
    const ood = D.VOCAB.outOfData.find((o) => o.pattern.test(q));
    const cue = dim || rangeHit || regionHit || chartWord;

    let base = null;
    if (!metric && ctx && cue) { base = ctx; metric = metricDef(ctx.metric); }
    if (!metric) return { type: 'fallback' };

    if (ood) {
      const sc = D.SCRIPTED.find((s) => s.spec.metric === metric.id);
      const spec = sc ? sc.spec : { metric: metric.id, dimension: metric.defaultDimension, chartType: defaultChart(metric.defaultDimension), range: 'q3', region: 'all' };
      return { type: 'partial', text: `I don’t have ${ood.kind === 'time' ? 'data for that time period' : ood.kind === 'product' ? 'that product' : 'data for that location'} yet. ${ood.available}`,
        suggestions: [{ label: `Show ${metric.label.toLowerCase()} for all US regions`, spec }] };
    }
    if (dim === 'metro' && !regionHit && !metric.dimensions.includes('metro')) dim = null;
    if (!dim && metro && metric.dimensions.includes('metro')) dim = 'metro';
    let dimension = dim || (base && base.dimension) || metric.defaultDimension;
    if (!metric.dimensions.includes(dimension)) {
      if (dim) {
        const list = metric.dimensions.map((d) => DIM_LABEL[d]);
        return { type: 'partial', text: `I can show ${metric.label.toLowerCase()} by ${list.slice(0, -1).join(', ')}${list.length > 1 ? ' or ' : ''}${list[list.length - 1]}, but not by ${DIM_LABEL[dim]} yet.`,
          suggestions: metric.dimensions.slice(0, 3).map((d) => ({ label: `${metric.label} by ${DIM_LABEL[d]}`, spec: { metric: metric.id, dimension: d, chartType: defaultChart(d), range: d === 'month' ? 'last6' : 'q3', region: 'all' } })) };
      }
      dimension = metric.defaultDimension;
    }
    const sc = D.SCRIPTED.find((s) => s.spec.metric === metric.id && s.spec.dimension === dimension);
    let chartType = base && base.dimension === dimension ? base.chartType : sc ? sc.spec.chartType : defaultChart(dimension);
    if (chartWord === 'line') chartType = 'line';
    if (chartWord === 'bar') chartType = ['category', 'stage'].includes(dimension) ? 'hbar' : 'bar';
    const spec = {
      metric: metric.id, dimension, chartType,
      range: (rangeHit && rangeHit.id) || (base && base.range) || (sc && sc.spec.range) || (dimension === 'month' ? 'last6' : 'q3'),
      region: (regionHit && regionHit.id) || (base && base.region) || 'all',
    };
    return { type: 'answer', spec: resolveSpec(spec) };
  }

  // Follow-up chips are just edited specs
  function followupsFor(spec) {
    const m = metricDef(spec.metric);
    const out = [];
    if (spec.dimension !== 'region' && m.dimensions.includes('region') && spec.region === 'all') {
      out.push({ label: 'Show by region', spec: { ...spec, dimension: 'region', chartType: spec.chartType === 'line' ? 'bar' : spec.chartType === 'hbar' && spec.dimension !== 'category' ? 'bar' : spec.chartType === 'hbar' ? 'bar' : spec.chartType } });
    }
    if (spec.dimension === 'region' && m.dimensions.includes('metro')) {
      const r = worstRegion(spec.range);
      out.push({ label: `Break down ${regionName(r)} by metro`, spec: { ...spec, dimension: 'metro', region: r } });
    } else if (spec.dimension !== 'month' && m.dimensions.includes('month')) {
      out.push({ label: 'Show by month', spec: { ...spec, dimension: 'month', chartType: 'line' } });
    }
    if (spec.chartType === 'line') out.push({ label: 'Change to bar chart', spec: { ...spec, chartType: ['category', 'stage'].includes(spec.dimension) ? 'hbar' : 'bar' } });
    else out.push({ label: 'Change to line chart', spec: { ...spec, chartType: 'line' } });
    if (spec.metric !== 'pipeline') {
      if (spec.range !== 'last6') out.push({ label: 'Last 6 months', spec: { ...spec, range: 'last6' } });
      else out.push({ label: 'Last quarter only', spec: { ...spec, range: 'q3' } });
    }
    return out.slice(0, 4).map((f) => ({ label: f.label, spec: resolveSpec(f.spec) }));
  }

  function pinnedIn(key) { return state.pins.filter((p) => p.key === key).map((p) => p.dashboardId); }

  function answerHTML(msg, mode) {
    const data = computeSeries(msg.spec);
    const p = getPipeline(D.sourceFor(msg.spec.metric, msg.spec.dimension));
    const st = pipelineStatus(p);
    const where = pinnedIn(pinKey(msg.spec));
    const title = specTitle(data.spec);
    const fu = followupsFor(msg.spec);
    msg.followups = fu;
    const chipBusy = state.chat.busy ? 'disabled' : '';
    return `<article class="card answer" aria-label="Answer: ${esc(title)}">
      <div class="answer__title"><div style="min-width:0"><h3>${esc(title)}</h3><p class="answer__filters">${esc(specFilterLabel(data.spec))}</p></div></div>
      ${data.empty ? `<div class="chart-empty">${icon('filter', 'icon--lg')}<p>${esc(data.emptyReason)}</p></div>` : `${legendHTML(data, msg.spec.chartType)}${chartSlot('msg-' + msg.id, msg.spec)}`}
      <p class="answer__summary">${summarize(data)}</p>
      ${st === 'failed' ? `<div class="stale"><span class="stale__text">${icon('warning')}<span><strong>Heads up:</strong> this answer uses data that is ${timeEl(p.dataUpdatedAt, 'age')} old because ${esc(p.name)} failed.</span></span></div>` : ''}
      <a class="source-chip ${st === 'failed' ? 'source-chip--failed' : ''}" href="#pipeline/${p.id}">${icon(STATUS[st].icon)}<span>Source: ${esc(p.name)} · ${STATUS[st].label.toLowerCase()} · updated ${timeEl(p.dataUpdatedAt)}</span>${icon('chevron-right', 'icon--sm')}</a>
      <div class="answer__actions">
        ${data.empty ? '' : `<button type="button" class="btn ${where.length ? 'btn--pin' : 'btn--primary'}" data-action="pin" data-msg="${msg.id}">${where.length ? `Pinned ✓<span class="sr-only"> to ${esc(where.map(dashboardName).join(', '))}</span>` :`${icon('pin')}Pin to dashboard`}</button>`}
        <div class="followups" role="group" aria-label="Follow-up questions">${fu.map((f, i) => `<button type="button" class="chip" data-action="followup" data-msg="${msg.id}" data-idx="${i}" ${chipBusy}>${esc(f.label)}</button>`).join('')}</div>
      </div>
    </article>`;
  }

  function suggestionsHTML(list, msgId) {
    return `<div class="followups">${list.map((s, i) => `<button type="button" class="chip chip--brand" data-action="${s.spec ? 'followup' : 'suggestion'}" data-msg="${msgId || ''}" data-idx="${i}" data-q="${esc(s.question || '')}" ${state.chat.busy ? 'disabled' : ''}>${esc(s.label || s.question)}</button>`).join('')}</div>`;
  }

  function messageHTML(msg, mode) {
    if (msg.role === 'user') return `<div class="msg msg--user"><div class="bubble">${esc(msg.text)}</div></div>`;
    let inner = '';
    switch (msg.kind) {
      case 'thinking':
        inner = `<div class="card thinking" role="status"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><span>${esc(msg.label)}</span></div>`; break;
      case 'answer': inner = answerHTML(msg, mode); break;
      case 'fallback':
        inner = `<div class="card fallback"><p class="fallback__head">${icon('info')}I don’t have data for that yet.</p>
          <p class="small">I can only answer from Brightline’s connected pipelines: revenue, targets, orders, margin, returns and open pipeline for 5 US regions, April–October 2026. I won’t guess a chart I can’t back with data. These ones work:</p>
          ${suggestionsHTML(msg.suggestions, msg.id)}</div>`; break;
      case 'partial':
        inner = `<div class="card fallback"><p class="fallback__head">${icon('info')}Partly answerable</p><p class="small">${esc(msg.text)}</p>${suggestionsHTML(msg.suggestions, msg.id)}</div>`; break;
      case 'context': {
        inner = `<div class="card context-card"><p class="xsmall muted" style="display:flex;align-items:center;gap:6px">${icon('dashboard', 'icon--sm')}From your dashboard</p><h3>${esc(msg.title)}</h3><p class="answer__filters">${esc(specFilterLabel(msg.spec))}</p>
          ${(() => { const d = computeSeries(msg.spec); return d.empty ? '' : legendHTML(d, msg.spec.chartType) + chartSlot('ctx-' + msg.id, msg.spec, { height: 170 }); })()}
          <p class="small">What would you like to know about this chart? Here are a few ideas:</p>${suggestionsHTML(msg.suggestions, msg.id)}</div>`; break;
      }
      case 'error':
        inner = `<div class="card fallback"><p class="fallback__head" style="color:var(--fail)">${icon('warning')}I couldn’t build that answer.</p><p class="small">Something went wrong while reading the data. Nothing was pinned or changed.</p>
          <div><button type="button" class="btn btn--sm" data-action="retry" data-msg="${msg.id}">${icon('reset')}Try again</button></div></div>`; break;
      default: inner = '';
    }
    return `<div class="msg msg--vega"><span class="avatar" aria-hidden="true">${icon('vega')}</span><div class="msg__body"><span class="msg__name">Vega</span>${inner}</div></div>`;
  }

  function chatView(mode) {
    chartRegistry.clear();
    const c = state.chat;
    if (c.pendingContext) {
      const { spec, title } = c.pendingContext;
      c.pendingContext = null;
      c.context = spec;
      const sugg = followupsFor(spec);
      if (spec.metric === 'attainment' && spec.dimension === 'region') sugg.unshift({ label: `Why did ${regionName(worstRegion(spec.range))} miss target?`, spec: resolveSpec({ ...spec, dimension: 'metro', region: worstRegion(spec.range) }) });
      const seen = new Set();
      const unique = sugg.filter((s) => { const k = pinKey(s.spec); if (seen.has(k)) return false; seen.add(k); return true; });
      c.messages.push({ id: uid(), role: 'vega', kind: 'context', spec, title, suggestions: unique.slice(0, 3) });
    }
    const empty = !c.messages.length;
    const sources = state.pipelines.map((p) => `<li><a href="#pipeline/${p.id}"><span class="small" style="font-weight:600">${esc(p.name)}</span><span style="display:flex;gap:8px;align-items:center">${statusBadge(pipelineStatus(p))}<span class="xsmall muted">${timeEl(p.dataUpdatedAt)}</span></span></a></li>`).join('');
    const ctxSpec = c.context;
    return `<div class="view view--chat"><div class="chat-layout">
      <div class="chat-main">
        <div class="messages" id="messages" aria-live="polite">
          ${empty ? `<div class="chat-empty">
            <div class="chat-empty__hello"><span class="avatar">${icon('vega')}</span><h1>Hi, I’m Vega.</h1>
              <p class="muted">Ask about ${esc(D.company)}’s sales in plain language. I’ll answer with a chart, a short summary and the pipeline the numbers came from.</p></div>
            <div class="suggestions">${D.SCRIPTED.map((s) => `<button type="button" class="suggestion" data-action="suggestion" data-q="${esc(s.question)}">${icon('vega')}<span>${esc(s.question)}</span></button>`).join('')}</div>
            <p class="capabilities">I know about revenue, targets, orders, margin, returns and open pipeline across 5 US regions (West, Southwest, Midwest, Southeast, Northeast), April–October 2026.</p>
          </div>` : c.messages.map((m) => messageHTML(m, mode)).join('')}
        </div>
        <form class="composer" data-action="send-form" onsubmit="return false">
          ${ctxSpec ? `<div class="composer__context"><span class="chip chip--brand" style="min-height:36px">${icon('dashboard', 'icon--sm')}About: ${esc(specTitle(ctxSpec))}</span><button type="button" class="icon-btn" data-action="clear-context" aria-label="Clear chart context">${icon('close')}</button></div>` : ''}
          <div class="composer__box">
            <label class="sr-only" for="composer-input">Ask Vega a question</label>
            <textarea id="composer-input" rows="1" placeholder="${mode === 'phone' ? 'Ask Vega a question…' : 'Ask about revenue, targets, returns…'}" ${c.busy ? 'disabled' : ''}>${esc(c.draft || '')}</textarea>
            <button type="button" class="btn btn--primary" data-action="send" aria-label="Send question" ${c.busy || !(c.draft || '').trim() ? 'disabled' : ''}>${icon('send')}</button>
          </div>
        </form>
      </div>
      <aside class="chat-side" aria-label="Data Vega can use">
        <div class="card"><h2 class="small">Data Vega can use</h2><ul class="source-list">${sources}</ul>
          <p class="xsmall muted">Every answer links to its source pipeline. If a pipeline failed, the answer tells you how old the data is.</p></div>
      </aside>
    </div></div>`;
  }

  function scrollChatToEnd(smooth) {
    requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth && !reducedMotion() ? 'smooth' : 'auto' }));
  }

  function lastAnswerSpec() {
    for (let i = state.chat.messages.length - 1; i >= 0; i--) { const m = state.chat.messages[i]; if (m.kind === 'answer') return m.spec; }
    return null;
  }

  // Ask a question (typed, suggestion, or follow-up with a ready spec)
  function ask(text, presetSpec) {
    const c = state.chat;
    if (c.busy || !text.trim()) return;
    c.busy = true;
    c.draft = '';
    c.messages.push({ id: uid(), role: 'user', text: text.trim() });
    let result;
    try {
      result = presetSpec ? { type: 'answer', spec: presetSpec } : interpret(text, c.context || lastAnswerSpec());
    } catch (e) { result = { type: 'error' }; }
    const src = result.type === 'answer' ? getPipeline(D.sourceFor(result.spec.metric, result.spec.dimension)) : null;
    const thinking = { id: uid(), role: 'vega', kind: 'thinking', label: src ? `Reading ${src.name}…` : 'Looking through the data…' };
    c.messages.push(thinking);
    render(); scrollChatToEnd(true);
    setTimeout(() => {
      const i = c.messages.indexOf(thinking);
      let msg;
      try {
        if (result.type === 'answer') { computeSeries(result.spec); msg = { id: thinking.id, role: 'vega', kind: 'answer', spec: result.spec, question: text.trim() }; }
        else if (result.type === 'partial') msg = { id: thinking.id, role: 'vega', kind: 'partial', text: result.text, suggestions: result.suggestions };
        else if (result.type === 'error') msg = { id: thinking.id, role: 'vega', kind: 'error', retry: text };
        else msg = { id: thinking.id, role: 'vega', kind: 'fallback', suggestions: [D.SCRIPTED[0], D.SCRIPTED[1], D.SCRIPTED[3]].map((s) => ({ question: s.question })) };
      } catch (e) { msg = { id: thinking.id, role: 'vega', kind: 'error', retry: text }; }
      c.messages[i] = msg;
      c.busy = false;
      if (parseRoute(location.hash).name === 'chat') { render(); scrollChatToEnd(true); const inp = $('#composer-input'); if (inp && layout() !== 'phone') inp.focus({ preventScroll: true }); }
    }, presetSpec ? 650 : 1000);
  }

  /* ======================================================================
     9. Sheets (bottom sheet on phone, dialog on larger screens), toasts, menus
     ====================================================================== */
  const sheetStack = [];
  function openSheet({ title, body, foot, wide, onRequestClose, flush }) {
    const root = $('#sheet-root');
    const opener = document.activeElement;
    const wrap = document.createElement('div');
    const titleId = 'sheet-title-' + uid();
    wrap.className = 'sheet-backdrop';
    wrap.innerHTML = `<div class="sheet ${wide ? 'sheet--wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="sheet__handle" aria-hidden="true"></div>
      <div class="sheet__head"><h2 class="sheet__title" id="${titleId}">${title}</h2><button type="button" class="icon-btn" data-sheet-close aria-label="Close">${icon('close')}</button></div>
      <div class="sheet__body ${flush ? 'sheet__body--flush' : ''}">${body}</div>${foot ? `<div class="sheet__foot">${foot}</div>` : ''}</div>`;
    root.appendChild(wrap);
    document.body.style.overflow = 'hidden';
    const api = {
      el: wrap,
      requestClose() { if (onRequestClose) onRequestClose(); else api.close(); },
      close(silent) {
        const i = sheetStack.indexOf(api);
        if (i >= 0) sheetStack.splice(i, 1);
        wrap.remove();
        if (!sheetStack.length) document.body.style.overflow = '';
        if (!silent && opener && document.contains(opener)) opener.focus({ preventScroll: true });
      },
    };
    wrap.addEventListener('click', (e) => {
      if (e.target === wrap || e.target.closest('[data-sheet-close]')) api.requestClose();
    });
    sheetStack.push(api);
    // Focus the dialog itself so screen readers announce it, without a stray focus ring on a field
    const dlg = $('.sheet', wrap);
    dlg.tabIndex = -1;
    requestAnimationFrame(() => dlg.focus({ preventScroll: true }));
    mountViewCharts(wrap);
    return api;
  }

  function confirmDialog({ title, message, confirmLabel, cancelLabel, danger }) {
    return new Promise((resolve) => {
      let done = false;
      const finish = (v) => { if (done) return; done = true; sh.close(); resolve(v); };
      const sh = openSheet({
        title: esc(title), body: `<p>${esc(message)}</p>`,
        foot: `<button type="button" class="btn" data-confirm="no">${esc(cancelLabel)}</button><button type="button" class="btn ${danger ? 'btn--danger' : 'btn--primary'}" data-confirm="yes">${esc(confirmLabel)}</button>`,
        onRequestClose: () => finish(false),
      });
      sh.el.addEventListener('click', (e) => { const b = e.target.closest('[data-confirm]'); if (b) finish(b.dataset.confirm === 'yes'); });
    });
  }

  let toastTimer = null;
  function toast(text, opts) {
    const o = opts || {};
    const root = $('#toast-root');
    clearTimeout(toastTimer);
    const actions = (o.actions || []).map((a, i) => a.href ? `<a href="${a.href}" data-toast-i="${i}">${esc(a.label)}</a>` : `<button type="button" data-toast-i="${i}">${esc(a.label)}</button>`).join('');
    root.innerHTML = `<div class="toast toast--${o.kind || 'ok'}"><span class="toast__text">${icon(o.kind === 'fail' ? 'warning' : o.kind === 'info' ? 'info' : 'check')}<span>${text}</span></span>${actions}
      <button type="button" class="icon-btn" data-toast-close aria-label="Dismiss">${icon('close')}</button></div>`;
    root.onclick = (e) => {
      const a = e.target.closest('[data-toast-i]');
      if (a) { const act = o.actions[+a.dataset.toastI]; if (act.fn) act.fn(); root.innerHTML = ''; }
      if (e.target.closest('[data-toast-close]')) root.innerHTML = '';
    };
    toastTimer = setTimeout(() => { root.innerHTML = ''; }, o.duration || 6000);
  }

  // ---- Pin flow (with duplicate detection) ----
  function openPinSheet(msg) {
    const spec = msg.spec, key = pinKey(spec), title = specTitle(spec);
    const already = pinnedIn(key);
    let chosen = D.DASHBOARDS.find((d) => !already.includes(d.id)) || D.DASHBOARDS[0];
    const body = () => {
      const dup = already.includes(chosen.id);
      return `<p class="small muted" style="margin-bottom:12px">${esc(title)} · ${esc(specFilterLabel(spec))}</p>
        <div class="choice-list" role="radiogroup" aria-label="Choose a dashboard">
        ${D.DASHBOARDS.map((d) => `<button type="button" class="choice" role="radio" aria-checked="${d.id === chosen.id}" data-dash="${d.id}">
          <span class="choice__radio"></span><span class="choice__text"><strong>${esc(d.name)}</strong><span class="choice__sub">${already.includes(d.id) ? '✓ Already pinned here' : `${state.pins.filter((p) => p.dashboardId === d.id).length + (d.core ? 4 : 0)} charts`}</span></span></button>`).join('')}
        </div>
        ${dup ? `<p class="notice" role="status">${icon('info')}<span>Already pinned to <strong>${esc(chosen.name)}</strong>. <a href="#dashboard/${chosen.id}" data-view-pin="${chosen.id}">View it</a>. Pinning again would create a duplicate, so it’s turned off.</span></p>` : ''}`;
    };
    const foot = () => `<button type="button" class="btn" data-sheet-close>Cancel</button><button type="button" class="btn btn--primary" data-do-pin ${already.includes(chosen.id) ? 'disabled' : ''}>${icon('pin')}Pin chart</button>`;
    const sh = openSheet({ title: 'Pin to dashboard', body: body(), foot: foot() });
    const refresh = () => { $('.sheet__body', sh.el).innerHTML = body(); $('.sheet__foot', sh.el).innerHTML = foot(); $(`[data-dash="${chosen.id}"]`, sh.el).focus(); };
    sh.el.addEventListener('click', (e) => {
      const c = e.target.closest('[data-dash]');
      if (c) { chosen = D.DASHBOARDS.find((d) => d.id === c.dataset.dash); refresh(); return; }
      const v = e.target.closest('[data-view-pin]');
      if (v) { const pin = state.pins.find((p) => p.key === key && p.dashboardId === v.dataset.viewPin); state.scrollToPin = pin && pin.id; sh.close(true); return; }
      if (e.target.closest('[data-do-pin]')) {
        if (pinnedIn(key).includes(chosen.id)) return; // double-tap guard
        const pin = { id: uid(), dashboardId: chosen.id, key, spec, title, question: msg.question || title, pinnedAt: Date.now() };
        state.pins.push(pin); savePins(); sh.close(); render();
        toast(`Pinned to <strong>${esc(chosen.name)}</strong>`, { actions: [
          { label: 'Undo', fn: () => { state.pins = state.pins.filter((p) => p.id !== pin.id); savePins(); render(); toast('Pin removed', { kind: 'info' }); } },
          { label: 'View', href: `#dashboard/${chosen.id}`, fn: () => { state.scrollToPin = pin.id; } },
        ] });
      }
    });
  }

  function removePin(id) {
    const pin = state.pins.find((p) => p.id === id);
    if (!pin) return;
    const idx = state.pins.indexOf(pin);
    state.pins.splice(idx, 1); savePins(); render();
    toast(`Removed “${esc(pin.title)}”`, { kind: 'info', actions: [{ label: 'Undo', fn: () => { state.pins.splice(idx, 0, pin); savePins(); render(); } }] });
  }

  // ---- Phone filter sheet ----
  function openFilterSheet() {
    const draft = Object.assign({}, state.filters);
    const body = () => `
      <div class="field-group"><span class="field-group__label" id="fs-range">Date range</span><div class="chip-set" role="group" aria-labelledby="fs-range">
        ${Object.values(D.RANGES).map((r) => `<button type="button" class="chip" data-f-range="${r.id}" aria-pressed="${draft.range === r.id}">${esc(r.label)}</button>`).join('')}</div></div>
      <div class="field-group"><span class="field-group__label" id="fs-region">Region</span><div class="chip-set" role="group" aria-labelledby="fs-region">
        ${['all', ...D.REGIONS.map((r) => r.id)].map((id) => `<button type="button" class="chip" data-f-region="${id}" aria-pressed="${draft.region === id}">${esc(regionName(id))}</button>`).join('')}</div></div>
      <p class="small muted">The open pipeline chart is a live CRM snapshot, so only the region filter applies to it.</p>`;
    const sh = openSheet({ title: 'Filters', body: body(), foot: `<button type="button" class="btn" data-f-reset>Reset</button><button type="button" class="btn btn--primary" data-f-apply>Show results</button>` });
    sh.el.addEventListener('click', (e) => {
      const r = e.target.closest('[data-f-range]'), g = e.target.closest('[data-f-region]');
      if (r) draft.range = r.dataset.fRange;
      if (g) draft.region = g.dataset.fRegion;
      if (r || g) { const b = $('.sheet__body', sh.el), t = b.scrollTop; b.innerHTML = body(); b.scrollTop = t; (r ? $(`[data-f-range="${draft.range}"]`, sh.el) : $(`[data-f-region="${draft.region}"]`, sh.el)).focus(); }
      if (e.target.closest('[data-f-reset]')) { draft.range = 'q3'; draft.region = 'all'; $('.sheet__body', sh.el).innerHTML = body(); }
      if (e.target.closest('[data-f-apply]')) { state.filters = draft; sh.close(); render(); }
    });
  }

  // ---- Dashboard switcher sheet (iPad title / iPhone chip) ----
  function openDashboardSheet(currentId) {
    const rows = D.DASHBOARDS.map((d) => {
      const pins = state.pins.filter((p) => p.dashboardId === d.id).length;
      const count = d.core ? `4 charts${pins ? ` + ${pins} pinned` : ''}` : `${pins} pinned chart${pins === 1 ? '' : 's'}`;
      return `<a class="choice" href="#dashboard/${d.id}" role="radio" aria-checked="${d.id === currentId}" data-sheet-close style="text-decoration:none;color:inherit">
        <span class="choice__radio"></span><span class="choice__text"><strong>${esc(d.name)}</strong><span class="choice__sub">${esc(d.description)} · ${count}</span></span></a>`;
    }).join('');
    openSheet({ title: 'Switch dashboard', body: `<div class="choice-list" role="radiogroup" aria-label="Dashboards">${rows}</div>` });
  }

  // ---- Data health sheet (phone "Details") ----
  function openHealthSheet() {
    const rows = state.pipelines.map((p) => {
      const st = pipelineStatus(p), prog = runProgress(p);
      return `<a class="choice" href="#pipeline/${p.id}" style="text-decoration:none;color:inherit" data-sheet-close>
        <span class="choice__text"><strong class="truncate">${esc(p.name)}</strong><span class="choice__sub">${prog ? `Step ${prog.index} of ${prog.total}` : st === 'failed' ? `Failed · data ${timeEl(p.dataUpdatedAt, 'age')} old` : st === 'scheduled' ? `Next run ${esc(p.nextRunLabel)} · updated ${timeEl(p.dataUpdatedAt)}` : `Updated ${timeEl(p.dataUpdatedAt)}`}</span></span>
        ${statusBadge(st)}${icon('chevron-right')}</a>`;
    }).join('');
    openSheet({ title: 'Data health', body: `<div class="choice-list">${rows}</div>` });
  }

  // ---- Drill-down: region → metros ----
  function openDrill(region, range) {
    const spec = { metric: 'attainment', dimension: 'metro', chartType: 'hbar', range, region };
    const data = computeSeries(spec);
    const p = getPipeline('sales-daily');
    const rows = data.labels.map((l, i) => {
      const a = data.series[0].values[i], t = data.series[1].values[i];
      return `<tr><td>${esc(l)}</td><td>${fmtValue(a, 'currency')}</td><td>${fmtValue(t, 'currency')}</td><td><strong>${Math.round((a / t) * 100)}%</strong></td></tr>`;
    }).join('');
    const sh = openSheet({
      title: `${esc(regionName(region))} by metro`, wide: true,
      body: `<p class="small muted" style="margin-bottom:8px">Revenue vs target · ${esc(D.RANGES[range].short)}</p>
        ${freshnessHTML(p)}<div style="height:12px"></div>${staleHTML(p)}
        <div style="height:8px"></div>${legendHTML(data, 'bar')}${chartSlot('drill', spec)}
        <table class="breakdown-table"><thead><tr><th>Metro</th><th>Revenue</th><th>Target</th><th>Attainment</th></tr></thead><tbody>${rows}</tbody></table>`,
      foot: `<button type="button" class="btn" data-sheet-close>Close</button><button type="button" class="btn btn--vega" data-ask-drill>${icon('vega')}Ask Vega about ${esc(regionName(region))}</button>`,
    });
    if (chartRO) $$('.chart', sh.el).forEach((el) => chartRO.observe(el));
    sh.el.addEventListener('click', (e) => {
      if (e.target.closest('[data-ask-drill]')) { sh.close(true); askAbout(spec, `${regionName(region)}: revenue vs target by metro`); }
    });
  }

  function askAbout(spec, title) {
    state.chat.pendingContext = { spec, title };
    go('#chat');
  }

  /* ======================================================================
     10. Pipeline run simulation + event wiring
     ====================================================================== */
  // The failed join only succeeds once its timeout or credentials are fixed
  function joinWillSucceed(p, s) {
    if (p.id !== 'sales-daily') return true;
    return Number(s.config.timeoutSec) >= 60 || s.config.credentials === 'vault://crm-readonly-pool';
  }
  const SIM_SECONDS = { excel: 4.1, filter: 1.0, database: 2.4, join: 7.6, transform: 1.5, output: 0.5 };

  function startRun(pid, fromStepId) {
    const p = getPipeline(pid);
    if (state.runs[pid] || p.status === 'running') return; // re-run is disabled while running (no double runs)
    const order = p.steps.map((s) => s.id);
    const from = fromStepId ? order.indexOf(fromStepId) : 0;
    const steps = order.slice(from);
    steps.forEach((id) => { const s = getStep(p, id); s.status = 'queued'; s.rowsOut = null; s.error = null; s.durationSec = null; });
    state.runs[pid] = { steps, i: 0, startedAt: Date.now() };
    delete state.justRan[pid];
    const first = getStep(p, steps[0]);
    toast(fromStepId ? `Re-running ${esc(p.name)} from <strong>${esc(first.name)}</strong>` : `Re-running <strong>${esc(p.name)}</strong>`, { kind: 'info', duration: 2500 });
    runStep(p);
  }

  function runStep(p) {
    const run = state.runs[p.id];
    const s = getStep(p, run.steps[run.i]);
    s.status = 'running';
    s.lastRunAt = Date.now();
    // rows in = rows out of the upstream (non-database) input
    const up = s.inputs.map((id) => getStep(p, id)).find((x) => x.type !== 'database') || null;
    s.rowsIn = up ? up.rowsOut : null;
    render();
    const willFail = s.type === 'join' && !joinWillSucceed(p, s);
    const wall = willFail ? 2600 : s.type === 'join' ? 2000 : 1300;
    setTimeout(() => {
      if (willFail) {
        s.status = 'failed'; s.rowsOut = 0; s.durationSec = Number(s.config.timeoutSec);
        s.error = `Connection timed out after ${s.config.timeoutSec}s while reading crm.customers from prod-crm-replica.`;
        run.steps.slice(run.i + 1).forEach((id) => { getStep(p, id).status = 'skipped'; });
        p.status = 'failed'; p.lastRunAt = Date.now();
        state.history[p.id].unshift({ at: Date.now(), status: 'failed', note: 'Join with database timed out' });
        delete state.runs[p.id];
        render();
        toast(`Run failed at step ${run.i + 1} of ${run.steps.length}: ${esc(s.name)} timed out again.`, { kind: 'fail', duration: 8000,
          actions: [{ label: 'Open step', fn: () => go(`#pipeline/${p.id}/${s.id}`, { replace: layout() !== 'phone' }) }] });
        return;
      }
      if (!s.enabled) { s.status = 'disabled'; s.rowsOut = s.rowsIn; s.durationSec = 0; }
      else {
        s.status = 'succeeded';
        s.durationSec = SIM_SECONDS[s.type];
        if (s.type === 'excel') s.rowsOut = Math.round((s.rowsOut || 48212) + 120 + Math.random() * 300);
        else if (s.type === 'database') s.rowsOut = s.rowsOut || 9384;
        else if (s.type === 'filter') s.rowsOut = Math.round(s.rowsIn * 0.869);
        else if (s.type === 'transform' && p.id !== 'sales-daily') s.rowsOut = s.rowsOut || 35;
        else s.rowsOut = s.rowsIn;
        if (s.type === 'excel') s.rowsOut = s.rowsOut || 1000;
      }
      if (s.type === 'database') s.rowsOut = s.rowsOut || 1000;
      run.i += 1;
      if (run.i < run.steps.length) { runStep(p); return; }
      // Finished
      p.status = 'succeeded';
      p.lastRunAt = Date.now();
      p.dataUpdatedAt = Date.now();
      state.history[p.id].unshift({ at: Date.now(), status: 'succeeded', note: 'Manual re-run' });
      state.justRan[p.id] = Date.now();
      delete state.runs[p.id];
      render();
      toast(`<strong>${esc(p.name)}</strong> succeeded. Dashboard data updated just now.`, { kind: 'ok', duration: 8000, actions: [{ label: 'View dashboard', href: '#dashboard' }] });
    }, reducedMotion() ? Math.min(wall, 700) : wall);
  }

  // Keep relative times and run timers live
  function tick() {
    $$('time[data-ts]').forEach((t) => { const ts = +t.dataset.ts; t.textContent = t.dataset.kind === 'age' ? ageText(ts) : relTime(ts); });
    $$('[data-elapsed]').forEach((t) => { t.textContent = elapsed(+t.dataset.elapsed); });
  }
  setInterval(tick, 1000);

  // ---- Step form editing (drafts, inline validation) ----
  function onFieldInput(el) {
    const p = getPipeline(el.dataset.pipeline), s = getStep(p, el.dataset.step), key = el.dataset.field;
    const k = `${p.id}/${s.id}`;
    if (!state.drafts[k]) state.drafts[k] = { values: Object.assign({}, s.config, { enabled: s.enabled }) };
    state.drafts[k].values[key] = el.type === 'checkbox' ? el.checked : el.value;
    if (!isDirty(p.id, s.id)) delete state.drafts[k];
    // Targeted updates (no full re-render while typing)
    const errs = draftErrors(p, s);
    $$(`[data-step-form="${k}"] [data-field]`).forEach((inp) => {
      const f = inp.dataset.field, msg = errs[f];
      const errEl = document.getElementById(inp.id + '-err');
      if (msg) inp.setAttribute('aria-invalid', 'true'); else inp.removeAttribute('aria-invalid');
      if (errEl) { errEl.hidden = !msg; const sp = errEl.querySelector('span'); if (sp) sp.textContent = msg || ''; }
    });
    $$(`[data-step-actions="${k}"]`).forEach((box) => { box.innerHTML = stepActionsHTML(p, s); });
    $$(`[data-step-form="${k}"] [data-dirty-label]`).forEach((l) => { l.textContent = isDirty(p.id, s.id) ? 'Unsaved changes' : ''; });
  }
  function saveDraft(p, s) {
    const k = `${p.id}/${s.id}`, d = state.drafts[k];
    if (!d) return true;
    if (Object.keys(draftErrors(p, s)).length) return false;
    Object.keys(d.values).forEach((key) => {
      if (key === 'enabled') s.enabled = !!d.values.enabled;
      else s.config[key] = typeof s.config[key] === 'number' ? Number(d.values[key]) : d.values[key];
    });
    delete state.drafts[k];
    return true;
  }

  document.addEventListener('input', (e) => {
    const f = e.target.closest('[data-field]');
    if (f) { onFieldInput(f); return; }
    if (e.target.id === 'composer-input') {
      state.chat.draft = e.target.value;
      e.target.style.height = 'auto';
      e.target.style.height = Math.min(e.target.scrollHeight, 140) + 'px';
      const btn = $('[data-action="send"]');
      if (btn) btn.disabled = state.chat.busy || !e.target.value.trim();
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.matches('[data-field]') && (el.type === 'checkbox' || el.tagName === 'SELECT')) { onFieldInput(el); return; }
    if (el.dataset.action === 'set-region') { state.filters.region = el.value; render(); }
    if (el.dataset.action === 'switch-dashboard') go(`#dashboard/${el.value}`);
  });
  document.addEventListener('keydown', (e) => {
    if (e.target.id === 'composer-input' && e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(e.target.value); return; }
    if (e.key === 'Escape') {
      const openMenu = $('.menu:not([hidden])');
      if (openMenu) { closeMenus(); return; }
      if (sheetStack.length) sheetStack[sheetStack.length - 1].requestClose();
    }
    // Simple focus trap inside the top sheet
    if (e.key === 'Tab' && sheetStack.length) {
      const sheet = $('.sheet', sheetStack[sheetStack.length - 1].el);
      const f = $$('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]', sheet);
      if (!f.length) return;
      if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
      else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
    }
  });

  function closeMenus() {
    $$('.menu:not([hidden])').forEach((m) => { m.hidden = true; const b = $(`[data-menu="${m.id}"]`); if (b) b.setAttribute('aria-expanded', 'false'); });
  }

  // ---- All click actions (event delegation) ----
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-action]');
    if (!e.target.closest('.menu-wrap')) closeMenus();
    if (!el) return;
    const a = el.dataset.action;
    const pid = el.dataset.pipeline, sid = el.dataset.step;
    switch (a) {
      case 'toggle-sidebar': {
        const cur = $('#app').dataset.sidebar;
        state.sidebarPref = cur === 'expanded' ? 'rail' : 'expanded';
        render(); break;
      }
      case 'reset-demo': {
        const ok = await confirmDialog({ title: 'Reset the demo?', message: 'This clears pinned charts and restores the failed pipeline so you can run the story again.', confirmLabel: 'Reset demo', cancelLabel: 'Cancel' });
        if (ok) { store.remove('studio.pins'); location.hash = '#dashboard'; location.reload(); }
        break;
      }
      case 'set-range': state.filters.range = el.dataset.range; render(); break;
      case 'reset-filters': state.filters = { range: 'q3', region: 'all' }; render(); break;
      case 'open-filters': openFilterSheet(); break;
      case 'open-health': openHealthSheet(); break;
      case 'open-dashboards': openDashboardSheet(parseRoute(location.hash).id); break;
      case 'open-drill': openDrill(el.dataset.region, el.dataset.range); break;
      case 'ask-about': closeMenus(); askAbout(JSON.parse(el.dataset.spec), el.dataset.title); break;
      case 'toggle-menu': {
        const m = document.getElementById(el.dataset.menu);
        const open = m.hidden;
        closeMenus();
        m.hidden = !open; el.setAttribute('aria-expanded', String(open));
        if (open) { const first = $('button, a', m); if (first) first.focus(); }
        break;
      }
      case 'remove-pin': closeMenus(); removePin(el.dataset.pin); break;
      case 'expand': el.setAttribute('aria-expanded', String(el.getAttribute('aria-expanded') !== 'true')); break;
      case 'structural': toast('Adding and rewiring steps is a desktop-only action. It isn’t wired up in this mockup.', { kind: 'info' }); break;
      case 'select-step': {
        const mode = layout();
        if (mode === 'phone') { state.pushedStep = true; go(`#pipeline/${pid}/${sid}`); }
        else go(`#pipeline/${pid}/${sid}`, { replace: true });
        break;
      }
      case 'deselect-step': go(`#pipeline/${pid}`, { replace: true }); break;
      case 'save-step': {
        const p = getPipeline(pid), s = getStep(p, sid);
        if (saveDraft(p, s)) { render(); toast(`Saved changes to <strong>${esc(s.name)}</strong>`, { actions: [{ label: 'Re-run from here', fn: () => startRun(pid, sid) }] }); }
        break;
      }
      case 'discard-step': delete state.drafts[`${pid}/${sid}`]; render(); break;
      case 'rerun-step': {
        const p = getPipeline(pid), s = getStep(p, sid);
        if (el.disabled || runProgress(p)) return;
        if (!saveDraft(p, s)) return;
        el.disabled = true;
        startRun(pid, sid); break;
      }
      case 'rerun-pipeline': {
        const p = getPipeline(pid);
        if (el.disabled || runProgress(p)) return;
        el.disabled = true;
        startRun(pid, null); break;
      }
      case 'suggestion': if (el.dataset.q) ask(el.dataset.q); break;
      case 'followup': {
        const msg = state.chat.messages.find((m) => m.id === el.dataset.msg);
        const list = msg.kind === 'answer' ? msg.followups : msg.suggestions;
        const f = list[+el.dataset.idx];
        if (f.spec) ask(f.label, f.spec); else ask(f.question);
        break;
      }
      case 'send': { const inp = $('#composer-input'); if (inp) ask(inp.value); break; }
      case 'clear-context': state.chat.context = null; render(); break;
      case 'pin': { const msg = state.chat.messages.find((m) => m.id === el.dataset.msg); if (msg) openPinSheet(msg); break; }
      case 'retry': {
        const i = state.chat.messages.findIndex((m) => m.id === el.dataset.msg);
        const msg = state.chat.messages[i];
        state.chat.messages.splice(i - 1, 2);
        ask(msg.retry); break;
      }
      default: break;
    }
  });

  // Re-render when crossing a breakpoint; otherwise just refit the canvas
  let lastMode = layout();
  let lastWide = window.innerWidth >= 1024; // iPad portrait (rail) vs landscape (expanded sidebar)
  let rz = null;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      const m = layout(), wide = window.innerWidth >= 1024;
      if (m !== lastMode || (wide !== lastWide && !state.sidebarPref)) { lastMode = m; lastWide = wide; render(); }
      else fitCanvas();
    });
  });

  // Boot
  if (!location.hash) history.replaceState(null, '', '#dashboard');
  currentHash = location.hash;
  render();
})();
