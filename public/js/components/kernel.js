/* PerfMon Component: Kernel / System Info */
registerWidget('kernel', (w, m) => {
  const k = m.kernel;
  if (!k) return '<div class="empty-state">Waiting for data...</div>';
  const loadColor = k.load_1 / k.cpus > 1 ? 'var(--temp)' : k.load_1 / k.cpus > 0.7 ? 'var(--disk)' : 'var(--cpu)';
  return `<div class="kernel-bar">
    <div class="kernel-item"><span class="k-label">Kernel</span><span class="k-value c-kern">${k.version}</span></div>
    <div class="kernel-item"><span class="k-label">Uptime</span><span class="k-value">${k.uptime}</span></div>
    <div class="kernel-item"><span class="k-label">Load</span><span class="k-value" style="color:${loadColor}">${k.load_1} ${k.load_5} ${k.load_15}</span></div>
    <div class="kernel-item"><span class="k-label">CPUs</span><span class="k-value">${k.cpus}</span></div>
    <div class="kernel-item"><span class="k-label">Procs</span><span class="k-value">${k.running}/${k.total}</span></div>
    <div class="kernel-item"><span class="k-label">Ctx/s</span><span class="k-value">${fmtNum(k.ctx_sec)}</span></div>
    <div class="kernel-item"><span class="k-label">IRQ/s</span><span class="k-value">${fmtNum(k.intr_sec)}</span></div>
  </div>`;
});
