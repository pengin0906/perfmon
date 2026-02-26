/* PerfMon Component: swap */
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
