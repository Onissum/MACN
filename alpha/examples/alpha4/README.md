# Async Batch simulation examples

Run the default scenario with `npm run lab:async`. It uses virtual worker profiles for a desktop, notebook and older PC, with rates of 200k, 60k and 12k Monte Carlo samples/s. The same BatchQueue and SQLite task lifecycle as the prototype is exercised; virtual time is advanced by simulated task durations. The final π aggregate is compared with a sequential run.

| Scenario | Simulated completion | Single fastest node | Speedup | Reassignments | Result verified |
|---|---:|---:|---:|---:|---|
| Heterogeneous, steady | 1.25 s | 1.50 s | 1.20× | 0 | yes |
| One slow node disconnects | 3.03 s | 1.00 s | 0.33× | 1 | yes |

The disconnect case intentionally shows the lease-recovery cost: work is preserved, but the job waits about three virtual seconds for the abandoned lease to expire and be reassigned. That is a measured design trade-off in this model, not a physical timing guarantee. Tune lease policy and task size against the desired balance of recovery delay and false reassignment.

The profiles, availability event, task compute times and poll events are simulated. The simulator uses the real local BatchQueue/SQLite lifecycle and computes/validates the actual Monte Carlo result, but does not model real network delays, simultaneous HTTP traffic, operating-system scheduling, or device energy use. Raw output: [steady](steady.json) and [disconnect recovery](disconnect.json).
