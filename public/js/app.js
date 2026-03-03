/* ============================================================
   PerfMon App - Dashboard controller, D&D, drilldown
   pforce pattern: store-based state + metadata-driven navigation
   With JS-side performance profiling
   ============================================================ */

'use strict';

// --- Global State (pforce store pattern) ---
let config = null;
let layout = [];
let editMode = false;
let metricsLoop = null;
let latestMetrics = {};
let latestSparklines = {};
let drilldownOpen = false;
let drilldownType = null;

// --- JS-side Performance Profiler ---
const perfProfile = {
  enabled: false,
  data: {},    // { name: [ms, ms, ...] }
  count: 0,
};

function perfStart(name) {
  if (!perfProfile.enabled) return 0;
  return performance.now();
}
function perfEnd(name, t0) {
  if (!perfProfile.enabled || !t0) return;
  const elapsed = performance.now() - t0;
  if (!perfProfile.data[name]) perfProfile.data[name] = [];
  perfProfile.data[name].push(elapsed);
}
function perfPrint() {
  if (!perfProfile.enabled) return;
  perfProfile.count++;
  if (perfProfile.count % 10 !== 0) return;
  console.log('%c[perfmon-engine profile]', 'color:#22d3a7;font-weight:bold');
  const entries = Object.entries(perfProfile.data).sort((a,b) => a[0].localeCompare(b[0]));
  for (const [name, times] of entries) {
    const recent = times.slice(-10);
    const avg = recent.reduce((a,b) => a+b, 0) / recent.length;
    const max = Math.max(...recent);
    console.log(`  ${name.padEnd(20)} avg=${avg.toFixed(2)}ms  max=${max.toFixed(2)}ms`);
  }
}

// Enable profiling from URL param or config
function checkProfileEnabled() {
  if (location.search.includes('profile')) {
    perfProfile.enabled = true;
    console.log('[perfmon] JS profiling enabled');
  }
}

// --- Bootstrap ---
async function waitForApi(timeout) {
  timeout = timeout || 10000;
  const start = Date.now();
  while (!window.pywebview || !window.pywebview.api) {
    if (Date.now() - start > timeout) throw new Error('pywebview API timeout');
    await new Promise(r => setTimeout(r, 50));
  }
}

