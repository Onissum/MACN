import { Server } from 'socket.io';
// Adapter contract: send(nodeId,event,payload) returns false if unavailable.
export function attachNetwork(server, coordinator, token) {
  const io = new Server(server, { transports: ['websocket'], maxHttpBufferSize: 65536, pingInterval: 2000, pingTimeout: 6000 });
  io.use((socket, next) => socket.handshake.auth?.token === token ? next() : next(Error('Invalid session token')));
  io.on('connection', socket => {
    if (io.engine.clientsCount > 64) { socket.disconnect(true); return; }
    if (socket.handshake.auth?.role !== 'worker') socket.join('dashboards');
    let registered = false, probe = null;
    socket.on('register', (data, ack) => {
      try {
        if (registered) throw Error('Already registered');
        coordinator.engine.addNode(socket.id, data?.name, data?.benchmark); registered = true;
        probe = { nonce: Math.random().toString(36), sent: performance.now() }; socket.emit('ping-app', probe.nonce);
        ack?.({ ok: true, id: socket.id });
      } catch (e) { ack?.({ error: e.message }); }
    });
    socket.on('result', data => { if (registered) coordinator.engine.accept(socket.id, data); });
    socket.on('pong-app', nonce => {
      if (!probe || nonce !== probe.nonce) return;
      coordinator.engine.heartbeat(socket.id, performance.now() - probe.sent); probe = null;
    });
    socket.on('start-suite', (config, ack) => {
      try { coordinator.startSuite(config); ack?.({ ok: true }); } catch (e) { ack?.({ error: e.message }); }
    });
    socket.on('cancel-suite', () => coordinator.cancel());
    const timer = setInterval(() => {
      if (registered && !coordinator.engine.nodes.get(socket.id)?.connected) { socket.disconnect(true); return; }
      if (!probe) { probe = { nonce: Math.random().toString(36), sent: performance.now() }; socket.emit('ping-app', probe.nonce); }
    }, 500);
    socket.on('disconnect', () => { clearInterval(timer); coordinator.engine.removeNode(socket.id); });
    if (socket.handshake.auth?.role !== 'worker') socket.emit('snapshot', coordinator.snapshot());
  });
  const timer = setInterval(() => {
    coordinator.tick();
    if (io.sockets.adapter.rooms.get('dashboards')?.size) io.to('dashboards').volatile.emit('snapshot', coordinator.snapshot());
  }, 250);
  return { io, send(id, event, payload) {
    const socket = io.sockets.sockets.get(id);
    if (!socket?.connected || socket.conn.writeBuffer.length > 32) return false;
    socket.emit(event, payload); return true;
  }, close() { clearInterval(timer); return new Promise(resolve => io.close(resolve)); } };
}
