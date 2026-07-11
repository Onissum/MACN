/* ComputeRTC Transport v0.5
 * Compute-oriented transport layer over standard WebRTC DataChannels.
 */
(function (global) {
  'use strict';

  const Lane = Object.freeze({
    HEARTBEAT: 0,
    CONTROL_CRITICAL: 1,
    CHECKPOINT: 2,
    TASK_DATA: 3
  });
  const SendResult = Object.freeze({
    SENT: 'SENT', QUEUED: 'QUEUED', BACKPRESSURE: 'BACKPRESSURE',
    CLOSED: 'CLOSED', ERROR: 'ERROR'
  });
  const TransportState = Object.freeze({
    CONNECTING: 'CONNECTING', OPEN: 'OPEN', DEGRADED: 'DEGRADED',
    CLOSING: 'CLOSING', CLOSED: 'CLOSED', ERROR: 'ERROR'
  });

  const MAGIC = [0x43, 0x52, 0x54, 0x43]; // CRTC
  const VERSION = 1;
  const HEADER_SIZE = 8;
  const CONTROL_HIGH_WATER = 256 * 1024;
  const DATA_HIGH_WATER = 4 * 1024 * 1024;
  const MAX_QUEUE_BYTES = 32 * 1024 * 1024;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  function encodeFrame(lane, value) {
    const payload = value instanceof Uint8Array
      ? value
      : encoder.encode(typeof value === 'string' ? value : JSON.stringify(value));
    const frame = new Uint8Array(HEADER_SIZE + payload.byteLength);
    frame.set(MAGIC, 0);
    frame[4] = VERSION;
    frame[5] = lane;
    frame[6] = value instanceof Uint8Array ? 1 : 0;
    frame[7] = 0;
    frame.set(payload, HEADER_SIZE);
    return frame;
  }

  function decodeFrame(input) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
    if (bytes.byteLength < HEADER_SIZE || MAGIC.some((x, i) => bytes[i] !== x)) {
      throw new Error('Pacchetto ComputeRTC non riconosciuto');
    }
    if (bytes[4] !== VERSION) throw new Error(`Versione ComputeRTC non supportata: ${bytes[4]}`);
    const lane = bytes[5];
    if (lane < Lane.HEARTBEAT || lane > Lane.TASK_DATA) throw new Error(`Corsia ComputeRTC non valida: ${lane}`);
    const binary = bytes[6] === 1;
    const payload = bytes.slice(HEADER_SIZE);
    return { lane, payload: binary ? payload : decoder.decode(payload), binary };
  }

  class ComputeRTCTransport {
    constructor(peerId, options = {}) {
      this.peerId = peerId;
      this.channels = new Map();
      this.state = TransportState.CONNECTING;
      this.messageHandlers = new Set();
      this.stateHandlers = new Set();
      this.writableHandlers = new Set();
      this.queues = new Map([[Lane.HEARTBEAT, []], [Lane.CONTROL_CRITICAL, []], [Lane.CHECKPOINT, []], [Lane.TASK_DATA, []]]);
      this.queuedBytes = 0;
      this.stats = { sentFrames: 0, receivedFrames: 0, queuedFrames: 0, droppedFrames: 0, sentBytes: 0, receivedBytes: 0 };
      if (options.onMessage) this.onMessage(options.onMessage);
      if (options.onStateChange) this.onStateChange(options.onStateChange);
    }

    registerChannel(channel) {
      if (!['computertc-control', 'computertc-data'].includes(channel.label)) return false;
      const kind = channel.label === 'computertc-control' ? 'control' : 'data';
      this.channels.set(kind, channel);
      channel.binaryType = 'arraybuffer';
      channel.bufferedAmountLowThreshold = kind === 'control' ? 64 * 1024 : 1024 * 1024;
      channel.addEventListener('open', () => { this.refreshState(); this.flush(); });
      channel.addEventListener('close', () => this.refreshState());
      channel.addEventListener('error', () => this.setState(TransportState.DEGRADED));
      channel.addEventListener('bufferedamountlow', () => { this.flush(); for (const handler of this.writableHandlers) handler(); });
      channel.addEventListener('message', event => this.receive(event.data));
      this.refreshState();
      return true;
    }

    channelForLane(lane) {
      return lane === Lane.HEARTBEAT || lane === Lane.CONTROL_CRITICAL
        ? this.channels.get('control')
        : this.channels.get('data');
    }

    trySend(lane, value) {
      if (this.state === TransportState.CLOSED || this.state === TransportState.CLOSING) return SendResult.CLOSED;
      let frame;
      try { frame = encodeFrame(lane, value); } catch (_) { return SendResult.ERROR; }
      const channel = this.channelForLane(lane);
      const highWater = lane <= Lane.CONTROL_CRITICAL ? CONTROL_HIGH_WATER : DATA_HIGH_WATER;
      if (channel && channel.readyState === 'open' && channel.bufferedAmount < highWater && this.queues.get(lane).length === 0) {
        try {
          channel.send(frame);
          this.stats.sentFrames++;
          this.stats.sentBytes += frame.byteLength;
          return SendResult.SENT;
        } catch (_) { return SendResult.ERROR; }
      }
      if (!channel || channel.readyState === 'closed') return SendResult.CLOSED;
      if (this.queuedBytes + frame.byteLength > MAX_QUEUE_BYTES) {
        this.stats.droppedFrames++;
        return SendResult.BACKPRESSURE;
      }
      this.queues.get(lane).push(frame);
      this.queuedBytes += frame.byteLength;
      this.stats.queuedFrames++;
      return SendResult.QUEUED;
    }

    flush() {
      // Control always drains before checkpoints and task payloads.
      for (const lane of [Lane.CONTROL_CRITICAL, Lane.HEARTBEAT, Lane.CHECKPOINT, Lane.TASK_DATA]) {
        const channel = this.channelForLane(lane);
        if (!channel || channel.readyState !== 'open') continue;
        const highWater = lane <= Lane.CONTROL_CRITICAL ? CONTROL_HIGH_WATER : DATA_HIGH_WATER;
        const queue = this.queues.get(lane);
        while (queue.length && channel.bufferedAmount < highWater) {
          const frame = queue.shift();
          this.queuedBytes -= frame.byteLength;
          try {
            channel.send(frame);
            this.stats.sentFrames++;
            this.stats.sentBytes += frame.byteLength;
          } catch (_) {
            queue.unshift(frame);
            this.queuedBytes += frame.byteLength;
            break;
          }
        }
      }
    }

    receive(input) {
      try {
        const frame = decodeFrame(input);
        this.stats.receivedFrames++;
        this.stats.receivedBytes += input.byteLength || input.size || 0;
        for (const handler of this.messageHandlers) handler(frame.lane, frame.payload, frame.binary);
      } catch (error) {
        console.warn('[ComputeRTC]', error.message);
      }
    }

    onMessage(handler) { this.messageHandlers.add(handler); return () => this.messageHandlers.delete(handler); }
    onStateChange(handler) { this.stateHandlers.add(handler); return () => this.stateHandlers.delete(handler); }
    onWritable(handler) { this.writableHandlers.add(handler); return () => this.writableHandlers.delete(handler); }
    getBufferedBytes(lane) { return this.channelForLane(lane)?.bufferedAmount || 0; }
    getQueuedBytes() { return this.queuedBytes; }
    getState() { return this.state; }
    getStats() { return { ...this.stats, queuedBytes: this.queuedBytes }; }

    refreshState() {
      const control = this.channels.get('control');
      const data = this.channels.get('data');
      if (control?.readyState === 'open' && data?.readyState === 'open') this.setState(TransportState.OPEN);
      else if (control?.readyState === 'closed' || data?.readyState === 'closed') this.setState(TransportState.DEGRADED);
      else this.setState(TransportState.CONNECTING);
    }

    setState(next) {
      if (this.state === next) return;
      this.state = next;
      for (const handler of this.stateHandlers) handler(next);
    }

    close() {
      this.setState(TransportState.CLOSING);
      for (const channel of this.channels.values()) channel.close();
      this.setState(TransportState.CLOSED);
    }
  }

  global.ComputeRTC = Object.freeze({ Lane, SendResult, TransportState, ComputeRTCTransport, encodeFrame, decodeFrame, VERSION: '0.5' });
})(window);
