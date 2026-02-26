/* PerfMon Component: conntrack */
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
