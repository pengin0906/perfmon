/* PerfMon Component: temperature */
registerWidget('temperature', (w, m) => {
  const temps = m.temperature;
  if (!temps || temps.length === 0) return '<div class="empty-state">No sensors</div>';
  const mode = getVizMode('temperature');

  let html = `<div class="viz-mode-hint" onclick="cycleVizMode('temperature')">&#8635; ${mode}</div>`;

  // Flatten all sensors and fans across devices into single grids
  if (mode === 'gauge' || mode === 'meter') {
    html += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(52px,1fr));gap:4px;justify-items:center">';
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const critMax = s.crit > 0 ? s.crit : 110;
        const clr = s.temp >= 80 ? 'var(--temp)' : s.temp >= 55 ? 'var(--disk)' : 'var(--cpu)';
        const shortLabel = s.label.length > 6 ? s.label.slice(0, 6) : s.label;
        html += mode === 'gauge'
          ? gaugeSVG(s.temp, critMax, clr, 48, shortLabel, '°C')
          : meterSVG(s.temp, critMax, clr, 62, shortLabel, '°C');
      }
      for (const f of dev.fans) {
        html += mode === 'gauge'
          ? gaugeSVG(f.rpm, 5000, 'var(--net)', 48, f.label, 'RPM')
          : meterSVG(f.rpm, 5000, 'var(--net)', 62, f.label, 'RPM');
      }
    }
    html += '</div>';
  } else if (mode === 'numeric') {
    html += '<div class="numeric-grid" style="grid-template-columns:repeat(auto-fill,minmax(70px,1fr))">';
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const clr = s.temp >= 80 ? 'var(--temp)' : s.temp >= 55 ? 'var(--disk)' : 'var(--cpu)';
        html += `<div class="numeric-cell">
          <span class="numeric-cell-label">${s.label}</span>
          <span class="numeric-cell-val" style="color:${clr}">${s.temp.toFixed(1)}°C</span>
        </div>`;
      }
      for (const f of dev.fans) {
        html += `<div class="numeric-cell">
          <span class="numeric-cell-label">${f.label}</span>
          <span class="numeric-cell-val" style="color:var(--net)">${f.rpm} RPM</span>
        </div>`;
      }
    }
    html += '</div>';
  } else {
    // bar mode
    for (const dev of temps) {
      for (const s of dev.sensors) {
        const cls = s.temp >= 80 ? 'hot' : s.temp >= 55 ? 'warm' : 'cool';
        const critInfo = s.crit > 0 ? ` / ${s.crit.toFixed(0)}&deg;` : '';
        html += `<div class="temp-row">
          <span style="font-size:11px">${s.label}</span>
          <span class="temp-val ${cls}">${s.temp.toFixed(1)}&deg;C${critInfo}</span>
        </div>`;
      }
      for (const f of dev.fans) {
        html += `<div class="fan-row"><span>${f.label}</span><span class="fan-rpm">${f.rpm} RPM</span></div>`;
      }
    }
  }
  return html;
});
