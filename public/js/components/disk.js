/* PerfMon Component: disk */
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
