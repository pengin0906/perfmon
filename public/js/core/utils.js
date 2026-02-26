/* ============================================================
   PerfMon Core - Widget Registry, Format, Viz Toolkit
   pforce-pattern: shared utilities loaded before components
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
// Visualization Toolkit
// ============================================================

// --- Viz Mode State Management ---
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
function gaugeSVG(value, max, color, size, label, unit) {
  size = size || 80;
  max = max || 100;
  unit = unit || '%';
  const pct = Math.min(Math.max((value / max) * 100, 0), 100);
  const r = (size - 10) / 2;
  const cx = size / 2;
  const cy = size / 2;
  const startAngle = 135;
  const totalArc = 270;
  const endAngle = startAngle + (totalArc * pct / 100);

  const trackD = describeArc(cx, cy, r, startAngle, startAngle + totalArc);
  const valueD = pct > 0 ? describeArc(cx, cy, r, startAngle, endAngle) : '';
  const gradId = _sid('gg');
  const glowId = _sid('gw');

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

  const fillD = pct > 0 ? describeArc(cx, cy, r, startAngle, needleAngle) : '';

  const fontSize = size <= 60 ? 11 : size <= 80 ? 14 : 17;
  const labelSize = size <= 60 ? 7 : 9;

  let ticks = '';
  for (let i = 0; i <= 5; i++) {
    const tickAngle = startAngle + (totalArc * i / 5);
    const outer = polarToCartesian(cx, cy, r + 2, tickAngle);
    const inner = polarToCartesian(cx, cy, r - 4, tickAngle);
    ticks += `<line x1="${outer.x}" y1="${outer.y}" x2="${inner.x}" y2="${inner.y}" stroke="rgba(255,255,255,0.4)" stroke-width="1"/>`;
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
function numericHTML(value, unit, color, label) {
  color = color || 'var(--text-bright)';
  return `<div class="numeric-display">
    <span class="numeric-val" style="color:${color}">${typeof value === 'number' ? (value >= 100 ? value.toFixed(0) : value.toFixed(1)) : value}</span>
    ${unit ? `<span class="numeric-unit">${unit}</span>` : ''}
    ${label ? `<div class="numeric-label">${label}</div>` : ''}
  </div>`;
}


// --- 6. Viz Toggle ---
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
