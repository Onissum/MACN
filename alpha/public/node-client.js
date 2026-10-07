export class BrowserNode {
  constructor(socket, onStatus) {
    this.socket = socket; this.onStatus = onStatus; this.active = null; this.enabled = false;
    this.createWorker();
    socket.on('task', task => {
      if (!this.enabled || this.active) return;
      this.active = task; this.onStatus('Calcolo in corso'); this.worker.postMessage(task);
    });
    socket.on('cancel', msg => {
      if (this.active?.jobId === msg.jobId && this.active?.task.id === msg.taskId && (!msg.attempt || this.active.task.attempt === msg.attempt)) {
        this.createWorker(); this.onStatus('Task riassegnato; pronto');
      }
    });
    socket.on('disconnect', () => { this.enabled = false; this.createWorker(); this.onStatus('Disconnesso: riconnessione in corso'); });
    socket.on('ping-app', nonce => socket.emit('pong-app', nonce));
  }
  createWorker() {
    this.worker?.terminate(); this.active = null;
    this.worker = new Worker('/compute-worker.js', { type: 'module' });
    this.worker.onerror = e => this.onStatus('Errore worker: ' + e.message);
    this.worker.onmessage = ({ data }) => {
      if (data.type === 'benchmark') {
        this.socket.emit('register', { name: this.name, benchmark: data.benchmark }, reply => {
          if (reply.error) { this.onStatus(reply.error); return; }
          this.enabled = true; this.onStatus(`Pronto · ${(data.benchmark.rate * 1000).toFixed(0)} campioni/s`);
        });
      } else if (data.type === 'result') {
        this.active = null; this.socket.emit('result', data); this.onStatus('Pronto');
      } else this.onStatus(data.error);
    };
  }
  join(name) { this.name = name; this.onStatus('Calibrazione: warm-up + 5 misure'); this.worker.postMessage({ type: 'benchmark' }); }
  close() { this.enabled = false; this.worker.terminate(); }
}
