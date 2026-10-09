# Alpha.3: Distributed Batch prototype

Alpha.3 adds a pull-based execution path alongside the existing WebSocket Adaptive experiment. A worker benchmarks the selected Monte Carlo kernel, asks for a bounded package sized to a target work window, computes offline, and posts results. Fast workers can pull again as soon as they finish; slower workers retain their current lease while they compute. The first persistent ledger is SQLite on one coordinator; workload definitions stay pure and are shared through the existing registry. This is a runnable prototype, not yet a public volunteer-computing service.

## Run the coordinator

Requires Node.js **22.13 or newer**. `node:sqlite` is used for the durable local ledger; Node 22 marks that built-in module experimental. The CI and routine verification should keep this status visible.

```sh
cd alpha
npm ci
npm test
MACN_TOKEN='choose-a-long-random-token' npm start
```

Batch API is enabled by default. State is stored in `alpha/results/macn-batch.sqlite` (ignored by Git); override the path with `MACN_BATCH_DB`. The coordinator prints its token. Keep the endpoint on a trusted network; this alpha uses a shared bearer token and has no user identities, quotas, TLS termination, or sandbox for third-party workloads.

## Create a Monte Carlo job

From a second terminal, substitute the same token:

```sh
TOKEN='choose-a-long-random-token'
curl -sS -X POST http://localhost:3003/api/batch/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"workloadId":"monte-carlo-v1","params":{"samples":5000000,"seed":42},"chunkSize":25000}'
```

Copy the returned `id` as `JOB`. On each Node-capable machine, start one worker process (the node IDs must be unique):

```sh
MACN_URL='http://192.168.1.20:3003' MACN_TOKEN="$TOKEN" MACN_NODE_ID='desktop' MACN_JOB_ID='JOB' npm run batch:worker
```

Use `laptop` and `phone-node` as IDs on the other devices. A smartphone can join this first prototype only if it can run Node.js; a browser-based/mobile worker is a later deliverable. Poll job status and counters with:

```sh
curl -sS http://192.168.1.20:3003/api/batch/jobs/JOB -H "Authorization: Bearer $TOKEN"
```

The workload benchmark retains `rate` in units/millisecond for the existing Adaptive WebSocket scheduler and also exposes `unitsPerSecond`. Batch uses only `unitsPerSecond` for pull sizing, lease estimates, and the EWMA capacity update, so all Batch rates share the same units. The worker reports its local rate in its JSON log. `MACN_WORK_WINDOW_SECONDS` (default 30, accepted range 1–300) controls how much work it requests per pull, capped at 32 tasks. For example, pass `MACN_WORK_WINDOW_SECONDS=60` to a capable desktop to reduce polling, while a slower node naturally receives fewer tasks. Computation runs in a worker thread so the client can renew active leases while a long task is running. Lease length is estimated from the reserved package with a safety margin (minimum 60 seconds, maximum 30 minutes); a lost worker's tasks become eligible when the lease expires and can be reissued up to four attempts. Results require the current lease token and are accepted once.

Before sending a computed result, the worker writes it to a local SQLite outbox (`~/.macn/batch-spool-<node-id>.sqlite` by default; override with `MACN_SPOOL_DB`). If the coordinator is temporarily unreachable, the worker retries delivery after reconnection. A result already committed by the coordinator survives coordinator restart in its SQLite ledger. A locally spooled result whose lease expired or was reassigned is rejected by fencing; MACN then keeps the authoritative attempt and safely recomputes only that task. Protect the worker's home directory: the outbox contains results and lease tokens.

## Repeatable local scale probe

```sh
npm run batch:load -- --tasks=1000
```

The command runs 1k, 10k, and 100k virtual pollers against a temporary SQLite ledger, prints JSON with elapsed time, poll/s, task/s, heap delta, and result count, then removes its database. It tests sequential coordinator-side queue operations and idle-poll cost. It does **not** represent 100k sockets, concurrent HTTP clients, Internet behavior, or aggregate device compute. Do not use the output as a capacity claim for physical nodes. For concurrency/network saturation, a separate HTTP load generator and resource monitoring are needed.

For bounded simultaneous loopback HTTP requests to the actual coordinator/API, run `npm run batch:http-load` (defaults: 32 clients, 2,000 requests, 500 one-unit tasks). It reports request throughput, p50/p95/p99 latency, errors/status failures and process memory deltas. Increase cautiously with `-- --clients=64 --requests=10000 --tasks=5000`. This is still a single-host probe with in-memory SQLite, not an Internet or multi-host capacity result.

One sequential queue probe is in [the Alpha.3 benchmark example](../examples/alpha3/batch-load-example.md). A separate concurrent loopback HTTP result is recorded in [the HTTP probe report](../examples/alpha3/http-load-64x10k.md), with its raw JSON alongside it.

To test task timing with heterogeneous workers and simulated outages using the real BatchQueue/SQLite lifecycle, run `npm run lab:async` or `npm run lab:async -- --scenario=disconnect`. The virtual completion time and exact-result check are explained in [the Alpha.4 async simulation examples](../examples/alpha4/README.md); this is distinct from an HTTP load test.

## Current boundaries / next work

- SQLite is a single-coordinator prototype. A database adapter seam exists, but no PostgreSQL/distributed queue implementation is included.
- Pull size uses the startup benchmark and a bounded target window, with per-task EWMA updates. There are no CPU/memory budgets, worker capability negotiation, fairness, or operator dashboard for Batch yet.
- The whole returned package shares a lease expiry estimated from the benchmark. Workers renew leases during computation and persist computed results locally, but a worker offline longer than its lease cannot reserve ownership indefinitely; after expiry a newer attempt wins and a stale result is rejected.
- Retry count exhaustion fails the job; it does not split tasks for a slower heterogeneous node.
- No cryptographic verification or sandboxing. Only trusted workers and this deterministic demonstration workload are appropriate.
- Next: add a browser worker interface and per-node benchmark telemetry; implement bounded local work queue and lease renewal; introduce concurrent HTTP load tests and SQLite/Postgres measurements; then assess persistent-store migration based on measured contention. Add auth scopes, HTTPS deployment, quotas and workload sandbox before public participation.
