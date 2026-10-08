// Stable binary min-heap: deterministic ties, O(log n) push/pop.
export class Events {
  heap = []; sequence = 0;
  get size() { return this.heap.length; }
  before(a, b) { return a.at < b.at || (a.at === b.at && a.seq < b.seq); }
  push(at, fn) {
    const item = { at, fn, seq: this.sequence++ }, heap = this.heap;
    heap.push(item); let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.before(item, heap[p])) break; heap[i] = heap[p]; i = p; }
    heap[i] = item;
  }
  pop() {
    const heap = this.heap, first = heap[0], last = heap.pop();
    if (heap.length) {
      let i = 0;
      while (2 * i + 1 < heap.length) {
        let child = 2 * i + 1;
        if (child + 1 < heap.length && this.before(heap[child + 1], heap[child])) child++;
        if (!this.before(heap[child], last)) break;
        heap[i] = heap[child]; i = child;
      }
      heap[i] = last;
    }
    return first;
  }
}
export function rng(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
}
