/* PerfMon Component: nfs */
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
