/* PerfMon Component: memory */
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
