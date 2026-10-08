import { summarize, markdown } from '/lab-report.js';
const $ = id => document.getElementById(id);
const format = n => Number.isFinite(n) ? n.toLocaleString('it-IT', { maximumFractionDigits: 2 }) : '—';
let current;
function table(headers, rows) {
  const result = document.createElement('table'), head = document.createElement('thead'), body = document.createElement('tbody');
  const tr = document.createElement('tr');
  for (const text of headers) { const th = document.createElement('th'); th.textContent = text; tr.append(th); }
  head.append(tr); result.append(head, body);
  for (const row of rows) {
    const tr = document.createElement('tr');
    for (const text of row) { const td = document.createElement('td'); td.textContent = text; tr.append(td); }
    body.append(tr);
  }
  return result;
}
$('report-file').onchange = async event => {
  try {
    const file = event.target.files[0]; if (!file) return;
    if (file.size > 20000000) throw Error('Report troppo grande (massimo 20 MB).');
    const report = JSON.parse(await file.text());
    if (!['real', 'simulated', 'multi', 'capacity'].includes(report.mode) || !Array.isArray(report.runs) || report.runs.length > 10000) throw Error('Formato report non riconosciuto.');
    if (['real', 'simulated'].includes(report.mode) && report.runs.some(r => !['equal', 'calibrated', 'adaptive'].includes(r.policy) || !Number.isFinite(r.nodes) || typeof r.scenario !== 'string')) throw Error('Righe del report non valide.');
    if (report.mode === 'capacity' && report.runs.some(r => !Number.isFinite(r.nodes) || !Number.isFinite(r.connected) || !Number.isFinite(r.elapsedMs))) throw Error('Righe del report non valide.');
    current = report;
    const real = report.mode === 'real', capacity = report.mode === 'capacity';
    $('report-kind').textContent = real ? 'Calcolo reale · nodi locali su un solo host' : capacity ? 'Connessioni reali · coordinatore su loopback' : report.mode === 'multi' ? 'Simulazione · richieste concorrenti' : 'Simulazione · coordinamento della rete';
    $('report-description').textContent = capacity ? 'WebSocket reali verso un coordinatore locale, con task di checksum quasi gratuiti: misura la capacità del control plane, non la potenza di calcolo.' : real ? 'Monte Carlo su thread distinti e connessioni WebSocket reali. Ritardi artificiali dichiarati: non è una prova con dispositivi fisici diversi.' : 'I tempi di completamento sono virtuali. Il workload verifica copertura e checksum; non misura la potenza di 1.000 computer.';
    $('report-meta').textContent = `${report.runs.length} prove · ${report.complete ? 'report completo' : 'report parziale'} · ${report.runs.every(r => r.verified) ? 'tutti i risultati verificati' : 'contiene risultati non verificati'}`;
    const rows = report.mode === 'multi' ? report.runs.flatMap(run => run.jobs.map(job => [run.nodes, job.owner, job.requestId, job.status, format(job.elapsedMs), format(job.units)])) : capacity ? report.runs.map(r => [r.nodes, r.repeat ?? '—', r.connected, format(r.connectMs), format(r.elapsedMs), format(r.throughput), r.taskCount, r.protocolMessages, `${format(r.taskRoundTripMs.p50)} / ${format(r.taskRoundTripMs.p95)} / ${format(r.taskRoundTripMs.p99)}`, format(r.eventLoopDelayMs.p99), format(r.processCpuMs), format(r.sampledPeakProcessRssBytes / 1048576), r.verified ? 'Sì' : 'No']) : summarize(report.runs).map(r => [r.nodes, r.scenario, format(r.medianMs.equal), format(r.medianMs.calibrated), format(r.medianMs.adaptive), format(r.adaptiveVsEqual) + '×', r.verified ? 'Sì' : 'No']);
    const headers = report.mode === 'multi' ? ['Nodi', 'Utente logico', 'Job', 'Stato', 'Tempo virtuale ms', 'Unità completate'] : capacity ? ['Nodi', 'Ripetizione', 'Connessi', 'Connessione ms', 'Job ms', 'Unità/s', 'Task', 'Messaggi', 'Task RTT p50/p95/p99 ms', 'Event loop p99 ms', 'CPU ms', 'RSS MiB', 'Verificato'] : ['Nodi', 'Scenario', 'Uguale ms', 'Calibrato ms', 'Adattivo ms', 'Uguale/adattivo', 'Verificato'];
    $('lab-results').replaceChildren(table(headers, rows));
    $('download-summary').disabled = report.mode === 'multi'; $('lab-error').textContent = '';
  } catch (error) { current = null; $('download-summary').disabled = true; $('lab-error').textContent = error.message; }
};
$('download-summary').onclick = () => {
  if (!current) return;
  const url = URL.createObjectURL(new Blob([markdown(current)], { type: 'text/markdown' }));
  const a = document.createElement('a'); a.href = url; a.download = 'macn-alpha2-report.md'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
