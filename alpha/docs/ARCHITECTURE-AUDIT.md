# Repository audit and alpha architecture

Base: `472c876` (default branch at checkout). Dedicated branch: `macn-1.0-alpha`.

## Scope and existing architecture

The complete tracked tree contains 4,850 files, including 4,781 vendored `node_modules` files. First-party source, task definitions, scripts, readmes and copies were inventoried and inspected by subsystem. `repository-inventory.json` records paths, sizes in lines, hashes and static feature indicators. Dependencies are third-party code, not 4,781 independently reviewed MACN modules. Images are documentation assets. No AGENTS.md was present in this repository.

| Component | What exists | Status / limits |
|---|---|---|
| `macn_mattone_1.html` | Early peer discovery UI | Connection experiment |
| `NUOVO MACN/MATTONE 1..4` | Express/Socket.IO discovery; subsequent offer/answer/ICE forwarding and multi-peer RTC channels | Incremental network experiments; no production scheduler |
| `macn-p2p/client.html`, historical v11 | Browser job coordinator, Mandelbrot strips, asymmetric initial distribution, cooperative Help/work stealing | Main-thread compute; fixed weights; browser state and scheduling interwoven |
| `macn-p2p/client - Copia*`, `prove/` | Alternative benchmark, RTT, task registry, load prediction, clustering, work offer/lease experiments | Competing monolithic implementations. Copies 2/3 contain expiring transfer leases, not durable execution ownership. Some import executable task code via eval |
| `macn-p2p/TASK/` | Mandelbrot, Julia, primes, matrix, raytracer and quantum/ML demonstration definitions | Code-bearing JSON experiments, not validated alpha plugins |
| `macn-computertc-v0.5.2/` | Latest milestone: standalone transport, two RTC channels, central unique result collection, Help IDs | Useful transport component; five original frame assertions pass. README reports prior two-peer 40-task run, not revalidated physical hardware here |
| `demo.html` | Recorded-session reconstruction using local RTC peers | A replay; its 9.15-second figure is not a new benchmark |
| signaling servers | Node, Express, Socket.IO; global peer map and offer/answer/ICE relay | Compute coordinator is a browser, not this server. No room isolation or execution ledger |
| batch scripts / TURN | Local launch and tunnel helpers; `start-coturn.sh` empty | No complete automatic WAN/TURN deployment |

The README's seven-device experiment is historical evidence of connectivity, not evidence that this alpha has passed a new three-device computation test.

## Structural findings before implementation

1. v0.5.2 initial weights are `[.30,.70]` or `[.10,.30,.60]`; only two remote peers receive initial tasks in the latter branch. There is no capacity-derived initial schedule.
2. Synchronous Mandelbrot blocks UI, heartbeat and Help handling. Iteration count is read from each local DOM rather than distributed immutable job parameters.
3. There is no authoritative execution lease per `(job, task, attempt, owner)`. Disconnect cleanup removes peers but cannot reliably recover lost running tasks. Transfer removes tasks before knowing delivery succeeded.
4. Deduplication only by task ID allows stale-job results to collide. Result IDs and expected counts need stronger validation.
5. The UI's old efficiency expression is not measured speedup. A sequential baseline is absent.
6. ICE may arrive before a remote description and is not buffered. Simultaneous offers, channel degradation and TURN reachability need tests.
7. The signaling upgrade filter relies on Referer/User-Agent heuristics; those are unreliable authentication and can reject legitimate WebSockets.
8. First-party static directories include server/package files and a filename indicating an ngrok token. Treat the committed token as exposed and rotate it; this work does not reproduce its value or rewrite history.
9. Vendored dependencies and numbered client copies obscure the supported entry point. Historical trees remain intact; the alpha uses a lockfile and ignores its node_modules.

## ComputeRTC evaluation

Good existing code: binary frame header, independent logical queues, low-water callbacks, 256 KiB control / 4 MiB data watermarks, 32 MiB aggregate queued-byte cap, state requiring both channels open. New fake-channel tests verify that control can drain while data is blocked, and that the queue cap works. Original frame tests also pass.

