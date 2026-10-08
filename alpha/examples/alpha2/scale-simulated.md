# MACN alpha.2 laboratory report

Mode: **simulated**. Complete: **true**.

Discrete-event simulation with modelled compute/network time and exact O(1) range checksums. NOT a physical cluster or a measured Monte Carlo speedup.

| Nodes | Scenario | Equal median ms | Calibration median ms | Adaptive median ms | Paired equal/adaptive | Verified |
|---|---|---:|---:|---:|---:|---|
| 10 | steady | 17338.67 | 3597.98 | 3520.00 | 4.93× | true |
| 100 | steady | 18346.67 | 4078.71 | 4025.00 | 4.56× | true |
| 1000 | steady | 18346.67 | 4078.71 | 4025.00 | 4.56× | true |
| 10000 | steady | 18346.67 | 4078.72 | 4025.00 | 4.56× | true |

Ratios above 1 favour adaptive; below 1 favour equal. Includes all completed runs, including regressions. Policy order rotates by repeat. Raw JSON includes seed, timings, retries, correctness and resource metrics.
