/* ============================================================
   PerfMon Rendering Engine
   pforce-pattern: metadata-driven widget registry + generic renderers
   Full visualization toolkit: bar, gauge, meter, needle, numeric, sparkline
   ============================================================ */

'use strict';

// --- Deterministic SVG ID counter (no Math.random per render) ---
let _svgIdSeq = 0;
function _sid(prefix) { return prefix + (++_svgIdSeq); }

// --- Widget Registry (pforce pattern) ---
const WidgetRegistry = {};
function registerWidget(type, renderer) { WidgetRegistry[type] = renderer; }
function renderWidget(widget, metrics, sparklines) {
  const fn = WidgetRegistry[widget.type];
  if (!fn) return `<div class="empty-state">Unknown widget: ${widget.type}</div>`;
  try { return fn(widget, metrics, sparklines); }
  catch (e) { return `<div class="empty-state">${e.message}</div>`; }
}

// --- Autoscale: "nice" scale calculation ---
// Uses sub-octave steps (1x, 1.25x, 1.5x, 1.75x, 2x within each power-of-2)
// for gauge utilization of ~70-85% at peak, instead of ~50% with raw power-of-2.
function niceScale(peak, fallback) {
  if (peak <= 1024) return fallback || 1048576;
  const target = peak * 1.1;
  const log = Math.log2(target);
  const base = Math.pow(2, Math.floor(log));
  const steps = [1, 1.25, 1.5, 1.75, 2];
  for (const s of steps) {
    if (target <= base * s) return Math.round(base * s);
  }
  return Math.round(base * 2);
}

// --- Utility Functions (from pforce fmt pattern) ---
function fmtBytes(b) {
  if (b == null) return '-';
  if (b < 1024) return b + ' B';
  if (b < 1048576) return (b / 1024).toFixed(1) + ' KB';
  if (b < 1073741824) return (b / 1048576).toFixed(1) + ' MB';
  return (b / 1073741824).toFixed(2) + ' GB';
}

function fmtBps(bps) {
  if (bps == null || bps <= 0) return '0 B/s';
  if (bps < 1024) return bps.toFixed(0) + ' B/s';
  if (bps < 1048576) return (bps / 1024).toFixed(1) + ' KB/s';
  if (bps < 1073741824) return (bps / 1048576).toFixed(1) + ' MB/s';
  return (bps / 1073741824).toFixed(2) + ' GB/s';
}

function fmtKB(kb) {
  if (kb < 1024) return kb + ' KB';
  if (kb < 1048576) return (kb / 1024).toFixed(1) + ' MB';
  return (kb / 1048576).toFixed(1) + ' GB';
}

function fmtPct(v) { return v != null ? v.toFixed(1) + '%' : '-'; }
function fmtNum(v) { return v != null ? Number(v).toLocaleString() : '-'; }

function pctColor(pct, accent) {
  if (pct >= 90) return 'var(--temp)';
  if (pct >= 70) return 'var(--disk)';
  return accent || 'var(--cpu)';
}


// ============================================================
// Visualization Toolkit - ALL viz types pre-built
// ============================================================

// --- Viz Mode State Management ---
// Stores current visualization mode per metric key
// Modes: 'gauge', 'meter', 'bar', 'numeric'
// Default: gauge for maximum visual impact
const vizModes = {
  cpu_total: 'gauge',
  cpu_cores: 'gauge',
  memory: 'gauge',
  swap: 'gauge',
  gpu0: 'gauge',
  gpu1: 'gauge',
  gpu2: 'gauge',
  gpu3: 'gauge',
  disk: 'gauge',
  network: 'gauge',
  temperature: 'gauge',
  pcie: 'gauge',
  conntrack: 'gauge',
};
const VIZ_CYCLE = ['gauge', 'meter', 'bar', 'numeric'];

function getVizMode(key) {
  return vizModes[key] || 'gauge';
}

function cycleVizMode(key) {
  const current = getVizMode(key);
  const idx = VIZ_CYCLE.indexOf(current);
  vizModes[key] = VIZ_CYCLE[(idx + 1) % VIZ_CYCLE.length];
}

// --- 1. Sparkline SVG ---
function sparklineSVG(data, color, w, h) {
  if (!data || data.length < 2) return '';
  let max = 1;
  for (let i = 0; i < data.length; i++) { if (data[i] > max) max = data[i]; }
  const step = w / (data.length - 1);
  const points = data.map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h * 0.9 - h * 0.05).toFixed(1)}`);
  const polyline = points.join(' ');
  const gradId = _sid('sg');
  const areaPoints = `0,${h} ${polyline} ${w},${h}`;
  return `<span class="sparkline"><svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="width:100%;height:auto">
    <defs><linearGradient id="${gradId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${color}" stop-opacity="0.3"/>
      <stop offset="100%" stop-color="${color}" stop-opacity="0.02"/>
    </linearGradient></defs>
    <polygon points="${areaPoints}" fill="url(#${gradId})"/>
    <polyline points="${polyline}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg></span>`;
}

// --- 2. Bar Components ---
function barHTML(pct, color, thin) {
  const p = Math.min(Math.max(pct || 0, 0), 100);
  const cls = thin ? 'bar-container thin' : 'bar-container';
  return `<div class="${cls}"><div class="bar-fill" style="width:${p.toFixed(1)}%;background:${color}"></div></div>`;
}

function stackedBarHTML(segments) {
  let html = '<div class="bar-container"><div class="bar-stack">';
  for (const s of segments) {
    const p = Math.min(Math.max(s.pct || 0, 0), 100);
    html += `<div style="width:${p.toFixed(1)}%;background:${s.color}"></div>`;
  }
  html += '</div></div>';
  return html;
}

function barRowHTML(label, pct, color, valueText) {
  return `<div class="bar-row">
    <span class="bar-label">${label}</span>
    ${barHTML(pct, color, true)}
    <span class="bar-value" style="color:${pctColor(pct, color)}">${valueText || fmtPct(pct)}</span>
  </div>`;
}


