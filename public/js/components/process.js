/* PerfMon Component: process */
registerWidget('process', (w, m) => {
  const procs = m.process;
  if (!procs || procs.length === 0) return '<div class="empty-state">No processes</div>';
  let html = '<table class="metric-table"><thead><tr><th>PID</th><th>Name</th><th class="num">CPU%</th><th class="num">MEM</th><th>S</th></tr></thead><tbody>';
  for (const p of procs) {
    const cpuColor = p.cpu >= 50 ? 'var(--temp)' : p.cpu >= 20 ? 'var(--disk)' : 'var(--text)';
    html += `<tr>
      <td style="color:var(--text-dim)">${p.pid}</td>
      <td class="name-cell">${p.name}</td>
      <td class="num" style="color:${cpuColor};font-weight:600">${p.cpu.toFixed(1)}</td>
      <td class="num">${p.mem_mb.toFixed(0)} MB</td>
      <td style="color:var(--text-dim)">${p.state || '-'}</td>
    </tr>`;
  }
  html += '</tbody></table>';
  return html;
});
