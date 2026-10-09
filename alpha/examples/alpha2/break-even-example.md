# MACN simulated break-even matrix

Discrete-event model, not a physical cluster benchmark. Baseline is the fastest simulated node with local data; the distributed run includes task/result transfer over heterogeneous RTT and bandwidth. `bytes/unit` is split evenly between input and output.

Samples per run: **3000000**. Repeats per cell: **2**.

| Scenario | Nodes | Bytes/unit | Compute multiplier | Baseline ms | Equal ms | Calibrated ms | Adaptive ms | Adaptive speedup | Efficiency | Median transferred MiB | Break-even nodes | Verified E/C/A |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| steady | 1 | 0 | 1× | 5000.00 | 5239.45 | 5239.45 | 5239.45 | 0.95× | 0.95 | 0.01 | 4 | true/true/true |
| steady | 1 | 0 | 10× | 50000.00 | 52352.25 | 52352.25 | 52359.29 | 0.95× | 0.95 | 0.10 | 4 | true/true/true |
| steady | 1 | 16 | 1× | 5000.00 | 14039.45 | 14039.45 | 14412.71 | 0.35× | 0.35 | 45.80 | 16 | true/true/true |
| steady | 1 | 16 | 10× | 50000.00 | 61152.25 | 61152.25 | 61560.73 | 0.81× | 0.81 | 45.90 | 4 | true/true/true |
| steady | 1 | 64 | 1× | 5000.00 | 40439.45 | 40439.45 | 41946.58 | 0.12× | 0.12 | 183.18 | 64 | true/true/true |
| steady | 1 | 64 | 10× | 50000.00 | 87552.25 | 87552.25 | 89193.19 | 0.56× | 0.56 | 183.28 | 4 | true/true/true |
| steady | 4 | 0 | 1× | 5000.00 | 13073.96 | 2944.03 | 2964.54 | 1.69× | 0.42 | 0.02 | 4 | true/true/true |
| steady | 4 | 0 | 10× | 50000.00 | 127562.30 | 29281.66 | 29120.70 | 1.72× | 0.43 | 0.19 | 4 | true/true/true |
| steady | 4 | 16 | 1× | 5000.00 | 29873.96 | 7800.47 | 7787.79 | 0.64× | 0.16 | 45.83 | 16 | true/true/true |
| steady | 4 | 16 | 10× | 50000.00 | 144362.30 | 33976.59 | 33908.97 | 1.47× | 0.37 | 45.99 | 4 | true/true/true |
| steady | 4 | 64 | 1× | 5000.00 | 80273.96 | 22467.14 | 22287.01 | 0.22× | 0.06 | 183.25 | 64 | true/true/true |
| steady | 4 | 64 | 10× | 50000.00 | 194762.30 | 48643.25 | 48481.25 | 1.03× | 0.26 | 183.38 | 4 | true/true/true |
| steady | 16 | 0 | 1× | 5000.00 | 3331.49 | 767.57 | 793.11 | 6.30× | 0.39 | 0.02 | 4 | true/true/true |
| steady | 16 | 0 | 10× | 50000.00 | 32174.28 | 7606.48 | 7549.65 | 6.62× | 0.41 | 0.19 | 4 | true/true/true |
| steady | 16 | 16 | 1× | 5000.00 | 7531.49 | 1987.10 | 1995.61 | 2.51× | 0.16 | 45.82 | 16 | true/true/true |
| steady | 16 | 16 | 10× | 50000.00 | 36374.28 | 8828.70 | 8854.22 | 5.65× | 0.35 | 45.99 | 4 | true/true/true |
| steady | 16 | 64 | 1× | 5000.00 | 20131.49 | 5653.78 | 5574.28 | 0.90× | 0.06 | 183.19 | 64 | true/true/true |
| steady | 16 | 64 | 10× | 50000.00 | 48974.28 | 12495.38 | 12536.79 | 3.99× | 0.25 | 183.37 | 4 | true/true/true |
| steady | 64 | 0 | 1× | 5000.00 | 870.25 | 204.03 | 309.21 | 16.17× | 0.25 | 0.02 | 4 | true/true/true |
| steady | 64 | 0 | 10× | 50000.00 | 8168.49 | 1917.12 | 2083.00 | 24.00× | 0.38 | 0.19 | 4 | true/true/true |
| steady | 64 | 16 | 1× | 5000.00 | 1920.25 | 509.33 | 710.74 | 7.03× | 0.11 | 45.81 | 16 | true/true/true |
| steady | 64 | 16 | 10× | 50000.00 | 9218.49 | 2222.68 | 2357.80 | 21.21× | 0.33 | 45.99 | 4 | true/true/true |
| steady | 64 | 64 | 1× | 5000.00 | 5070.25 | 1426.00 | 2050.51 | 2.44× | 0.04 | 183.14 | 64 | true/true/true |
| steady | 64 | 64 | 10× | 50000.00 | 12368.49 | 3139.34 | 3197.20 | 15.64× | 0.24 | 183.36 | 4 | true/true/true |
| churn | 1 | 0 | 1× | 5000.00 | — | — | — | —× | — | 0.00 | 16 | false/false/false |
| churn | 1 | 0 | 10× | 50000.00 | — | — | — | —× | — | 0.00 | 16 | false/false/false |
| churn | 1 | 16 | 1× | 5000.00 | — | — | — | —× | — | 2.44 | 64 | false/false/false |
| churn | 1 | 16 | 10× | 50000.00 | — | — | — | —× | — | 0.52 | 16 | false/false/false |
| churn | 1 | 64 | 1× | 5000.00 | — | — | — | —× | — | 5.49 | none | false/false/false |
| churn | 1 | 64 | 10× | 50000.00 | — | — | — | —× | — | 1.44 | 16 | false/false/false |
| churn | 4 | 0 | 1× | 5000.00 | 13830.79 | 11073.41 | 8834.64 | 0.57× | 0.14 | 0.04 | 16 | true/true/true |
| churn | 4 | 0 | 10× | 50000.00 | 144453.11 | 68536.67 | 67335.40 | 0.74× | 0.19 | 0.30 | 16 | true/true/true |
| churn | 4 | 16 | 1× | 5000.00 | 36040.62 | 19780.41 | 18983.93 | 0.26× | 0.07 | 47.62 | 64 | true/true/true |
| churn | 4 | 16 | 10× | 50000.00 | 162722.48 | 78251.31 | 77392.13 | 0.65× | 0.16 | 46.29 | 16 | true/true/true |
| churn | 4 | 64 | 1× | 5000.00 | 100921.02 | 56768.49 | 50064.13 | 0.10× | 0.02 | 191.56 | none | true/true/true |
| churn | 4 | 64 | 10× | 50000.00 | 219813.17 | 110185.36 | 107966.95 | 0.46× | 0.12 | 184.19 | 16 | true/true/true |
| churn | 16 | 0 | 1× | 5000.00 | 7631.66 | 5261.26 | 4634.51 | 1.09× | 0.07 | 0.02 | 16 | true/true/true |
| churn | 16 | 0 | 10× | 50000.00 | 36486.28 | 13416.01 | 9407.41 | 5.32× | 0.33 | 0.19 | 16 | true/true/true |
| churn | 16 | 16 | 1× | 5000.00 | 11630.06 | 6862.55 | 5557.14 | 0.91× | 0.06 | 47.93 | 64 | true/true/true |
| churn | 16 | 16 | 10× | 50000.00 | 40686.28 | 14491.04 | 10842.01 | 4.61× | 0.29 | 46.24 | 16 | true/true/true |
| churn | 16 | 64 | 1× | 5000.00 | 23625.26 | — | 12209.68 | 0.41× | 0.03 | 193.07 | none | true/false/true |
| churn | 16 | 64 | 10× | 50000.00 | 53286.28 | 18032.09 | 15481.09 | 3.23× | 0.20 | 184.32 | 16 | true/true/true |
| churn | 64 | 0 | 1× | 5000.00 | 5187.91 | 4535.82 | 4068.75 | 1.23× | 0.02 | 0.02 | 16 | true/true/true |
| churn | 64 | 0 | 10× | 50000.00 | 12239.82 | 9770.00 | 4031.01 | 12.44× | 0.19 | 0.20 | 16 | true/true/true |
| churn | 64 | 16 | 1× | 5000.00 | 6036.31 | 4921.80 | 3921.09 | 1.28× | 0.02 | 49.63 | 64 | true/true/true |
| churn | 64 | 16 | 10× | 50000.00 | 13245.02 | 10464.43 | 4769.92 | 10.48× | 0.16 | 46.94 | 16 | true/true/true |
| churn | 64 | 64 | 1× | 5000.00 | 8581.51 | — | 5920.59 | 0.84× | 0.01 | 221.04 | none | true/false/true |
| churn | 64 | 64 | 10× | 50000.00 | 16260.62 | 10163.87 | 4400.77 | 11.36× | 0.18 | 186.87 | 16 | true/true/true |

Times and speedups use only verified completed runs; incomplete repeats are excluded and flagged in `Verified E/C/A` (equal/calibrated/adaptive). Transferred MiB includes attempted and retried tasks. Break-even means simulated adaptive job time is no greater than the fastest single-node compute baseline. Coordinator saturation is not charged to virtual job time, so speedup can be optimistic. A speedup above 1 is not evidence of GPU equivalence. Increase compute multiplier to model a more compute-heavy workload; increase bytes/unit to model communication-heavy tasks. The model assumes fixed per-node throughput and one coordinator; it does not include Internet contention, shared Wi-Fi, thermal throttling, energy, or adversarial clients.