// --- 3. Radial Gauge SVG ---
// Circular arc gauge for percentages (0-100 or custom range)
function gaugeSVG(value, max, color, size, label, unit) {
  size = size || 80;
  max = max || 100;
  unit = unit || '%';
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const r = (size - 10) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;  // 270-degree arc from bottom-left
  const totalArc = 270;
  const endAngle = startAngle + (totalArc * pct / 100);

  // Track arc (background)
  const trackD = describeArc(cx, cy, r, startAngle, startAngle + totalArc);
  // Value arc
  const valueD = pct > 0 ? describeArc(cx, cy, r, startAngle, endAngle) : '';
  const gradId = _sid('gg');
  const glowId = _sid('gw');

  // Dynamic color based on pct if no explicit color
  const activeColor = color || pctColor(pct);
  const displayVal = max === 100 ? value.toFixed(0) : value.toFixed(1);
  const fontSize = size <= 60 ? 13 : size <= 80 ? 16 : 20;
  const unitSize = size <= 60 ? 8 : 10;
  const labelSize = size <= 60 ? 7 : 9;

  return `<div class="gauge-wrap" style="width:${size}px;height:${size}px">
    <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stop-color="${activeColor}" stop-opacity="1"/>
          <stop offset="100%" stop-color="${activeColor}" stop-opacity="0.6"/>
        </linearGradient>
        <filter id="${glowId}"><feGaussianBlur stdDeviation="2" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      <path d="${trackD}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="5" stroke-linecap="round"/>
      ${valueD ? `<path d="${valueD}" fill="none" stroke="url(#${gradId})" stroke-width="5" stroke-linecap="round" filter="url(#${glowId})"/>` : ''}
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" dominant-baseline="central"
        fill="${activeColor}" font-size="${fontSize}" font-weight="700" font-family="inherit">${displayVal}</text>
      <text x="${cx}" y="${cy + fontSize * 0.6}" text-anchor="middle"
        fill="rgba(255,255,255,0.85)" font-size="${unitSize}" font-family="inherit">${unit}</text>
      ${label ? `<text x="${cx}" y="${size - 4}" text-anchor="middle"
        fill="rgba(255,255,255,0.9)" font-size="${labelSize}" font-weight="600" font-family="inherit">${label}</text>` : ''}
    </svg>
  </div>`;
}

// Helper: SVG arc path
function describeArc(cx, cy, r, startAngle, endAngle) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArc = endAngle - startAngle <= 180 ? 0 : 1;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 0 ${end.x} ${end.y}`;
}

function polarToCartesian(cx, cy, r, angleDeg) {
  const rad = (angleDeg - 90) * Math.PI / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}


// --- 4. Needle Meter SVG ---
// Half-circle meter with a needle for absolute values (RPM, watts, temp)
function meterSVG(value, max, color, size, label, unit) {
  size = size || 90;
  max = max || 100;
  unit = unit || '';
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const r = (size - 16) / 2;
  const cx = size / 2;
  const cy = size / 2 + 6;
  const startAngle = 180;
  const totalArc = 180;
  const needleAngle = startAngle + (totalArc * pct / 100);

  const trackD = describeArc(cx, cy, r, startAngle, startAngle + totalArc);
  const needlePt = polarToCartesian(cx, cy, r - 8, needleAngle);
  const activeColor = color || pctColor(pct);
  const gradId = _sid('mg');
  const glowId = _sid('mw');

  // Filled arc up to needle
  const fillD = pct > 0 ? describeArc(cx, cy, r, startAngle, needleAngle) : '';

  const fontSize = size <= 60 ? 11 : size <= 80 ? 14 : 17;
  const labelSize = size <= 60 ? 7 : 9;

  // Tick marks
  let ticks = '';
  for (let i = 0; i <= 5; i++) {
    const tickAngle = startAngle + (totalArc * i / 5);
    const outer = polarToCartesian(cx, cy, r + 2, tickAngle);
    const inner = polarToCartesian(cx, cy, r - 4, tickAngle);
    ticks += `<line x1="${outer.x}" y1="${outer.y}" x2="${inner.x}" y2="${inner.y}" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
    // Tick label
    const labelPt = polarToCartesian(cx, cy, r + 10, tickAngle);
    const tickVal = (max * i / 5).toFixed(0);
    ticks += `<text x="${labelPt.x}" y="${labelPt.y}" text-anchor="middle" dominant-baseline="central" fill="rgba(255,255,255,0.7)" font-size="7" font-weight="500" font-family="inherit">${tickVal}</text>`;
  }

  return `<div class="meter-wrap" style="width:${size}px;height:${size * 0.65}px">
    <svg width="${size}" height="${size * 0.65}" viewBox="0 0 ${size} ${size * 0.65}">
      <defs>
        <linearGradient id="${gradId}" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="${activeColor}" stop-opacity="0.4"/>
          <stop offset="100%" stop-color="${activeColor}" stop-opacity="1"/>
        </linearGradient>
        <filter id="${glowId}"><feGaussianBlur stdDeviation="1.5" result="glow"/>
          <feMerge><feMergeNode in="glow"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
      </defs>
      ${ticks}
      <path d="${trackD}" fill="none" stroke="rgba(255,255,255,0.06)" stroke-width="4" stroke-linecap="round"/>
      ${fillD ? `<path d="${fillD}" fill="none" stroke="url(#${gradId})" stroke-width="4" stroke-linecap="round"/>` : ''}
      <!-- Needle -->
      <line x1="${cx}" y1="${cy}" x2="${needlePt.x}" y2="${needlePt.y}" stroke="${activeColor}" stroke-width="2" stroke-linecap="round" filter="url(#${glowId})"/>
      <circle cx="${cx}" cy="${cy}" r="3" fill="${activeColor}" opacity="0.8"/>
      <!-- Value -->
      <text x="${cx}" y="${cy - 8}" text-anchor="middle" dominant-baseline="central"
        fill="${activeColor}" font-size="${fontSize}" font-weight="700" font-family="inherit">${typeof value === 'number' ? value.toFixed(max >= 1000 ? 0 : 1) : value}</text>
      <text x="${cx}" y="${cy - 8 + fontSize * 0.7}" text-anchor="middle"
        fill="rgba(255,255,255,0.85)" font-size="${labelSize}" font-weight="600" font-family="inherit">${unit}</text>
    </svg>
    ${label ? `<div class="meter-label">${label}</div>` : ''}
  </div>`;
}


