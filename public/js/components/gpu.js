/* PerfMon Component: gpu */
registerWidget('gpu', (w, m) => {
  const gpus = m.gpu;
  if (!gpus || gpus.length === 0) return '<div class="empty-state">No GPU detected</div>';
  let html = '';
  for (const g of gpus) {
    const gkey = 'gpu' + g.index;
    const mode = getVizMode(gkey);
    const isApple = g.metal !== undefined && g.metal !== '';

    // Match PCIe device for this GPU (NVIDIA only)
    const pcieDevs = m.pcie || [];
    const pcieDisplays = pcieDevs.filter(p => p.type === 'display' || (p.name && p.name.toLowerCase().includes('nvidia')));
    const gpuPcie = isApple ? null : (pcieDisplays[g.index] || pcieDisplays[0] || null);
    let pcieAutoMax = 1048576, rxPct = 0, txPct = 0;
    if (gpuPcie) {
      const peakBps = Math.max(gpuPcie.io_read_bps, gpuPcie.io_write_bps, 1);
      pcieAutoMax = niceScale(peakBps);
      rxPct = Math.min(gpuPcie.io_read_bps / pcieAutoMax * 100, 100);
      txPct = Math.min(gpuPcie.io_write_bps / pcieAutoMax * 100, 100);
    }

    const gpuLabel = isApple ? g.name : `GPU${g.index}: ${g.name}`;
    const metalInfo = isApple ? `<span style="font-size:10px;color:var(--text-dim);margin-left:6px">${g.metal} · ${g.cores} cores</span>` : '';

    if (mode === 'gauge') {
      if (isApple) {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}${metalInfo}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gauge-grid" style="justify-content:center">
            ${gaugeSVG(g.util, 100, 'var(--gpu)', 68, 'GPU', '%')}
            ${gaugeSVG(g.renderer || 0, 100, 'var(--cpu)', 68, 'Render', '%')}
            ${gaugeSVG(g.tiler || 0, 100, 'var(--disk)', 68, 'Tiler', '%')}
            ${gaugeSVG(g.mem_pct, 100, 'var(--mem)', 68, 'Mem', '%')}
          </div>
          <div style="font-size:10px;color:var(--text-dim);text-align:center;margin-top:2px">Mem: ${g.mem_used}MiB / ${g.mem_total}MiB</div>
        </div>`;
      } else {
        const powerPct = g.power_limit > 0 ? (g.power / g.power_limit * 100) : 0;
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gauge-grid" style="justify-content:center">
            ${gaugeSVG(g.util, 100, 'var(--gpu)', 68, 'Util', '%')}
            ${gaugeSVG(g.mem_pct, 100, 'var(--mem)', 68, 'VRAM', '%')}
            ${gaugeSVG(g.temp, 110, g.temp >= 80 ? 'var(--temp)' : g.temp >= 60 ? 'var(--disk)' : 'var(--cpu)', 68, 'Temp', '°C')}
            ${gaugeSVG(g.power, g.power_limit || 350, null, 68, 'Power', 'W')}
            ${g.fan > 0 ? gaugeSVG(g.fan, 100, 'var(--net)', 56, 'Fan', '%') : ''}
            ${g.enc > 0 ? gaugeSVG(g.enc, 100, 'var(--kern)', 56, 'Enc', '%') : ''}
            ${g.dec > 0 ? gaugeSVG(g.dec, 100, 'var(--kern)', 56, 'Dec', '%') : ''}
            ${gpuPcie ? gaugeSVG(txPct, 100, 'var(--disk)', 56, 'TX', '%') : ''}
            ${gpuPcie ? gaugeSVG(rxPct, 100, 'var(--net)', 56, 'RX', '%') : ''}
          </div>
          ${gpuPcie ? `<div style="font-size:9px;color:var(--text-dim);text-align:center;margin-top:2px">PCIe ${gpuPcie.gen} x${gpuPcie.width} · TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
        </div>`;
      }
    } else if (mode === 'meter') {
      if (isApple) {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}${metalInfo}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gauge-grid" style="justify-content:center">
            ${meterSVG(g.util, 100, 'var(--gpu)', 80, 'GPU', '%')}
            ${meterSVG(g.renderer || 0, 100, 'var(--cpu)', 80, 'Render', '%')}
            ${meterSVG(g.tiler || 0, 100, 'var(--disk)', 80, 'Tiler', '%')}
            ${meterSVG(g.mem_pct, 100, 'var(--mem)', 80, 'Mem', '%')}
          </div>
        </div>`;
      } else {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gauge-grid" style="justify-content:center">
            ${meterSVG(g.util, 100, 'var(--gpu)', 80, 'Util', '%')}
            ${meterSVG(g.mem_pct, 100, 'var(--mem)', 80, 'VRAM', '%')}
            ${meterSVG(g.temp, 110, g.temp >= 80 ? 'var(--temp)' : g.temp >= 60 ? 'var(--disk)' : 'var(--cpu)', 80, 'Temp', '°C')}
            ${meterSVG(g.power, g.power_limit || 350, null, 80, 'Power', 'W')}
          </div>
          ${g.fan > 0 ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">Fan: ${g.fan}%  |  Enc: ${g.enc}%  Dec: ${g.dec}%</div>` : ''}
          ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
        </div>`;
      }
    } else if (mode === 'numeric') {
      if (isApple) {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}${metalInfo}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;text-align:center">
            ${numericHTML(g.util, '%', 'var(--gpu)', 'GPU')}
            ${numericHTML(g.renderer || 0, '%', 'var(--cpu)', 'Render')}
            ${numericHTML(g.tiler || 0, '%', 'var(--disk)', 'Tiler')}
            ${numericHTML(g.mem_pct, '%', 'var(--mem)', 'Mem')}
          </div>
        </div>`;
      } else {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(80px,1fr));gap:8px;text-align:center">
            ${numericHTML(g.util, '%', 'var(--gpu)', 'Util')}
            ${numericHTML(g.mem_pct, '%', 'var(--mem)', 'VRAM')}
            ${numericHTML(g.temp, '°C', g.temp >= 80 ? 'var(--temp)' : 'var(--cpu)', 'Temp')}
            ${numericHTML(g.power, 'W', null, 'Power')}
            ${g.fan > 0 ? numericHTML(g.fan, '%', 'var(--net)', 'Fan') : ''}
          </div>
          ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
        </div>`;
      }
    } else {
      // Bar mode (default)
      if (isApple) {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}${metalInfo}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gpu-stats">
            <div class="gpu-stat">
              <span class="gpu-stat-label">GPU</span>
              <span class="gpu-stat-val c-gpu">${g.util.toFixed(0)}%</span>
              ${barHTML(g.util, 'var(--gpu)', true)}
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">Renderer</span>
              <span class="gpu-stat-val c-cpu">${(g.renderer || 0).toFixed(0)}%</span>
              ${barHTML(g.renderer || 0, 'var(--cpu)', true)}
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">Tiler</span>
              <span class="gpu-stat-val c-disk">${(g.tiler || 0).toFixed(0)}%</span>
              ${barHTML(g.tiler || 0, 'var(--disk)', true)}
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">Mem</span>
              <span class="gpu-stat-val c-mem">${g.mem_pct.toFixed(0)}%</span>
              ${barHTML(g.mem_pct, 'var(--mem)', true)}
            </div>
          </div>
          <div style="margin-top:4px;font-size:10px;color:var(--text-dim)">${g.mem_used}MiB / ${g.mem_total}MiB</div>
        </div>`;
      } else {
        html += `<div class="gpu-card">
          <div class="gpu-name">${gpuLabel}
            <span class="viz-mode-hint" onclick="cycleVizMode('${gkey}')">&#8635; ${mode}</span>
          </div>
          <div class="gpu-stats">
            <div class="gpu-stat">
              <span class="gpu-stat-label">Util</span>
              <span class="gpu-stat-val c-gpu">${g.util.toFixed(0)}%</span>
              ${barHTML(g.util, 'var(--gpu)', true)}
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">VRAM</span>
              <span class="gpu-stat-val c-mem">${g.mem_pct.toFixed(0)}%</span>
              ${barHTML(g.mem_pct, 'var(--mem)', true)}
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">Temp</span>
              <span class="gpu-stat-val ${g.temp >= 80 ? 'c-temp' : g.temp >= 60 ? 'c-disk' : 'c-cpu'}">${g.temp}&deg;C</span>
            </div>
            <div class="gpu-stat">
              <span class="gpu-stat-label">Power</span>
              <span class="gpu-stat-val">${g.power}W<span style="color:var(--text-dim);font-size:11px">/${g.power_limit}W</span></span>
            </div>
          </div>
          ${g.fan > 0 ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">Fan: ${g.fan}%  |  Enc: ${g.enc}%  Dec: ${g.dec}%</div>` : ''}
          ${gpuPcie ? `<div style="margin-top:4px;font-size:10px;color:var(--text-dim)">PCIe ${gpuPcie.gen} x${gpuPcie.width}: TX ${fmtBps(gpuPcie.io_write_bps)} / RX ${fmtBps(gpuPcie.io_read_bps)}</div>` : ''}
        </div>`;
      }
    }
  }
  return html;
});
