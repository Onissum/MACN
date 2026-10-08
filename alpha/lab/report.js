export function median(values) {
  const s = [...values].sort((a, b) => a - b), i = Math.floor(s.length / 2);
  return s.length ? s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2 : null;
}
export function summarize(runs) {
  const groups = new Map();
  for (const run of runs) {
    const key = [run.nodes, run.scenario].join('/');
    if (!groups.has(key)) groups.set(key, { nodes: run.nodes, scenario: run.scenario, values: {} });
    const values = groups.get(key).values;
    (values[run.policy] ||= []).push(run);
  }
  return [...groups.values()].map(group => {
    const ms = Object.fromEntries(Object.entries(group.values).map(([policy, runs]) => [policy, median(runs.map(r => r.elapsedMs ?? r.modelledMs))]));
    return { nodes: group.nodes, scenario: group.scenario, medianMs: ms,
      // Paired ratios, never a ratio of unrelated medians.
      adaptiveVsEqual: median((group.values.adaptive || []).map(a => {
        const e = group.values.equal?.find(e => e.repeat === a.repeat);
        return e ? (e.elapsedMs ?? e.modelledMs) / (a.elapsedMs ?? a.modelledMs) : NaN;
      }).filter(Number.isFinite)),
      verified: Object.values(group.values).flat().every(run => run.verified) };
  });
}
export function markdown(report) {
  if (report.mode === 'compare') {
    const lines = ['# MACN compute comparison', '',
      'Same seeded Monte Carlo workload: direct sequential kernel versus MACN coordinator with one or more real worker threads over loopback WebSockets. All processes run on ONE host.', '',
      `Samples per run: **${report.config.samples || 50_000_000}**. Repeats: **${report.config.repeats || 3}**.`, '',
      '| MACN workers | Repeats | Median setup ms | Median job ms | Throughput samples/s | Paired job speedup | End-to-end speedup* | Parallel efficiency | Verified |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
    const fmt = n => Number.isFinite(n) ? n.toFixed(2) : '—';
    for (const row of report.summary || []) lines.push(`| ${row.nodes} | ${row.repeats} | ${fmt(row.medianSetupMs)} | ${fmt(row.medianJobMs)} | ${fmt(row.medianThroughput)} | ${fmt(row.medianJobSpeedup)}× | ${fmt(row.medianEndToEndSpeedup)}× | ${fmt(row.medianEfficiency)} | ${row.verified} |`);
    lines.push('', '*Job speedup compares paired job intervals and excludes setup. End-to-end speedup includes server/worker startup and registration in this lab; it does not model persistent physical peers.', '',
      '| Repeat | Topology | Workers | Seed | Setup ms | Job ms | Samples/s | Task RTT p50/p95/p99 ms | Retries | Verified |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---:|---|');
    for (const run of report.runs || []) {
      const rtt = run.taskRoundTripMs || {};
      lines.push(`| ${run.repeat} | ${run.topology} | ${run.nodes} | ${run.seed} | ${fmt(run.setupMs)} | ${fmt(run.elapsedMs)} | ${fmt(run.throughput)} | ${fmt(rtt.p50)} / ${fmt(rtt.p95)} / ${fmt(rtt.p99)} | ${run.retries ?? 0} | ${run.verified} |`);
    }
    lines.push('', report.comparison?.note || 'Local loopback only; no physical-device or GPU comparison.', '');
    return lines.join('\n');
  }
  if (report.mode === 'capacity') {
    const lines = ['# MACN coordinator capacity probe', '',
      'Real local Socket.IO/WebSocket connections to one coordinator. O(1) checksum tasks measure connection and control-plane capacity, not compute speed or GPU equivalence.', '',
      '| Nodes | Repeat | Connected | Connect ms | Job ms | Units/s | Tasks | Messages | Task RTT p50/p95/p99 ms | Loop p99 ms | CPU ms | RSS MiB | Verified |',
      '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|'];
    for (const r of report.runs) {
      const fmt = n => Number.isFinite(n) ? n.toFixed(2) : '—';
      lines.push(`| ${r.nodes} | ${r.repeat ?? '—'} | ${r.connected} | ${fmt(r.connectMs)} | ${fmt(r.elapsedMs)} | ${fmt(r.throughput)} | ${r.taskCount} | ${r.protocolMessages} | ${fmt(r.taskRoundTripMs.p50)} / ${fmt(r.taskRoundTripMs.p95)} / ${fmt(r.taskRoundTripMs.p99)} | ${fmt(r.eventLoopDelayMs.p99)} | ${fmt(r.processCpuMs)} | ${fmt(r.sampledPeakProcessRssBytes / 1048576)} | ${r.verified} |`);
    }
    lines.push('', 'All clients run on the same host as the coordinator. Loopback results do not predict WAN or physical-device limits. The normal demo connection cap remains unchanged.', '');
    return lines.join('\n');
  }
  const real = report.mode === 'real';
  const lines = ['# MACN alpha.2 laboratory report', '', `Mode: **${report.mode}**. Complete: **${report.complete}**.`, '',
    real ? 'Real Monte Carlo, local worker threads and loopback WebSockets on ONE host. Injected service delays; not heterogeneous physical devices.' :
      'Discrete-event simulation with modelled compute/network time and exact O(1) range checksums. NOT a physical cluster or a measured Monte Carlo speedup.', '',
    '| Nodes | Scenario | Equal median ms | Calibration median ms | Adaptive median ms | Paired equal/adaptive | Verified |',
    '|---|---|---:|---:|---:|---:|---|'];
  for (const row of summarize(report.runs)) {
    const fmt = n => Number.isFinite(n) ? n.toFixed(2) : '—';
    lines.push(`| ${row.nodes} | ${row.scenario} | ${fmt(row.medianMs.equal)} | ${fmt(row.medianMs.calibrated)} | ${fmt(row.medianMs.adaptive)} | ${fmt(row.adaptiveVsEqual)}× | ${row.verified} |`);
  }
  lines.push('', 'Ratios above 1 favour adaptive; below 1 favour equal. Includes all completed runs, including regressions. Policy order rotates by repeat. Raw JSON includes seed, timings, retries, correctness and resource metrics.', '');
  return lines.join('\n');
}