// --- 5. Numeric Display ---
// Big number with optional unit and sub-label
function numericHTML(value, unit, color, label) {
  color = color || 'var(--text-bright)';
  return `<div class="numeric-display">
    <span class="numeric-val" style="color:${color}">${typeof value === 'number' ? (value >= 100 ? value.toFixed(0) : value.toFixed(1)) : value}</span>
    ${unit ? `<span class="numeric-unit">${unit}</span>` : ''}
    ${label ? `<div class="numeric-label">${label}</div>` : ''}
  </div>`;
}


// --- 6. Viz Toggle (dynamic switching) ---
// Renders the current viz mode and toggles on click
// key: unique metric key for state tracking
// value: current value
// max: maximum value
// color: accent color
// label: display label
// unit: unit string (%, W, RPM, etc.)
// opts: { thin, size, noToggle }
function vizToggle(key, value, max, color, label, unit, opts) {
  opts = opts || {};
  max = max || 100;
  unit = unit || '%';
  const mode = getVizMode(key);
  const size = opts.size || 70;
  const toggleAttr = opts.noToggle ? '' : `onclick="cycleVizMode('${key}')" style="cursor:pointer" title="Click to switch view"`;
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);

  let viz = '';
  switch (mode) {
    case 'bar':
      viz = `<div class="viz-bar-mode">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:3px">
          <span style="font-size:10px;color:var(--text-dim)">${label || ''}</span>
          <span style="font-size:12px;font-weight:600;color:${color || pctColor(pct)}">${typeof value === 'number' ? value.toFixed(max >= 1000 ? 0 : 1) : value}${unit}</span>
        </div>
        ${barHTML(pct, color || pctColor(pct), opts.thin !== false)}
      </div>`;
      break;
    case 'gauge':
      viz = gaugeSVG(value, max, color, size, label, unit);
      break;
    case 'meter':
      viz = meterSVG(value, max, color, size + 10, label, unit);
      break;
    case 'numeric':
      viz = numericHTML(value, unit, color, label);
      break;
  }

  return `<div class="viz-toggle" ${toggleAttr}>${viz}<div class="viz-mode-indicator">${mode}</div></div>`;
}


// --- 7. Mini Gauge Row ---
// Compact row with label, mini gauge, and value - for lists
function gaugeRowHTML(label, value, max, color, unit) {
  max = max || 100;
  unit = unit || '%';
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  return `<div class="gauge-row">
    <span class="gauge-row-label">${label}</span>
    ${gaugeSVG(value, max, color || pctColor(pct), 40, null, unit)}
    <span class="gauge-row-value" style="color:${color || pctColor(pct)}">${typeof value === 'number' ? value.toFixed(1) : value}${unit}</span>
  </div>`;
}


// --- 8. Horizontal Meter Bar ---
// Like a progress bar but with tick marks and needle indicator
function hMeterHTML(value, max, color, label, height) {
  max = max || 100;
  height = height || 20;
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  color = color || pctColor(pct);
  let ticks = '';
  for (let i = 0; i <= 10; i++) {
    ticks += `<div class="hmeter-tick" style="left:${i * 10}%"></div>`;
  }
  return `<div class="hmeter" style="height:${height}px">
    <div class="hmeter-track">
      <div class="hmeter-fill" style="width:${pct.toFixed(1)}%;background:${color}"></div>
      ${ticks}
      <div class="hmeter-needle" style="left:${pct.toFixed(1)}%;border-color:${color}"></div>
    </div>
    ${label ? `<div style="font-size:9px;color:var(--text);text-align:right;margin-top:1px">${label}</div>` : ''}
  </div>`;
}


// ============================================================
// Widget Renderers
// ============================================================

// --- Kernel / System Info ---
registerWidget('kernel', (w, m) => {
  const k = m.kernel;
  if (!k) return '<div class="empty-state">Waiting for data...</div>';
  const loadColor = k.load_1 / k.cpus > 1 ? 'var(--temp)' : k.load_1 / k.cpus > 0.7 ? 'var(--disk)' : 'var(--cpu)';
  return `<div class="kernel-bar">
    <div class="kernel-item"><span class="k-label">Kernel</span><span class="k-value c-kern">${k.version}</span></div>
    <div class="kernel-item"><span class="k-label">Uptime</span><span class="k-value">${k.uptime}</span></div>
    <div class="kernel-item"><span class="k-label">Load</span><span class="k-value" style="color:${loadColor}">${k.load_1} ${k.load_5} ${k.load_15}</span></div>
    <div class="kernel-item"><span class="k-label">CPUs</span><span class="k-value">${k.cpus}</span></div>
    <div class="kernel-item"><span class="k-label">Procs</span><span class="k-value">${k.running}/${k.total}</span></div>
    <div class="kernel-item"><span class="k-label">Ctx/s</span><span class="k-value">${fmtNum(k.ctx_sec)}</span></div>
    <div class="kernel-item"><span class="k-label">IRQ/s</span><span class="k-value">${fmtNum(k.intr_sec)}</span></div>
  </div>`;
});

