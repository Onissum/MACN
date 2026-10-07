import { BrowserNode } from './node-client.js';
const $ = id => document.getElementById(id);
let socket, node, latest;
const number = n => Number.isFinite(n) ? n.toLocaleString('it-IT', { maximumFractionDigits: 1 }) : '—';
$('name').value = /Android|iPhone|iPad/i.test(navigator.userAgent) ? 'Smartphone' : 'Computer';
function error(message) { $('error').textContent = message || ''; }
$('join').onclick = () => {
  if (!$('token').value.trim()) return error('Inserisci il token del coordinatore.');
  socket?.disconnect(); node?.close();
  socket = io({ transports: ['websocket'], auth: { token: $('token').value.trim() }, autoConnect: false });
  node = new BrowserNode(socket, message => { $('local').textContent = message; });
  socket.on('connect', () => { $('connection').textContent = 'ONLINE'; $('join').disabled = true; $('leave').disabled = false; node.join($('name').value); error(); });
  socket.on('disconnect', () => { $('connection').textContent = 'OFFLINE'; $('join').disabled = false; $('run').disabled = true; });
  socket.on('connect_error', e => { error(e.message); $('join').disabled = false; });
  socket.on('snapshot', render); socket.connect();
};
$('leave').onclick = () => { socket?.disconnect(); node?.close(); $('leave').disabled = true; };
$('run').onclick = () => {
  error(); socket.emit('start-suite', { params: { samples: Number($('samples').value), seed: Number($('seed').value) }, repeats: Number($('repeats').value), baselineId: $('baseline').value || undefined }, reply => error(reply.error));
};
$('cancel').onclick = () => socket.emit('cancel-suite');
$('export').onclick = () => {
  const blob = new Blob([JSON.stringify(latest.latestReport, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = 'macn-benchmark.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
};
function render(snapshot) {
  latest = snapshot;
  const { nodes, job, suite, latestReport } = snapshot, online = nodes.filter(n => n.connected);
  $('online').textContent = online.length;
  $('phase').textContent = suite ? `${suite.phase === 'baseline' ? 'Singolo' : 'Distribuito'} ${suite.round}/${suite.repeats} · ${{ running: 'in corso', completed: 'completato', failed: 'fallito', cancelled: 'interrotto' }[suite.status]}` : 'In attesa';
  $('elapsed').textContent = job ? number(job.elapsedMs / 1000) + ' s' : '—';
  $('throughput').textContent = job ? number(job.throughput / 1e6) + ' M/s' : '—';
  $('progress').value = job?.percent || 0;
  $('progress-label').textContent = job ? `${number(job.percent)}% · ${job.completed} task · ${job.reassigned} riassegnazioni` : 'Nessun job';
  const pair = suite?.pairs.at(-1);
  $('speedup').textContent = pair ? number(pair.speedup) + '×' : '—';
  $('run').disabled = !socket?.connected || !online.length || suite?.status === 'running'; $('cancel').disabled = suite?.status !== 'running'; $('export').disabled = !latestReport;
  if (suite?.error) error(suite.error);
  const selected = $('baseline').value;
  $('baseline').replaceChildren(new Option('Più veloce alla partenza', ''), ...online.map(n => new Option(n.name + ' · ' + n.id.slice(0, 5), n.id)));
  if (online.some(n => n.id === selected)) $('baseline').value = selected;
  $('nodes').replaceChildren(...nodes.map(n => {
    const tr = document.createElement('tr');
    const values = [`${n.name} · ${n.id.slice(0, 5)}`, n.state, number(n.rate * 1000), number(n.lastRate * 1000), number(n.capacityShare) + '%', n.assigned, n.completed, n.loadPercent + '%',
      [n.latency.p50, n.latency.p95, n.latency.p99].map(number).join(' / ') + ` ms (${n.latency.samples})`, n.reassigned];
    for (const value of values) { const td = document.createElement('td'); td.textContent = value; tr.append(td); } return tr;
  }));
  $('pairs').replaceChildren(...(suite?.pairs || []).map(p => {
    const el = document.createElement('p'); el.textContent = `#${p.round} · singolo ${number(p.baselineMs / 1000)} s → distribuito ${number(p.distributedMs / 1000)} s · speedup ${number(p.speedup)}× · ${p.verified ? 'risultati identici' : 'ERRORE'} · ${p.contributors.length} nodi hanno contribuito${p.cohortChanged ? ' · gruppo cambiato' : ''}`; return el;
  }));
  $('logs').textContent = snapshot.logs.slice(-80).map(e => `${(e.at / 1000).toFixed(2)}s ${e.type} ${JSON.stringify(e, (k, v) => ['at', 'type'].includes(k) ? undefined : v)}`).join('\n');
}
