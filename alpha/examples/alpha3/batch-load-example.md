# Batch load example

Captured 2026-10-08 with `npm run batch:load -- --tasks=1000` on Node v24.19.0, Linux x64. Each run creates and completes 1,000 synthetic Monte Carlo-shaped tasks in a temporary SQLite database.

| Virtual pollers | Poll requests | Elapsed | Poll/s | Tasks/s | Heap delta |
|---:|---:|---:|---:|---:|---:|
| 1,000 | 1,000 | 221 ms | 4,521 | 4,521 | 0.65 MiB |
| 10,000 | 10,000 | 270 ms | 37,065 | 3,707 | 2.01 MiB |
| 100,000 | 100,000 | 717 ms | 139,423 | 1,394 | 1.27 MiB |

This run is a **sequential in-process queue/store probe**. Pollers are not concurrent clients, HTTP requests, physical devices, or workers performing useful compute. The 100k row means the local synchronous SQLite idle-poll preflight processed 100k polls in about 717 ms in this environment; actual task claims still use a serialized write transaction. This does not establish 100k-node system capacity. The machine has nine reported logical CPUs and about 10.45 GB total memory in the execution container. The raw machine-readable output is [batch-load-example.json](batch-load-example.json).