// --- CPU Summary (with gauge toggle) ---
registerWidget('cpu_summary', (w, m, sp) => {
  const cpus = m.cpu;
  if (!cpus || cpus.length === 0) return '<div class="empty-state">Waiting...</div>';
  const total = cpus[0];
  const spark = sp.cpu || [];
  const mode = getVizMode('cpu_total');

  let html = '';
  if (mode === 'gauge') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;cursor:pointer" onclick="cycleVizMode('cpu_total')" title="Click to switch view">
      ${gaugeSVG(total.total, 100, 'var(--cpu)', 90, null, '%')}
      <div style="flex:1">${sparklineSVG(spark, 'var(--cpu)', 999, 50)}</div>
    </div>`;
  } else if (mode === 'meter') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;cursor:pointer" onclick="cycleVizMode('cpu_total')" title="Click to switch view">
      ${meterSVG(total.total, 100, 'var(--cpu)', 100, null, '%')}
      <div style="flex:1">${sparklineSVG(spark, 'var(--cpu)', 999, 50)}</div>
    </div>`;
  } else if (mode === 'numeric') {
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px;cursor:pointer" onclick="cycleVizMode('cpu_total')" title="Click to switch view">
      ${numericHTML(total.total, '%', 'var(--cpu)')}
      <div style="flex:1">${sparklineSVG(spark, 'var(--cpu)', 999, 50)}</div>
    </div>`;
  } else {
    // bar (default)
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:10px;cursor:pointer" onclick="cycleVizMode('cpu_total')" title="Click to switch view">
      <div class="kpi"><span class="kpi-val c-cpu">${total.total.toFixed(1)}</span><span class="kpi-unit">%</span></div>
      <div style="flex:1">${sparklineSVG(spark, 'var(--cpu)', 999, 50)}</div>
    </div>`;
  }

  // Stacked bar always shown
  html += stackedBarHTML([
    { pct: total.user, color: 'var(--cpu)' },
    { pct: total.system, color: 'rgba(34,211,167,0.5)' },
    { pct: total.iowait, color: 'var(--disk)' },
    { pct: total.irq, color: 'var(--mem)' },
    { pct: total.steal, color: 'var(--temp)' },
  ]);
  html += `<div style="display:flex;gap:12px;margin-top:6px;font-size:10px;color:var(--text-dim)">
    <span><span style="color:var(--cpu)">&#9632;</span> user ${total.user.toFixed(1)}%</span>
    <span><span style="color:rgba(34,211,167,0.5)">&#9632;</span> sys ${total.system.toFixed(1)}%</span>
    <span><span style="color:var(--disk)">&#9632;</span> iowait ${total.iowait.toFixed(1)}%</span>
    <span><span style="color:var(--mem)">&#9632;</span> irq ${total.irq.toFixed(1)}%</span>
  </div>`;
  html += `<div class="viz-mode-hint" onclick="cycleVizMode('cpu_total')">&#8635; ${mode}</div>`;
  return html;
});

// --- CPU Cores (gauge grid toggle) ---
registerWidget('cpu_cores', (w, m) => {
  const cpus = m.cpu;
  if (!cpus || cpus.length <= 1) return '<div class="empty-state">No per-core data</div>';
  const mode = getVizMode('cpu_cores');

  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('cpu_cores')">&#8635; ${mode}</div>`;

  if (mode === 'gauge') {
    html += '<div class="gauge-grid">';
    for (let i = 1; i < cpus.length; i++) {
      const c = cpus[i];
      html += gaugeSVG(c.total, 100, pctColor(c.total, 'var(--cpu)'), 56, c.label, '%');
    }
    html += '</div>';
  } else if (mode === 'meter') {
    html += '<div class="gauge-grid">';
    for (let i = 1; i < cpus.length; i++) {
      const c = cpus[i];
      html += meterSVG(c.total, 100, pctColor(c.total, 'var(--cpu)'), 70, c.label, '%');
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid">';
    for (let i = 1; i < cpus.length; i++) {
      const c = cpus[i];
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label">${c.label}</span>
        <span class="numeric-cell-val" style="color:${pctColor(c.total, 'var(--cpu)')}">${c.total.toFixed(0)}%</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<div style="max-height:100%;overflow-y:auto">';
    for (let i = 1; i < cpus.length; i++) {
      const c = cpus[i];
      html += barRowHTML(c.label, c.total, pctColor(c.total, 'var(--cpu)'), c.total.toFixed(0) + '%');
    }
    html += '</div>';
  }
  return html;
});

// --- Memory (with toggle) ---
registerWidget('memory', (w, m, sp) => {
  const mem = m.memory;
  if (!mem) return '<div class="empty-state">Waiting...</div>';
  const spark = sp.memory || [];
  const mode = getVizMode('memory');

  let html = '';
  if (mode === 'gauge') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      ${gaugeSVG(mem.used_pct, 100, 'var(--mem)', 85, null, '%')}
      <div>
        <div class="kpi-sub">${fmtKB(mem.used_kb)} / ${fmtKB(mem.total_kb)}</div>
        ${sparklineSVG(spark, 'var(--mem)', 80, 28)}
      </div>
    </div>`;
  } else if (mode === 'meter') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      ${meterSVG(mem.used_pct, 100, 'var(--mem)', 100, null, '%')}
      <div>
        <div class="kpi-sub">${fmtKB(mem.used_kb)} / ${fmtKB(mem.total_kb)}</div>
        ${sparklineSVG(spark, 'var(--mem)', 70, 28)}
      </div>
    </div>`;
  } else if (mode === 'numeric') {
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px">
      ${numericHTML(mem.used_pct, '%', 'var(--mem)')}
      ${sparklineSVG(spark, 'var(--mem)', 80, 30)}
    </div>
    <div class="kpi-sub">${fmtKB(mem.used_kb)} / ${fmtKB(mem.total_kb)}</div>`;
  } else {
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px">
      <div class="kpi"><span class="kpi-val c-mem">${mem.used_pct.toFixed(1)}</span><span class="kpi-unit">%</span></div>
      ${sparklineSVG(spark, 'var(--mem)', 80, 30)}
    </div>
    <div class="kpi-sub">${fmtKB(mem.used_kb)} / ${fmtKB(mem.total_kb)}</div>`;
  }

  html += '<div style="margin-top:8px">';
  html += stackedBarHTML([
    { pct: mem.used_pct, color: 'var(--mem)' },
    { pct: mem.buffers_pct, color: 'rgba(167,139,250,0.4)' },
    { pct: mem.cached_pct, color: 'rgba(167,139,250,0.2)' },
  ]);
  html += '</div>';
  html += `<div style="display:flex;gap:10px;margin-top:6px;font-size:10px;color:var(--text-dim)">
    <span><span style="color:var(--mem)">&#9632;</span> used</span>
    <span><span style="color:rgba(167,139,250,0.4)">&#9632;</span> buf</span>
    <span><span style="color:rgba(167,139,250,0.2)">&#9632;</span> cache</span>
  </div>`;
  if (mem.bw_gbs > 0) {
    html += `<div style="margin-top:6px;font-size:10px;color:var(--text-dim)">BW: ${mem.bw_gbs.toFixed(1)} GB/s</div>`;
  }
  html += `<div class="viz-mode-hint" onclick="cycleVizMode('memory')">&#8635; ${mode}</div>`;
  return html;
});

// --- Swap ---
registerWidget('swap', (w, m, sp) => {
  const s = m.swap;
  if (!s) return '<div class="empty-state">Waiting...</div>';
  if (s.total_kb === 0) return '<div class="empty-state">No swap configured</div>';
  const spark = sp.swap || [];
  const mode = getVizMode('swap');

  let html = '';
  if (mode === 'gauge') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      ${gaugeSVG(s.used_pct, 100, 'var(--swap)', 80, null, '%')}
      <div>
        <div class="kpi-sub">${fmtKB(s.used_kb)} / ${fmtKB(s.total_kb)}</div>
        ${sparklineSVG(spark, 'var(--swap)', 60, 24)}
      </div>
    </div>`;
  } else if (mode === 'meter') {
    html += `<div style="display:flex;align-items:center;gap:12px;margin-bottom:8px">
      ${meterSVG(s.used_pct, 100, 'var(--swap)', 90, null, '%')}
      <div class="kpi-sub">${fmtKB(s.used_kb)} / ${fmtKB(s.total_kb)}</div>
    </div>`;
  } else if (mode === 'numeric') {
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px">
      ${numericHTML(s.used_pct, '%', 'var(--swap)')}
      ${sparklineSVG(spark, 'var(--swap)', 80, 30)}
    </div>
    <div class="kpi-sub">${fmtKB(s.used_kb)} / ${fmtKB(s.total_kb)}</div>`;
  } else {
    html += `<div style="display:flex;align-items:flex-end;gap:12px;margin-bottom:8px">
      <div class="kpi"><span class="kpi-val c-swap">${s.used_pct.toFixed(1)}</span><span class="kpi-unit">%</span></div>
      ${sparklineSVG(spark, 'var(--swap)', 80, 30)}
    </div>
    <div class="kpi-sub">${fmtKB(s.used_kb)} / ${fmtKB(s.total_kb)}</div>
    <div style="margin-top:8px">${barHTML(s.used_pct, 'var(--swap)')}</div>`;
  }
  html += `<div class="viz-mode-hint" onclick="cycleVizMode('swap')">&#8635; ${mode}</div>`;
  return html;
});

