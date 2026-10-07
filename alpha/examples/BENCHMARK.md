# Benchmark misurato — esempio locale

**Ambiente: tre contesti Chromium isolati sullo stesso host Linux; NON tre dispositivi fisici.** Un Web Worker per contesto. PC/Notebook/Smartphone sono nomi di sessioni di test; solo il viewport del terzo è mobile. Nessuna velocità artificiale è inserita nel kernel.

Node v24.19.0; Chromium 153.0.8010.0. Workload `monte-carlo-v1`, 500.000.000 campioni per job, seed 42, tre coppie sequenziale/distribuito.

| Ripetizione | Singolo (s) | Distribuito (s) | Speedup | Risultato |
|---|---:|---:|---:|---|
| 1 | 3.494 | 1.272 | 2.747× | identico; 3 contributori |
| 2 | 3.528 | 1.330 | 2.653× | identico; 3 contributori |
| 3 | 3.529 | 1.158 | 3.047× | identico; 3 contributori |

**Speedup mediano: 2.747×.** Non è una previsione per la tua rete Wi-Fi o i tuoi dispositivi.

Il confronto include dispatch, rete locale, consegna dei risultati e merge. Esclude calibrazione e intervallo fra esecuzioni. La baseline è un vero job sul nodo selezionato. Il parallelismo beneficia dei core dello stesso host; contesa, JIT e rumore possono produrre variazioni, incluso un singolo rapporto superiore al numero dei worker. Non è una misura di efficienza universale.

Risultato: 392697127 hit su 500000000; π ≈ 3.141577016.

## RTT al termine della terza esecuzione distribuita

RTT applicativo WebSocket; percentili nearest-rank sulla finestra disponibile dall’ingresso del nodo, non solo durante il calcolo. Troppi pochi campioni per stimare robustamente p99.

| Nodo | Campioni RTT | p50 (ms) | p95 (ms) | p99 (ms) |
|---|---:|---:|---:|---:|
| PC test | 32 | 0.551 | 1.195 | 5.894 |
| Notebook test | 32 | 0.619 | 1.817 | 1.922 |
| Smartphone viewport | 32 | 0.567 | 1.099 | 1.132 |

Dati completi: [benchmark-example.json](benchmark-example.json). Riproduzione: `npm run benchmark` da `alpha/`, dopo l’installazione di Chromium per Playwright. L’output finisce in `results/` senza sovrascrivere questo esempio.
