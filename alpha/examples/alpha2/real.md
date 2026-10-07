# MACN alpha.2 laboratory report

Mode: **real**. Complete: **true**.

Real Monte Carlo, local worker threads and loopback WebSockets on ONE host. Injected service delays; not heterogeneous physical devices.

| Nodes | Scenario | Equal median ms | Calibration median ms | Adaptive median ms | Paired equal/adaptive | Verified |
|---|---|---:|---:|---:|---:|---|
| 10 | steady | 528.39 | 320.32 | 223.71 | 2.22× | true |
| 10 | slowdown | 922.36 | 2254.47 | 882.11 | 1.81× | true |
| 10 | churn | 4220.51 | 4310.66 | 3182.63 | 1.37× | true |
| 50 | steady | 2022.11 | 1031.12 | 1710.91 | 1.52× | true |
| 50 | slowdown | 2938.23 | 3907.54 | 1826.88 | 1.96× | true |
| 50 | churn | 4702.92 | 4418.01 | 3235.50 | 1.45× | true |

Ratios above 1 favour adaptive; below 1 favour equal. Includes all completed runs, including regressions. Policy order rotates by repeat. Raw JSON includes seed, timings, retries, correctness and resource metrics.
