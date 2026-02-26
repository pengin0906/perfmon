/* PerfMon Component: network */
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