Remaining limits: payloads are usually JSON text inside binary frames; Mandelbrot sends arrays of numbers instead of compact typed pixel buffers. No negotiated max-message-size handling, chunking/reassembly, application ACK, deduplication by attempt, latency percentiles or retry ownership. A single oversized frame can exceed the intended high-water bound because the check considers bufferedAmount before adding the frame. New direct sends can bypass higher-priority queued lanes; critical control drains ahead of heartbeat, which can starve under sustained critical traffic. Separate channels do not ensure order between job-start and task data. send/queue success does not imply remote acceptance. Closing channels does not clear pending queues.

Two channels are a sensible future design for bulk results: reliable control and reliable task data, with small bounded frames and an explicit job-ready handshake. More than two is not justified by evidence here: SCTP streams share a transport and congestion budget. A single channel is sufficient for this alpha's very small task descriptors and count results; it avoids adding a second failure surface. No claim is made that WebSocket is faster than RTC, or that two RTC channels guarantee latency isolation. RTC p50/p95/p99 under load remain unmeasured. The alpha reports **application WebSocket RTT**, not RTC latency.

## Alpha implementation decision

An additive `alpha/` entry point preserves all existing prototypes. It reuses the established Node/Express/Socket.IO stack and the prior task-registry, calibration and load-balancing concepts. There was no separable reliable scheduler to reuse directly. ComputeRTC is preserved and regression-tested rather than silently replaced in its original experiment.

The first runnable alpha deliberately uses a Node coordinator and a star-shaped WebSocket network. This is a change of execution topology, not a claim of full decentralized MACN. It provides an authoritative task ledger and reproducible failure semantics before adding P2P transport. Monte Carlo replaces Mandelbrot as the first alpha fixture because independently indexed samples have uniform cost and an exact partition-invariant integer result. It is a deterministic verification workload, not a production statistical RNG library.

| Layer | Files | Responsibility |
|---|---|---|
| Network | `src/network.js`, `src/server.js` | Socket.IO WebSocket adapter, token, static allowlist, RTT probes, reports |
| Scheduling | `src/scheduler.js` | Chunk sizing, EWMA delivered rate, lease deadlines, percentiles |
| Task engine | `src/engine.js` | Authoritative task ownership, attempts, retries, unique accepted results |
| Experiment orchestration | `src/coordinator.js` | Repeated paired baseline/distributed runs and verified speedup |
| Workload | `src/workloads.js` | Versioned compute, parameter validation, partition generation and merge |
| Execution | `public/compute-worker.js`, `node-client.js` | Background Web Worker; termination on cancellation and disconnect |
| Interface | `public/app.js`, `index.html`, `style.css` | Render snapshots, join, benchmark, export |

## Scheduling and correctness contract

One in-flight task per node. The target is 150 ms of work: `count = clamp(rate × 150, 2000, 5000000)`, bounded by remaining units. Faster nodes get larger chunks and return for more work sooner. Bounded chunks replace large preallocated queues and remove the need to steal pending work from a worker.

Calibration warms up the exact kernel, then takes the median of five 250,000-sample runs. During a job, observed rate includes coordinator dispatch-to-result wall time: `EWMA = .65 × previous + .35 × delivered`. A node below 35% of its calibration rate is marked slow. Lease duration is `clamp(6 × expected duration + 4 × RTT, 3000, 30000)` milliseconds. Timeout halves the estimate and applies a one-second cooldown; pending work is reassigned. Application heartbeat expires after eight seconds. A job deadline prevents indefinite waits.

A lease belongs to `(jobId, taskId, attempt, socket-session owner)`. Retries preserve the range, increment the attempt, and fence the previous owner. At-least-once execution / exactly-once accepted contribution. Result shape, count and integer hit bounds are checked; this is not Byzantine verification. Full distributed results must match the same-seed sequential hit count before speedup is accepted.

Calibration and readiness precede admission. A benchmark freezes its cohort; a reconnect has a new socket identity and is admitted on the **next** benchmark. Surviving selected nodes recover lost tasks. If every selected node disappears, the suite fails explicitly. The coordinator does not fail over; a restart loses the in-memory job.

## Concrete implementation phases

1. Audit and branch; run original transport tests.
2. Pure workload/scheduler/engine; deterministic clock tests for ownership and failures.
3. Network adapter, Web Worker and dashboard; real socket integration tests.
4. Paired repeatable benchmarks and exports; browser checks and measured example.
5. Document physical three-device protocol, limitations and next-phase acceptance criteria.