async function init() {
  checkProfileEnabled();
  try {
    await waitForApi();
    config = await pywebview.api.get_config();
    layout = config.layout || [];

    // Enable profiling from config
    if (config.meta && config.meta.profile_js) {
      perfProfile.enabled = true;
      console.log('[perfmon] JS profiling enabled via config');
    }

    renderPalette(config.palette || []);
    renderDashboard();
    startMetrics();
  } catch (e) {
    document.getElementById('dashboard').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1">${e.message}</div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => setTimeout(init, 100));

// --- Metrics Loop ---
function startMetrics() {
  const interval = (config.meta && config.meta.refresh_ms) || 1500;
  async function tick() {
    try {
      const t0 = perfStart('api_call');
      const result = await pywebview.api.get_metrics();
      perfEnd('api_call', t0);

      latestMetrics = result.metrics || {};
      latestSparklines = result.sparklines || {};

      const t1 = perfStart('render');
      if (!drilldownOpen) updateWidgets();
      else updateDrilldown();
      perfEnd('render', t1);

      perfPrint();

      document.getElementById('status-dot').style.background = 'var(--cpu)';
    } catch (e) {
      document.getElementById('status-dot').style.background = 'var(--temp)';
    }
    metricsLoop = setTimeout(tick, interval);
  }
  tick();
}

// --- Render Dashboard Grid ---
function renderDashboard() {
  invalidateDomCache();
  _prevMetricsHash = '';
  const grid = document.getElementById('dashboard');
  grid.innerHTML = '';
  for (const w of layout) {
    const el = createWidgetEl(w);
    grid.appendChild(el);
  }
}

function createWidgetEl(w) {
  const el = document.createElement('div');
  el.className = 'widget';
  el.id = 'widget-' + w.id;
  el.style.gridColumn = `${w.col} / span ${w.w}`;
  el.style.gridRow = `${w.row} / span ${w.h}`;
  el.setAttribute('data-widget-id', w.id);
  el.setAttribute('data-widget-type', w.type);

  el.innerHTML = `
    <div class="widget-header">
      <span class="drag-handle" title="Drag to move">&#9776;</span>
      <h3>${w.label || w.type}</h3>
      <button class="remove-btn" title="Remove" onclick="removeWidget('${w.id}')">&times;</button>
    </div>
    <div class="widget-content" onclick="openDrilldown('${w.type}')">
      <div class="empty-state">Loading...</div>
    </div>`;

  // D&D for edit mode
  el.draggable = false;
  el.addEventListener('mousedown', (e) => {
    if (!editMode) return;
    if (!e.target.closest('.drag-handle')) return;
    startDrag(e, w, el);
  });

  return el;
}

// DOM element cache (avoid repeated getElementById/querySelector per tick)
const _domCache = {};
function _getWidgetContent(id) {
  if (_domCache[id]) return _domCache[id];
  const el = document.getElementById('widget-' + id);
  if (!el) return null;
  const content = el.querySelector('.widget-content');
  if (!content) return null;
  _domCache[id] = content;
  return content;
}
function invalidateDomCache() { for (const k in _domCache) delete _domCache[k]; }

// Data hash for skip-render optimization
let _prevMetricsHash = '';
function _quickHash(obj) {
  return JSON.stringify(obj);
}

// --- Auto-hide: metric key mapping per widget type ---
const _widgetMetricKey = {
  kernel: 'kernel', cpu_summary: 'cpu', cpu_cores: 'cpu',
  memory: 'memory', swap: 'swap', gpu: 'gpu', disk: 'disk',
  network: 'network', temperature: 'temperature', process: 'process',
  pcie: 'pcie', conntrack: 'conntrack', nfs: 'nfs',
};

function _hasData(type, metrics) {
  const key = _widgetMetricKey[type];
  if (!key) return true;  // unknown widget types always shown
  const d = metrics[key];
  if (d == null) return false;
  if (Array.isArray(d) && d.length === 0) return false;
  // swap: hide if no swap configured
  if (key === 'swap' && d.total_kb === 0) return false;
  return true;
}

function updateWidgets() {
  // Reset SVG ID counter each render cycle to keep IDs deterministic
  _svgIdSeq = 0;
  const hash = _quickHash(latestMetrics);
  const changed = hash !== _prevMetricsHash;
  _prevMetricsHash = hash;
  if (!changed) return;  // skip render if data unchanged
  for (const w of layout) {
    const el = document.getElementById('widget-' + w.id);
    if (!el) continue;
    // Auto-hide widgets with no data (unless in edit mode)
    const has = _hasData(w.type, latestMetrics);
    if (!editMode) {
      el.style.display = has ? '' : 'none';
    }
    if (!has) continue;
    const content = el.querySelector('.widget-content');
    if (!content) continue;
    const t0 = perfStart('widget_' + w.type);
    content.innerHTML = renderWidget(w, latestMetrics, latestSparklines);
    perfEnd('widget_' + w.type, t0);
  }
}

// --- Edit Mode ---
function toggleEditMode() {
  editMode = !editMode;
  const btn = document.getElementById('btn-edit');
  const saveBtn = document.getElementById('btn-save');
  const sidebar = document.getElementById('sidebar');

  btn.classList.toggle('active', editMode);
  btn.textContent = editMode ? 'Done' : 'Edit';
  saveBtn.style.display = editMode ? '' : 'none';
  sidebar.classList.toggle('open', editMode);

  if (editMode) {
    document.getElementById('dashboard').classList.add('edit-mode');
    for (const w of layout) {
      const el = document.getElementById('widget-' + w.id);
      if (el) el.draggable = true;
    }
  } else {
    document.getElementById('dashboard').classList.remove('edit-mode');
    for (const w of layout) {
      const el = document.getElementById('widget-' + w.id);
      if (el) el.draggable = false;
    }
  }
}

async function saveLayout() {
  const result = await pywebview.api.save_layout(layout);
  if (result.ok) {
    showToast('Layout saved to YAML', 'success');
  } else {
    showToast('Save failed: ' + result.error, 'error');
  }
}

// --- Palette ---
function renderPalette(palette) {
  const list = document.getElementById('palette-list');
  let html = '';
  for (const p of palette) {
    html += `<div class="palette-item" draggable="true"
      ondragstart="paletteDragStart(event, '${p.type}', '${p.label}', ${p.default_w}, ${p.default_h})">
      <div class="p-icon">${p.icon || '?'}</div>
      <div>
        <div class="p-label">${p.label}</div>
        <div class="p-size">${p.default_w}x${p.default_h}</div>
      </div>
    </div>`;
  }
  list.innerHTML = html;
}

function paletteDragStart(e, type, label, w, h) {
  e.dataTransfer.setData('application/perfmon-new', JSON.stringify({ type, label, w, h }));
  e.dataTransfer.effectAllowed = 'copy';
}

// --- Widget D&D (reposition) ---
let dragInfo = null;

function startDrag(e, widget, el) {
  e.preventDefault();
  const grid = document.getElementById('dashboard');
  const gridRect = grid.getBoundingClientRect();
  const cellW = (gridRect.width - 11 * 10) / 12;
  const cellH = 100 + 10;

  dragInfo = {
    widget, el,
    startX: e.clientX, startY: e.clientY,
    origCol: widget.col, origRow: widget.row,
    cellW, cellH, gridRect,
  };

  el.classList.add('dragging');

  const onMove = (ev) => {
    const dx = ev.clientX - dragInfo.startX;
    const dy = ev.clientY - dragInfo.startY;
    const dCol = Math.round(dx / dragInfo.cellW);
    const dRow = Math.round(dy / dragInfo.cellH);
    const newCol = Math.max(1, Math.min(13 - widget.w, dragInfo.origCol + dCol));
    const newRow = Math.max(1, dragInfo.origRow + dRow);
    widget.col = newCol;
    widget.row = newRow;
    el.style.gridColumn = `${newCol} / span ${widget.w}`;
    el.style.gridRow = `${newRow} / span ${widget.h}`;
  };

  const onUp = () => {
    el.classList.remove('dragging');
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    dragInfo = null;
  };

  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
}

// Dashboard drop (for palette items)
document.addEventListener('DOMContentLoaded', () => {
  const grid = document.getElementById('dashboard');
  grid.addEventListener('dragover', (e) => {
    if (!editMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  });
  grid.addEventListener('drop', (e) => {
    if (!editMode) return;
    e.preventDefault();
    const raw = e.dataTransfer.getData('application/perfmon-new');
    if (!raw) return;
    const info = JSON.parse(raw);
    const gridRect = grid.getBoundingClientRect();
    const cellW = (gridRect.width - 11 * 10) / 12;
    const cellH = 110;
    const col = Math.max(1, Math.min(13 - info.w, Math.floor((e.clientX - gridRect.left) / cellW) + 1));
    const row = Math.max(1, Math.floor((e.clientY - gridRect.top + grid.scrollTop) / cellH) + 1);

    const newWidget = {
      id: info.type + '-' + Date.now().toString(36),
      type: info.type,
      label: info.label,
      col, row,
      w: info.w,
      h: info.h,
    };
    layout.push(newWidget);
    grid.appendChild(createWidgetEl(newWidget));
    updateWidgets();
    showToast(`Added ${info.label}`, 'success');
  });
});

function removeWidget(id) {
  const idx = layout.findIndex(w => w.id === id);
  if (idx === -1) return;
  layout.splice(idx, 1);
  const el = document.getElementById('widget-' + id);
  if (el) el.remove();
  showToast('Widget removed', 'success');
}

// --- Drilldown Detail View ---
function openDrilldown(type) {
  if (editMode) return;
  drilldownOpen = true;
  drilldownType = type;

  const grid = document.getElementById('dashboard');
  grid._savedScroll = grid.scrollTop;

  const overlay = document.createElement('div');
  overlay.id = 'drilldown-overlay';
  overlay.style.cssText = `
    position:absolute;inset:0;z-index:100;
    background:rgba(11,17,32,0.92);
    backdrop-filter:blur(20px);
    overflow-y:auto;
    padding:20px;
    animation:fadeIn 0.2s ease;
  `;
  overlay.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h2 style="font-size:18px;font-weight:600;color:var(--text-bright)">${drilldownTitle(type)}</h2>
      <button class="btn" onclick="closeDrilldown()">Back</button>
    </div>
    <div id="drilldown-content"></div>
  `;

  const mainArea = document.getElementById('main-area');
  mainArea.style.position = 'relative';
  mainArea.appendChild(overlay);

  updateDrilldown();
}

function closeDrilldown() {
  drilldownOpen = false;
  drilldownType = null;
  const overlay = document.getElementById('drilldown-overlay');
  if (overlay) overlay.remove();
}

function drilldownTitle(type) {
  const titles = {
    cpu_summary: 'CPU Detail', cpu_cores: 'CPU Cores Detail',
    memory: 'Memory Detail', swap: 'Swap Detail',
    gpu: 'GPU Detail', disk: 'Disk I/O Detail',
    network: 'Network Detail', temperature: 'Temperature Detail',
    process: 'Process Detail', kernel: 'System Detail',
    pcie: 'PCIe Detail', conntrack: 'Connection Detail',
    nfs: 'NAS Storage Detail',
  };
  return titles[type] || type;
}

function updateDrilldown() {
  const el = document.getElementById('drilldown-content');
  if (!el) return;
  const m = latestMetrics;
  const sp = latestSparklines;
  const t0 = perfStart('drilldown_' + drilldownType);

  switch (drilldownType) {
    case 'cpu_summary':
    case 'cpu_cores':
      el.innerHTML = drillCPU(m, sp);
      break;
    case 'memory':
      el.innerHTML = drillMemory(m, sp);
      break;
    case 'gpu':
      el.innerHTML = drillGPU(m, sp);
      break;
    case 'disk':
      el.innerHTML = drillDisk(m);
      break;
    case 'network':
      el.innerHTML = drillNetwork(m);
      break;
    case 'temperature':
      el.innerHTML = drillTemp(m);
      break;
    case 'process':
      el.innerHTML = drillProcess(m);
      break;
    case 'pcie':
      el.innerHTML = drillPCIe(m);
      break;
    case 'conntrack':
      el.innerHTML = drillConntrack(m);
      break;
    case 'nfs':
      el.innerHTML = drillNFS(m);
      break;
    default:
      el.innerHTML = renderWidget({type: drilldownType, label: ''}, m, sp);
  }
  perfEnd('drilldown_' + drilldownType, t0);
}

// --- Drilldown Renderers (with gauges/meters) ---
function drillCard(title, content) {
  return `<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:16px;margin-bottom:12px">
    <h4 style="font-size:12px;color:var(--text-dim);text-transform:uppercase;letter-spacing:0.8px;margin-bottom:10px">${title}</h4>
    ${content}
  </div>`;
}

function drillCPU(m, sp) {
  const cpus = m.cpu;
  if (!cpus || cpus.length === 0) return '<div class="empty-state">No CPU data</div>';
  const total = cpus[0];
  const spark = sp.cpu || [];

  // Summary: big gauge + sparkline
  let summary = `<div style="display:flex;align-items:center;gap:24px">
    ${gaugeSVG(total.total, 100, 'var(--cpu)', 120, null, '%')}
    <div style="flex:1">
      ${sparklineSVG(spark, 'var(--cpu)', 300, 60)}
      <div style="margin-top:12px">
        ${stackedBarHTML([
          {pct: total.user, color: 'var(--cpu)'},
          {pct: total.system, color: 'rgba(34,211,167,0.5)'},
          {pct: total.iowait, color: 'var(--disk)'},
          {pct: total.irq, color: 'var(--mem)'},
          {pct: total.steal, color: 'var(--temp)'},
        ])}
      </div>
      <div style="display:flex;gap:20px;margin-top:8px;font-size:12px">
        <span style="color:var(--cpu)">user ${total.user.toFixed(1)}%</span>
        <span style="color:rgba(34,211,167,0.6)">system ${total.system.toFixed(1)}%</span>
        <span style="color:var(--disk)">iowait ${total.iowait.toFixed(1)}%</span>
        <span style="color:var(--mem)">irq ${total.irq.toFixed(1)}%</span>
        <span style="color:var(--temp)">steal ${total.steal.toFixed(1)}%</span>
        <span style="color:var(--text-dim)">idle ${total.idle.toFixed(1)}%</span>
      </div>
    </div>
  </div>`;

  // Per-core: gauge grid
  let cores = '<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">';
  for (let i = 1; i < cpus.length; i++) {
    const c = cpus[i];
    cores += `<div style="text-align:center">
      ${gaugeSVG(c.total, 100, pctColor(c.total, 'var(--cpu)'), 64, c.label, '%')}
    </div>`;
  }
  cores += '</div>';

  return drillCard('CPU Overview', summary) + drillCard(`Per-Core (${cpus.length - 1} cores)`, cores);
}

function drillMemory(m, sp) {
  const mem = m.memory;
  if (!mem) return '';
  const swap = m.swap;
  const spark = sp.memory || [];

  let summary = `<div style="display:flex;align-items:center;gap:24px">
    ${gaugeSVG(mem.used_pct, 100, 'var(--mem)', 120, null, '%')}
    <div style="flex:1">
      ${sparklineSVG(spark, 'var(--mem)', 300, 60)}
      <div style="margin-top:16px;display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
        <div><div style="font-size:10px;color:var(--text-dim)">Total</div><div style="font-size:18px;font-weight:700">${fmtKB(mem.total_kb)}</div></div>
        <div><div style="font-size:10px;color:var(--text-dim)">Used</div><div style="font-size:18px;font-weight:700;color:var(--mem)">${fmtKB(mem.used_kb)}</div></div>
        <div><div style="font-size:10px;color:var(--text-dim)">Buffers</div><div style="font-size:18px;font-weight:700">${fmtKB(mem.buffers_kb)}</div></div>
        <div><div style="font-size:10px;color:var(--text-dim)">Cached</div><div style="font-size:18px;font-weight:700">${fmtKB(mem.cached_kb)}</div></div>
      </div>
      <div style="margin-top:12px">
        ${stackedBarHTML([
          {pct: mem.used_pct, color: 'var(--mem)'},
          {pct: mem.buffers_pct, color: 'rgba(167,139,250,0.4)'},
          {pct: mem.cached_pct, color: 'rgba(167,139,250,0.2)'},
        ])}
      </div>
    </div>
  </div>`;

  if (mem.bw_gbs > 0) {
    summary += `<div style="margin-top:12px;font-size:12px">
      Memory Bandwidth: <span style="font-weight:700">${mem.bw_gbs.toFixed(2)} GB/s</span>
      ${mem.bw_read_gbs > 0 ? ` (R: ${mem.bw_read_gbs.toFixed(2)} / W: ${mem.bw_write_gbs.toFixed(2)})` : ''}
    </div>`;
  }

  let swapHtml = '<div class="empty-state">No swap</div>';
  if (swap && swap.total_kb > 0) {
    swapHtml = `<div style="display:flex;align-items:center;gap:24px">
      ${gaugeSVG(swap.used_pct, 100, 'var(--swap)', 90, null, '%')}
      <div>
        <div style="font-size:12px;margin-bottom:4px">${fmtKB(swap.used_kb)} / ${fmtKB(swap.total_kb)}</div>
        ${barHTML(swap.used_pct, 'var(--swap)')}
      </div>
    </div>`;
  }

  return drillCard('Memory Overview', summary) + drillCard('Swap', swapHtml);
}

function drillGPU(m) {
  const gpus = m.gpu;
  if (!gpus || gpus.length === 0) return '<div class="empty-state">No GPU</div>';
  const pcieDevs = m.pcie || [];
  let html = '';
  for (const g of gpus) {
    const isApple = g.metal !== undefined && g.metal !== '';

    if (isApple) {
      html += drillCard(`${g.name}`, `
        <div style="font-size:11px;color:var(--text-dim);text-align:center;margin-bottom:12px">${g.metal} · ${g.cores} cores</div>
        <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-bottom:16px">
          ${gaugeSVG(g.util, 100, 'var(--gpu)', 100, 'GPU', '%')}
          ${gaugeSVG(g.renderer || 0, 100, 'var(--cpu)', 100, 'Renderer', '%')}
          ${gaugeSVG(g.tiler || 0, 100, 'var(--disk)', 100, 'Tiler', '%')}
          ${gaugeSVG(g.mem_pct, 100, 'var(--mem)', 100, 'Memory', '%')}
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:8px;font-size:11px;color:var(--text-dim)">
          <span>Mem: ${g.mem_used} / ${g.mem_total} MiB</span>
        </div>
      `);
    } else {
      const tempColor = g.temp >= 80 ? 'var(--temp)' : g.temp >= 60 ? 'var(--disk)' : 'var(--cpu)';
      const pcie = pcieDevs.find(p => p.type === 'display' || (p.name && p.name.toLowerCase().includes('nvidia')));
      const pcieIdx = pcieDevs.filter(p => p.type === 'display' || (p.name && p.name.toLowerCase().includes('nvidia')));
      const gpuPcie = pcieIdx[g.index] || pcie || null;
      let pcieHtml = '';
      if (gpuPcie) {
        const maxBw = gpuPcie.max_bw_bps || 1;
        const utilPct = ((gpuPcie.io_read_bps + gpuPcie.io_write_bps) / maxBw * 100).toFixed(2);
        const gpuPeakBps = Math.max(gpuPcie.io_read_bps, gpuPcie.io_write_bps, 1);
        const gpuAutoMax = niceScale(gpuPeakBps);
        const rxPct = Math.min(gpuPcie.io_read_bps / gpuAutoMax * 100, 100);
        const txPct = Math.min(gpuPcie.io_write_bps / gpuAutoMax * 100, 100);
        pcieHtml = `
          <div style="margin-top:16px;padding-top:12px;border-top:1px solid rgba(255,255,255,0.06)">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span style="font-size:11px;font-weight:600;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}</span>
              <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.05);color:var(--text-dim)">${fmtBytes(maxBw)}/s max · util: ${utilPct}%</span>
              <span style="font-size:8px;color:var(--text-dim)">scale: ${fmtBytes(gpuAutoMax)}/s</span>
            </div>
            <div style="display:flex;gap:10px;justify-content:center">
              ${gaugeSVG(txPct, 100, 'var(--disk)', 72, 'TX', '%')}
              ${gaugeSVG(rxPct, 100, 'var(--net)', 72, 'RX', '%')}
            </div>
            <div style="display:flex;gap:16px;justify-content:center;margin-top:4px;font-size:10px">
              <span style="color:var(--disk)">TX ${fmtBps(gpuPcie.io_write_bps)}</span>
              <span style="color:var(--net)">RX ${fmtBps(gpuPcie.io_read_bps)}</span>
            </div>
          </div>`;
      }
      html += drillCard(`GPU ${g.index}: ${g.name}`, `
        <div style="display:flex;flex-wrap:wrap;gap:16px;justify-content:center;margin-bottom:16px">
          ${gaugeSVG(g.util, 100, 'var(--gpu)', 100, 'Utilization', '%')}
          ${gaugeSVG(g.mem_pct, 100, 'var(--mem)', 100, 'VRAM', '%')}
          ${gaugeSVG(g.temp, 110, tempColor, 100, 'Temperature', '°C')}
          ${g.temp_mem_junction > 0 ? gaugeSVG(g.temp_mem_junction, 110, g.temp_mem_junction >= 95 ? 'var(--temp)' : g.temp_mem_junction >= 80 ? 'var(--disk)' : 'var(--cpu)', 100, 'Mem Junction', '°C') : ''}
          ${meterSVG(g.power, g.power_limit || 350, 'var(--disk)', 110, 'Power', 'W')}
        </div>
        <div style="display:flex;gap:8px;justify-content:center;margin-top:8px;font-size:11px;color:var(--text-dim)">
          <span>VRAM: ${g.mem_used}/${g.mem_total} MiB</span>
          <span>|</span>
          <span>Power: ${g.power}W / ${g.power_limit}W</span>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:12px;justify-content:center;margin-top:16px">
          ${g.fan > 0 ? gaugeSVG(g.fan, 100, 'var(--net)', 72, 'Fan', '%') : ''}
          ${g.enc > 0 ? gaugeSVG(g.enc, 100, 'var(--kern)', 72, 'Encoder', '%') : ''}
          ${g.dec > 0 ? gaugeSVG(g.dec, 100, 'var(--kern)', 72, 'Decoder', '%') : ''}
        </div>
        ${pcieHtml}
      `);
    }
  }
  return html;
}

function drillDisk(m) {
  const disks = m.disk;
  if (!disks) return '';
  // Autoscale across all disks
  let peakBps = 1;
  for (const d of disks) { const mx = d.read_bps > d.write_bps ? d.read_bps : d.write_bps; if (mx > peakBps) peakBps = mx; }
  const autoMax = niceScale(peakBps);
  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px">`;
  for (const d of disks) {
    html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px">
      <div style="font-size:10px;font-weight:600;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d.name}">${d.name}</div>
      ${d.raid_level ? `<div style="font-size:8px;color:var(--text-dim);margin-bottom:4px">${d.raid_level}</div>` : ''}
      <div style="display:flex;gap:6px;justify-content:center">
        ${gaugeSVG(d.read_bps / autoMax * 100, 100, 'var(--net)', 52, 'R', '%')}
        ${gaugeSVG(d.write_bps / autoMax * 100, 100, 'var(--disk)', 52, 'W', '%')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:3px">
        <span style="color:var(--net)">${fmtBps(d.read_bps)}</span>
        <span style="color:var(--disk)">${fmtBps(d.write_bps)}</span>
      </div>
      <div style="font-size:8px;color:var(--text-dim);text-align:center;margin-top:2px">${d.read_iops + d.write_iops > 0 ? (d.read_iops + '/' + d.write_iops + ' IOPS') : ''}</div>
    </div>`;
  }
  html += '</div>';
  return drillCard(`Disk I/O (${disks.length}) — scale: ${fmtBytes(autoMax)}/s`, html);
}

function drillNetwork(m) {
  const nets = m.network;
  if (!nets) return '';
  // Autoscale across all interfaces
  let peakBps = 1;
  for (const n of nets) { const mx = n.rx_bps > n.tx_bps ? n.rx_bps : n.tx_bps; if (mx > peakBps) peakBps = mx; }
  const autoMax = niceScale(peakBps);
  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px">`;
  for (const n of nets) {
    html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:8px 10px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
        <span style="font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:100px">${n.name}</span>
        <span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(255,255,255,0.06);color:var(--text-dim)">${n.type}</span>
      </div>
      <div style="display:flex;gap:6px;justify-content:center">
        ${gaugeSVG(n.tx_bps / autoMax * 100, 100, 'var(--disk)', 56, 'TX', '%')}
        ${gaugeSVG(n.rx_bps / autoMax * 100, 100, 'var(--net)', 56, 'RX', '%')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:4px">
        <span style="color:var(--disk)">TX ${fmtBps(n.tx_bps)}</span>
        <span style="color:var(--net)">RX ${fmtBps(n.rx_bps)}</span>
      </div>
    </div>`;
  }
  html += '</div>';
  return drillCard('Network Interface Detail', html);
}

function drillTemp(m) {
  const temps = m.temperature;
  if (!temps) return '';
  // Compact: all devices in a single grid, 1 page
  let sensorsHtml = '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(60px,1fr));gap:6px;justify-items:center">';
  let fansHtml = '';
  let fanCount = 0;
  for (const dev of temps) {
    for (const s of dev.sensors) {
      const critMax = s.crit > 0 ? s.crit : 110;
      const clr = s.temp >= 80 ? 'var(--temp)' : s.temp >= 55 ? 'var(--disk)' : 'var(--cpu)';
      const shortLabel = s.label.length > 8 ? s.label.slice(0, 8) : s.label;
      sensorsHtml += `<div style="text-align:center">
        ${gaugeSVG(s.temp, critMax, clr, 56, '', '°C')}
        <div style="font-size:9px;color:var(--text);font-weight:500;margin-top:-2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:64px" title="${dev.category}: ${s.label}">${shortLabel}</div>
      </div>`;
    }
    if (dev.fans && dev.fans.length > 0) {
      for (const f of dev.fans) {
        fansHtml += meterSVG(f.rpm, 5000, 'var(--net)', 72, f.label, 'RPM');
        fanCount++;
      }
    }
  }
  sensorsHtml += '</div>';
  let html = drillCard(`Temperature (${temps.length} devices)`, sensorsHtml);
  if (fanCount > 0) {
    html += drillCard(`Fans (${fanCount})`, `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center">${fansHtml}</div>`);
  }
  return html;
}

function drillProcess(m) {
  const procs = m.process;
  if (!procs) return '';
  let html = '<table class="metric-table" style="font-size:12px"><thead><tr><th>PID</th><th>Name</th><th class="num">CPU%</th><th></th><th class="num">Memory</th><th>State</th></tr></thead><tbody>';
  for (const p of procs) {
    const cpuColor = p.cpu >= 50 ? 'var(--temp)' : p.cpu >= 20 ? 'var(--disk)' : 'var(--text)';
    html += `<tr>
      <td style="color:var(--text-dim)">${p.pid}</td>
      <td style="font-weight:500">${p.name}</td>
      <td class="num" style="color:${cpuColor};font-weight:700">${p.cpu.toFixed(1)}%</td>
      <td style="width:100px">${barHTML(Math.min(p.cpu, 100), cpuColor, true)}</td>
      <td class="num">${p.mem_mb.toFixed(1)} MB</td>
      <td style="color:var(--text-dim)">${p.state || '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return drillCard(`Processes (${procs.length})`, html);
}

function drillPCIe(m) {
  const devices = m.pcie;
  if (!devices || devices.length === 0) return '<div class="empty-state">No PCIe data</div>';
  // Autoscale: find peak I/O across all devices for relative comparison
  let peakBps = 0;
  for (const d of devices) {
    peakBps = Math.max(peakBps, d.io_read_bps, d.io_write_bps);
  }
  // Round up to a nice scale (next power of 2 × 1024 boundary)
  const autoMax = niceScale(peakBps);

  let html = '<div style="display:flex;flex-wrap:wrap;gap:12px">';
  for (const d of devices) {
    const maxBw = d.max_bw_bps || 1;
    const linkDegraded = d.gen !== d.max_gen || d.width < d.max_width;
    // Autoscaled percentages for detail view
    const rAuto = Math.min(d.io_read_bps / autoMax * 100, 100);
    const wAuto = Math.min(d.io_write_bps / autoMax * 100, 100);
    // Theoretical utilization (tiny badge)
    const utilPct = ((d.io_read_bps + d.io_write_bps) / maxBw * 100).toFixed(2);
    html += `<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;min-width:220px;flex:1;max-width:320px;border:1px solid ${linkDegraded ? 'rgba(251,146,60,0.2)' : 'rgba(255,255,255,0.04)'}">
      <div style="font-size:12px;font-weight:600;margin-bottom:4px;color:var(--text-bright)">${d.name}</div>
      <div style="font-size:10px;color:var(--text-dim);margin-bottom:8px">${d.address} | ${d.type || ''}</div>
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:10px;flex-wrap:wrap">
        <span style="font-size:11px;padding:2px 8px;border-radius:4px;background:${linkDegraded ? 'rgba(251,146,60,0.12)' : 'rgba(34,211,167,0.1)'};color:${linkDegraded ? 'var(--disk)' : 'var(--cpu)'}">${d.gen} x${d.width}</span>
        <span style="font-size:9px;color:var(--text-dim)">${fmtBytes(maxBw)}/s max</span>
        <span style="font-size:9px;padding:1px 6px;border-radius:3px;background:rgba(255,255,255,0.05);color:var(--text-dim)">util: ${utilPct}%</span>
        ${linkDegraded ? `<span style="font-size:9px;color:var(--text-dim)">cap: ${d.max_gen} x${d.max_width}</span>` : ''}
      </div>
      <div style="margin-bottom:6px">
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px">
          <span style="color:var(--net)">Read</span><span style="color:var(--text-dim)">scale: ${fmtBytes(autoMax)}/s</span>
        </div>
        ${hMeterHTML(d.io_read_bps, autoMax, 'var(--net)', fmtBps(d.io_read_bps))}
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px">
          <span style="color:var(--disk)">Write</span><span style="color:var(--text-dim)"></span>
        </div>
        ${hMeterHTML(d.io_write_bps, autoMax, 'var(--disk)', fmtBps(d.io_write_bps))}
      </div>
    </div>`;
  }
  html += '</div>';
  return drillCard(`PCIe Devices (${devices.length}) — autoscale: ${fmtBytes(autoMax)}/s`, html);
}

function drillConntrack(m) {
  const conns = m.conntrack;
  if (!conns || conns.length === 0) return '<div class="empty-state">No connection data</div>';
  let maxBps = 1;
  for (const c of conns) { const m = c.tx_bps > c.rx_bps ? c.tx_bps : c.rx_bps; if (m > maxBps) maxBps = m; }
  let html = '<div style="display:flex;flex-wrap:wrap;gap:12px">';
  for (const c of conns) {
    html += `<div style="background:rgba(255,255,255,0.03);border-radius:10px;padding:12px 14px;min-width:180px;flex:1;max-width:280px">
      <div style="font-size:12px;font-weight:600;margin-bottom:6px;color:var(--text-bright)">${c.ip}</div>
      <div style="display:flex;gap:8px;justify-content:center;margin-bottom:6px">
        ${gaugeSVG(c.tx_bps / maxBps * 100, 100, 'var(--disk)', 68, 'TX', '%')}
        ${gaugeSVG(c.rx_bps / maxBps * 100, 100, 'var(--net)', 68, 'RX', '%')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:10px">
        <span style="color:var(--disk)">${fmtBps(c.tx_bps)}</span>
        <span style="color:var(--net)">${fmtBps(c.rx_bps)}</span>
      </div>
      <div style="text-align:center;margin-top:4px;font-size:10px;color:var(--text-dim)">${c.conns} connections</div>
    </div>`;
  }
  html += '</div>';
  return drillCard(`Remote Connections (${conns.length})`, html);
}

function drillNFS(m) {
  const mounts = m.nfs;
  if (!mounts || mounts.length === 0) return '<div class="empty-state">No NAS mounts</div>';
  let peakBps = 1;
  for (const n of mounts) { const mx = n.read_bps > n.write_bps ? n.read_bps : n.write_bps; if (mx > peakBps) peakBps = mx; }
  const autoMax = niceScale(peakBps);
  let html = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">`;
  for (const n of mounts) {
    html += `<div style="background:rgba(255,255,255,0.03);border-radius:8px;padding:10px 12px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
        <span style="font-size:10px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:120px" title="${n.device}">${n.mount}</span>
        <span style="font-size:8px;padding:1px 4px;border-radius:3px;background:rgba(255,255,255,0.06);color:var(--text-dim)">${n.type}</span>
      </div>
      <div style="font-size:8px;color:var(--text-dim);margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${n.device}">${n.device}</div>
      <div style="display:flex;gap:6px;justify-content:center">
        ${gaugeSVG(n.write_bps / autoMax * 100, 100, 'var(--disk)', 56, 'W', '%')}
        ${gaugeSVG(n.read_bps / autoMax * 100, 100, 'var(--net)', 56, 'R', '%')}
      </div>
      <div style="display:flex;justify-content:space-between;font-size:9px;margin-top:4px">
        <span style="color:var(--disk)">W ${fmtBps(n.write_bps)}</span>
        <span style="color:var(--net)">R ${fmtBps(n.read_bps)}</span>
      </div>
    </div>`;
  }
  html += '</div>';
  return drillCard(`NAS Mounts (${mounts.length}) — scale: ${fmtBytes(autoMax)}/s`, html);
}

// --- Toast ---
function showToast(msg, type) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = type || 'success';
  el.classList.add('show');
  setTimeout(() => el.classList.remove('show'), 2500);
}

// --- Keyboard ---
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && drilldownOpen) {
    closeDrilldown();
  }
  if (e.key === 'e' && e.ctrlKey) {
    e.preventDefault();
    toggleEditMode();
  }
  // Ctrl+P to toggle JS profiling
  if (e.key === 'p' && e.ctrlKey && e.shiftKey) {
    e.preventDefault();
    perfProfile.enabled = !perfProfile.enabled;
    console.log('[perfmon] JS profiling ' + (perfProfile.enabled ? 'ON' : 'OFF'));
    showToast('JS Profile: ' + (perfProfile.enabled ? 'ON' : 'OFF'), 'success');
  }
});
