# Coordinator HTTP probe (local only)

Command: `npm run batch:http-load -- --clients=64 --requests=10000 --tasks=2000`.

On Node v24.19.0 / Linux x64, 64 concurrent clients completed all 10,000 loopback HTTP work-pull requests and allocated 2,000 tasks with no transport or HTTP errors. Elapsed time was 3.21 s (3,114.8 requests/s); pull latency was p50 16.731 ms, p95 26.132 ms, p99 34.279 ms, maximum 510.444 ms. Reported process RSS delta was 204,468,224 bytes and heap delta 21,341,584 bytes.

This is a single-process local HTTP and in-memory SQLite measurement. It does not measure remote networking, persistent SQLite write contention, worker computation, multi-coordinator operation, or thousands of actual devices. The RSS delta also means the next useful measurement should include a sustained run with resource sampling and persistent storage before making deployment or scale claims.
