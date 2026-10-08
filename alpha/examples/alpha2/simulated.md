# MACN alpha.2 laboratory report

Mode: **simulated**. Complete: **true**.

Discrete-event simulation with modelled compute/network time and exact O(1) range checksums. NOT a physical cluster or a measured Monte Carlo speedup.

| Nodes | Scenario | Equal median ms | Calibration median ms | Adaptive median ms | Paired equal/adaptive | Verified |
|---|---|---:|---:|---:|---:|---|
| 100 | steady | 18346.67 | 4078.71 | 4025.00 | 4.56× | true |
| 100 | slowdown | 18346.67 | 43480.06 | 7776.00 | 2.36× | true |
| 100 | churn | 22459.67 | 9462.00 | 5042.00 | 4.45× | true |
| 100 | latency | 43098.67 | 9678.70 | 5350.00 | 8.06× | true |
| 1000 | steady | 18346.67 | 4078.71 | 4025.00 | 4.56× | true |
| 1000 | slowdown | 18346.67 | 43480.10 | 7794.71 | 2.35× | true |
| 1000 | churn | 22681.67 | 9462.00 | 5053.00 | 4.49× | true |
| 1000 | latency | 43434.67 | 9678.71 | 5350.00 | 8.12× | true |

Ratios above 1 favour adaptive; below 1 favour equal. Includes all completed runs, including regressions. Policy order rotates by repeat. Raw JSON includes seed, timings, retries, correctness and resource metrics.
