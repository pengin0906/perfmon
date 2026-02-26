/* PerfMon Component: cpu_summary, cpu_cores */
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