// --- GPU (with gauges for util, temp, power, fan) ---
registerWidget('gpu', (w, m) => {
  const gpus = m.gpu;
  if (!gpus || gpus.length === 0) return '<div class="empty-state">No GPU detected</div>';
  let html = '';
  for (const g of gpus) {
    const gkey = 'gpu' + g.index;
    const mode = getVizMode(gkey);

    // Match PCIe device for this GPU
    const pcieDevs = m.pcie || [];
    const pcieDisplays = pcieDevs.filter(p => p.type === 'display' || (p.name && p.name.toLowerCase().includes('nvidia')));
    const gpuPcie = pcieDisplays[g.index] || pcieDisplays[0] || null;
    let pcieAutoMax = 1048576, rxPct = 0, txPct = 0;
    if (gpuPcie) {
      const peakBps = Math.max(gpuPcie.io_read_bps, gpuPcie.io_write_bps, 1);
      pcieAutoMax = niceScale(peakBps);
      rxPct = Math.min(gpuPcie.io_read_bps / pcieAutoMax * 100, 100);
      txPct = Math.min(gpuPcie.io_write_bps / pcieAutoMax * 100, 100);
    }

    if (mode === 'gauge') {
      // Gauge mode: circular gauges for all stats
      const powerPct = g.power_limit > 0 ? (g.power / g.power_limit * 100) : 0;
      html += `<div class="gpu-card">
        <div class="gpu-name">GPU${g.index}: ${g.name}
          <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
        </div>
        <div class="gauge-grid" style="justify-content:center">
          ${gaugeSVG(g.util, 100, 'var(--gpu)', 68, 'Util', '%')}
          ${gaugeSVG(g.mem_pct, 100, 'var(--mem)', 68, 'VRAM', '%')}
          ${gaugeSVG(g.temp, 110, g.temp >= 80 ? 'var(--temp)' : g.temp >= 60 ? 'var(--disk)' : 'var(--cpu)', 68, 'Temp', '°C')}
          ${gaugeSVG(g.power, g.power_limit || 350, null, 68, 'Power', 'W')}
          ${g.fan > 0 ? gaugeSVG(g.fan, 100, 'var(--net)', 56, 'Fan', '%') : ''}
          ${g.enc > 0 ? gaugeSVG(g.enc, 100, 'var(--kern)', 56, 'Enc', '%') : ''}
          ${g.dec > 0 ? gaugeSVG(g.dec, 100, 'var(--kern)', 56, 'Dec', '%') : ''}
          ${gpuPcie ? gaugeSVG(txPct, 100, 'var(--disk)', 56, 'TX', '%') : ''}
          ${gpuPcie ? gaugeSVG(rxPct, 100, 'var(--net)', 56, 'RX', '%') : ''}
        </div>
        ${gpuPcie ? `<div style="font-size:9px;color:var(--text-dim);text-align:center;margin-top:2px">PCIe ${gpuPcie.gen} x${gpuPcie.width} · TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
      </div>`;
    } else if (mode === 'meter') {
      // Meter mode: needle meters
      html += `<div class="gpu-card">
        <div class="gpu-name">GPU${g.index}: ${g.name}
          <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
        </div>
        <div class="gauge-grid" style="justify-content:center">
          ${meterSVG(g.util, 100, 'var(--gpu)', 80, 'Util', '%')}
          ${meterSVG(g.mem_pct, 100, 'var(--mem)', 80, 'VRAM', '%')}
          ${meterSVG(g.temp, 110, g.temp >= 80 ? 'var(--temp)' : g.temp >= 60 ? 'var(--disk)' : 'var(--cpu)', 80, 'Temp', '°C')}
          ${meterSVG(g.power, g.power_limit || 350, null, 80, 'Power', 'W')}
        </div>
        ${g.fan > 0 ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">Fan: ${g.fan}%  |  Enc: ${g.enc}%  Dec: ${g.dec}%</div>` : ''}
        ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
      </div>`;
    } else if (mode === 'numeric') {
      // Numeric mode
      html += `<div class="gpu-card">
        <div class="gpu-name">GPU${g.index}: ${g.name}
          <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;text-align:center">
          ${numericHTML(g.util, '%', 'var(--gpu)', 'Util')}
          ${numericHTML(g.mem_pct, '%', 'var(--mem)', 'VRAM')}
          ${numericHTML(g.temp, '°C', g.temp >= 80 ? 'var(--temp)' : 'var(--cpu)', 'Temp')}
          ${numericHTML(g.power, 'W', null, 'Power')}
          ${g.fan > 0 ? numericHTML(g.fan, '%', 'var(--net)', 'Fan') : ''}
        </div>
        ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
      </div>`;
    } else {
      // Bar mode (default)
      html += `<div class="gpu-card">
        <div class="gpu-name">GPU${g.index}: ${g.name}
          <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
        </div>
        <div class="gpu-stats">
          <div class="gpu-stat">
            <span class="gpu-stat-label">Util</span>
            <span class="gpu-stat-val c-gpu">${g.util.toFixed(0)}%</span>
            ${barHTML(g.util, 'var(--gpu)', true)}
          </div>
          <div class="gpu-stat">
            <span class="gpu-stat-label">VRAM</span>
            <span class="gpu-stat-val c-mem">${g.mem_pct.toFixed(0)}%</span>
            ${barHTML(g.mem_pct, 'var(--mem)', true)}
          </div>
          <div class="gpu-stat">
            <span class="gpu-stat-label">Temp</span>
            <span class="gpu-stat-val ${g.temp >= 80 ? 'c-temp' : g.temp >= 60 ? 'c-disk' : 'c-cpu'}">${g.temp}&deg;C</span>
          </div>
          <div class="gpu-stat">
            <span class="gpu-stat-label">Power</span>
            <span class="gpu-stat-val">${g.power}W<span style="color:var(--text-dim);font-size:11px">/${g.power_limit}W</span></span>
          </div>
        </div>
        ${g.fan > 0 ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">Fan: ${g.fan}%  |  Enc: ${g.enc}%  Dec: ${g.dec}%</div>` : ''}
        ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
      </div>`;
    }
  }
  return html;
});

// --- Disk I/O (with viz toggle) ---
registerWidget('disk', (w, m) => {
  const disks = m.disk;
  if (!disks || disks.length === 0) return '<div class="empty-state">No disks</div>';
  const mode = getVizMode('disk');
  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('disk')">&#8635; ${mode}</div>`;

  const active = disks.filter(d => !d.raid_member_of);

  if (mode === 'gauge' || mode === 'meter') {
    // Autoscale: peak across all disks, rounded up to power of 2
    let peakBps = 0;
    for (const d of active) { peakBps = Math.max(peakBps, d.read_bps, d.write_bps); }
    const autoMax = niceScale(peakBps);
    html += `<div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">scale: ${fmtBytes(autoMax)}/s</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const d of active) {
      const rPct = Math.min(d.read_bps / autoMax * 100, 100);
      const wPct = Math.min(d.write_bps / autoMax * 100, 100);
      html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:6px 8px;min-width:120px">
        <div style="font-size:10px;font-weight:600;margin-bottom:4px">${d.name}</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${mode === 'gauge'
            ? gaugeSVG(rPct, 100, 'var(--net)', 50, 'R', '%') + gaugeSVG(wPct, 100, 'var(--disk)', 50, 'W', '%')
            : meterSVG(rPct, 100, 'var(--net)', 60, 'R', '%') + meterSVG(wPct, 100, 'var(--disk)', 60, 'W', '%')}
        </div>
        <div style="font-size:9px;color:var(--text-dim);margin-top:2px">${fmtBps(d.read_bps)} / ${fmtBps(d.write_bps)}</div>
      </div>`;
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">';
    for (const d of active) {
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label">${d.name}</span>
        <span style="font-size:11px;color:var(--net);font-weight:600">R ${fmtBps(d.read_bps)}</span>
        <span style="font-size:11px;color:var(--disk);font-weight:600">W ${fmtBps(d.write_bps)}</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<table class="metric-table"><thead><tr><th>Disk</th><th class="num">Read</th><th class="num">Write</th><th class="num">IOPS R</th><th class="num">IOPS W</th></tr></thead><tbody>';
    for (const d of active) {
      html += `<tr>
        <td class="name-cell">${d.name}</td>
        <td class="num"><span class="io-label io-read">${fmtBps(d.read_bps)}</span></td>
        <td class="num"><span class="io-label io-write">${fmtBps(d.write_bps)}</span></td>
        <td class="num">${d.read_iops > 0 ? d.read_iops.toFixed(0) : '-'}</td>
        <td class="num">${d.write_iops > 0 ? d.write_iops.toFixed(0) : '-'}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
});

// --- Network (with viz toggle) ---
registerWidget('network', (w, m) => {
  const nets = m.network;
  if (!nets || nets.length === 0) return '<div class="empty-state">No interfaces</div>';
  const mode = getVizMode('network');
  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('network')">&#8635; ${mode}</div>`;

  const active = nets.filter(n => !n.bond_member_of);

  if (mode === 'gauge' || mode === 'meter') {
    // Autoscale: peak across all interfaces, rounded up to power of 2
    let peakBps = 0;
    for (const n of active) { peakBps = Math.max(peakBps, n.rx_bps, n.tx_bps); }
    const autoMax = niceScale(peakBps);
    html += `<div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">scale: ${fmtBytes(autoMax)}/s</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const n of active) {
      const rxPct = Math.min(n.rx_bps / autoMax * 100, 100);
      const txPct = Math.min(n.tx_bps / autoMax * 100, 100);
      html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:6px 8px;min-width:120px">
        <div style="font-size:10px;font-weight:600;margin-bottom:4px">${n.name}</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${mode === 'gauge'
            ? gaugeSVG(txPct, 100, 'var(--disk)', 50, 'TX', '%') + gaugeSVG(rxPct, 100, 'var(--net)', 50, 'RX', '%')
            : meterSVG(txPct, 100, 'var(--disk)', 60, 'TX', '%') + meterSVG(rxPct, 100, 'var(--net)', 60, 'RX', '%')}
        </div>
        <div style="font-size:9px;color:var(--text-dim);margin-top:2px">TX ${fmtBps(n.tx_bps)} / RX ${fmtBps(n.rx_bps)}</div>
      </div>`;
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">';
    for (const n of active) {
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label">${n.name}</span>
        <span style="font-size:11px;color:var(--disk);font-weight:600">TX ${fmtBps(n.tx_bps)}</span>
        <span style="font-size:11px;color:var(--net);font-weight:600">RX ${fmtBps(n.rx_bps)}</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<table class="metric-table"><thead><tr><th>Interface</th><th>Type</th><th class="num">TX</th><th class="num">RX</th></tr></thead><tbody>';
    for (const n of active) {
      html += `<tr>
        <td class="name-cell">${n.name}</td>
        <td>${n.type}</td>
        <td class="num"><span class="io-label io-write">${fmtBps(n.tx_bps)}</span></td>
        <td class="num"><span class="io-label io-read">${fmtBps(n.rx_bps)}</span></td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
});

// --- Temperature (with gauge/meter toggle) ---
registerWidget('temperature', (w, m) => {
  const temps = m.temperature;
  if (!temps || temps.length === 0) return '<div class="empty-state">No sensors</div>';
  const mode = getVizMode('temperature');

  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('temperature')">&#8635; ${mode}</div>`;

  // Flatten all sensors and fans across devices into single grids
  if (mode === 'gauge' || mode === 'meter') {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:4px;justify-items:center">';
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const critMax = s.crit > 0 ? s.crit : 110;
        const clr = s.temp >= 80 ? 'var(--temp)' : s.temp >= 55 ? 'var(--disk)' : 'var(--cpu)';
        const shortLabel = s.label.length > 6 ? s.label.slice(0, 6) : s.label;
        html += mode === 'gauge'
          ? gaugeSVG(s.temp, critMax, clr, 48, shortLabel, '°C')
          : meterSVG(s.temp, critMax, clr, 62, shortLabel, '°C');
      }
      for (const f of dev.fans) {
        html += mode === 'gauge'
          ? gaugeSVG(f.rpm, 5000, 'var(--net)', 48, f.label, 'RPM')
          : meterSVG(f.rpm, 5000, 'var(--net)', 62, f.label, 'RPM');
      }
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr))">';
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const clr = s.temp >= 80 ? 'var(--temp)' : s.temp >= 55 ? 'var(--disk)' : 'var(--cpu)';
        html += `<div class="numeric-cell">
          <span class="numeric-cell-label">${s.label}</span>
          <span class="numeric-cell-val" style="color:${clr}">${s.temp.toFixed(1)}°C</span>
        </div>`;
      }
      for (const f of dev.fans) {
        html += `<div class="numeric-cell">
          <span class="numeric-cell-label">${f.label}</span>
          <span class="numeric-cell-val" style="color:var(--net)">${f.rpm} RPM</span>
        </div>`;
      }
    }
    html += '</div>';
  } else {
    // bar mode
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const cls = s.temp >= 80 ? 'hot' : s.temp >= 55 ? 'warm' : 'cool';
        const critInfo = s.crit > 0 ? ` / ${s.crit.toFixed(0)}&deg;` : '';
        html += `<div class="temp-row">
          <span style="font-size:11px">${s.label}</span>
          <span class="temp-val ${cls}">${s.temp.toFixed(1)}&deg;C${critInfo}</span>
        </div>`;
      }
      for (const f of dev.fans) {
        html += `<div class="fan-row"><span>${f.label}</span><span class="fan-rpm">${f.rpm} RPM</span></div>`;
      }
    }
  }
  return html;
});

// --- Process ---
registerWidget('process', (w, m) => {
  const procs = m.process;
  if (!procs || procs.length === 0) return '<div class="empty-state">No processes</div>';
  let html = '<table class="metric-table"><thead><tr><th>PID</th><th>Name</th><th class="num">CPU%</th><th class="num">MEM</th><th>S</th></tr></thead><tbody>';
  for (const p of procs) {
    const cpuColor = p.cpu >= 50 ? 'var(--temp)' : p.cpu >= 20 ? 'var(--disk)' : 'var(--text)';
    html += `<tr>
      <td style="color:var(--text-dim)">${p.pid}</td>
      <td class="name-cell">${p.name}</td>
      <td class="num" style="color:${cpuColor};font-weight:600">${p.cpu.toFixed(1)}</td>
      <td class="num">${p.mem_mb.toFixed(0)} MB</td>
      <td style="color:var(--text-dim)">${p.state || '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
});

// --- PCIe (with viz toggle) ---
registerWidget('pcie', (w, m) => {
  const devices = m.pcie;
  if (!devices || devices.length === 0) return '<div class="empty-state">No PCIe data</div>';
  const mode = getVizMode('pcie');
  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('pcie')">&#8635; ${mode}</div>`;

  if (mode === 'gauge' || mode === 'meter') {
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const d of devices) {
      const maxBw = d.max_bw_bps || 1;
      const rPct = Math.min(d.io_read_bps / maxBw * 100, 100);
      const wPct = Math.min(d.io_write_bps / maxBw * 100, 100);
      html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:6px 8px;min-width:130px">
        <div style="font-size:9px;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px" title="${d.name}">${d.name}</div>
        <div style="font-size:8px;color:var(--text-dim)">${d.gen} x${d.width} (${fmtBytes(maxBw)}/s)</div>
        <div style="display:flex;gap:4px;align-items:center;margin-top:4px">
          ${mode === 'gauge'
            ? gaugeSVG(rPct, 100, 'var(--net)', 48, 'R', '%') + gaugeSVG(wPct, 100, 'var(--disk)', 48, 'W', '%')
            : meterSVG(rPct, 100, 'var(--net)', 58, 'R', '%') + meterSVG(wPct, 100, 'var(--disk)', 58, 'W', '%')}
        </div>
        <div style="font-size:8px;color:var(--text-dim);margin-top:2px">${fmtBps(d.io_read_bps)} / ${fmtBps(d.io_write_bps)}</div>
      </div>`;
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(110px,1fr))">';
    for (const d of devices) {
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label" title="${d.name}" style="max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${d.name}</span>
        <span style="font-size:8px;color:var(--text-dim)">${d.gen} x${d.width}</span>
        <span style="font-size:10px;color:var(--net);font-weight:600">R ${fmtBps(d.io_read_bps)}</span>
        <span style="font-size:10px;color:var(--disk);font-weight:600">W ${fmtBps(d.io_write_bps)}</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<table class="metric-table"><thead><tr><th>Device</th><th>Link</th><th class="num">Read</th><th class="num">Write</th></tr></thead><tbody>';
    for (const d of devices) {
      html += `<tr>
        <td class="name-cell">${d.name}</td>
        <td>${d.gen} x${d.width}</td>
        <td class="num">${fmtBps(d.io_read_bps)}</td>
        <td class="num">${fmtBps(d.io_write_bps)}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
});

// --- Conntrack (with viz toggle) ---
registerWidget('conntrack', (w, m) => {
  const conns = m.conntrack;
  if (!conns || conns.length === 0) return '<div class="empty-state">No connection data</div>';
  const mode = getVizMode('conntrack');
  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('conntrack')">&#8635; ${mode}</div>`;

  if (mode === 'gauge' || mode === 'meter') {
    // Autoscale: peak across all connections, rounded up to power of 2
    let peakBps = 0;
    for (const c of conns) { const m = c.tx_bps > c.rx_bps ? c.tx_bps : c.rx_bps; if (m > peakBps) peakBps = m; }
    const maxBps = niceScale(peakBps);
    html += `<div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">scale: ${fmtBytes(maxBps)}/s</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const c of conns) {
      const txPct = Math.min(c.tx_bps / maxBps * 100, 100);
      const rxPct = Math.min(c.rx_bps / maxBps * 100, 100);
      html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:6px 8px;min-width:120px">
        <div style="font-size:9px;font-weight:600;margin-bottom:2px">${c.ip}</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${mode === 'gauge'
            ? gaugeSVG(txPct, 100, 'var(--disk)', 46, 'TX', '%') + gaugeSVG(rxPct, 100, 'var(--net)', 46, 'RX', '%')
            : meterSVG(txPct, 100, 'var(--disk)', 56, 'TX', '%') + meterSVG(rxPct, 100, 'var(--net)', 56, 'RX', '%')}
        </div>
        <div style="font-size:8px;color:var(--text-dim);margin-top:2px">${c.conns} conns | ${fmtBps(c.tx_bps)} / ${fmtBps(c.rx_bps)}</div>
      </div>`;
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">';
    for (const c of conns) {
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label">${c.ip}</span>
        <span style="font-size:10px;color:var(--disk);font-weight:600">TX ${fmtBps(c.tx_bps)}</span>
        <span style="font-size:10px;color:var(--net);font-weight:600">RX ${fmtBps(c.rx_bps)}</span>
        <span style="font-size:9px;color:var(--text-dim)">${c.conns} conns</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<table class="metric-table"><thead><tr><th>Remote IP</th><th class="num">TX</th><th class="num">RX</th><th class="num">Conns</th></tr></thead><tbody>';
    for (const c of conns) {
      html += `<tr>
        <td class="name-cell">${c.ip}</td>
        <td class="num">${fmtBps(c.tx_bps)}</td>
        <td class="num">${fmtBps(c.rx_bps)}</td>
        <td class="num">${c.conns}</td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
});

// --- NAS (NFS/CIFS/SMB) ---
registerWidget('nfs', (w, m) => {
  const mounts = m.nfs;
  if (!mounts || mounts.length === 0) return '<div class="empty-state">No NAS mounts</div>';
  const mode = getVizMode('nfs');
  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('nfs')">&#8635; ${mode}</div>`;

  if (mode === 'gauge' || mode === 'meter') {
    let peakBps = 0;
    for (const n of mounts) { peakBps = Math.max(peakBps, n.read_bps, n.write_bps); }
    const autoMax = niceScale(peakBps);
    html += `<div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">scale: ${fmtBytes(autoMax)}/s</div>`;
    html += '<div style="display:flex;flex-wrap:wrap;gap:8px">';
    for (const n of mounts) {
      const wPct = Math.min(n.write_bps / autoMax * 100, 100);
      const rPct = Math.min(n.read_bps / autoMax * 100, 100);
      const short = n.mount.length > 18 ? '...' + n.mount.slice(-15) : n.mount;
      html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:6px 8px;min-width:120px">
        <div style="font-size:10px;font-weight:600;margin-bottom:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${n.device}">${short}</div>
        <div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">${n.type}</div>
        <div style="display:flex;gap:4px;align-items:center">
          ${mode === 'gauge'
            ? gaugeSVG(wPct, 100, 'var(--disk)', 50, 'W', '%') + gaugeSVG(rPct, 100, 'var(--net)', 50, 'R', '%')
            : meterSVG(wPct, 100, 'var(--disk)', 60, 'W', '%') + meterSVG(rPct, 100, 'var(--net)', 60, 'R', '%')}
        </div>
        <div style="font-size:9px;color:var(--text-dim);margin-top:2px">W ${fmtBps(n.write_bps)} / R ${fmtBps(n.read_bps)}</div>
      </div>`;
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(100px,1fr))">';
    for (const n of mounts) {
      const short = n.mount.length > 15 ? '...' + n.mount.slice(-12) : n.mount;
      html += `<div class="numeric-cell">
        <span class="numeric-cell-label">${short}</span>
        <span style="font-size:11px;color:var(--disk);font-weight:600">W ${fmtBps(n.write_bps)}</span>
        <span style="font-size:11px;color:var(--net);font-weight:600">R ${fmtBps(n.read_bps)}</span>
        <span style="font-size:9px;color:var(--text-dim)">${n.type}</span>
      </div>`;
    }
    html += '</div>';
  } else {
    html += '<table class="metric-table"><thead><tr><th>Mount</th><th>Type</th><th class="num">Write</th><th class="num">Read</th></tr></thead><tbody>';
    for (const n of mounts) {
      html += `<tr>
        <td class="name-cell" title="${n.device}">${n.mount}</td>
        <td>${n.type}</td>
        <td class="num"><span class="io-label io-write">${fmtBps(n.write_bps)}</span></td>
        <td class="num"><span class="io-label io-read">${fmtBps(n.read_bps)}</span></td>
      </tr>`;
    }
    html += '</tbody></table>';
  }
  return html;
});
