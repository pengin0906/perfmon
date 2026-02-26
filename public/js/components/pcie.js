/* PerfMon Component: pcie */
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
