# Fase B.1 — misura del pool di verifica

Esecuzione locale del 9 ottobre 2026. I numeri descrivono questo container e non sono stime per una macchina server, una rete pubblica o milioni di nodi.

## Verifica Monte Carlo

Comando: `npm run batch:verify-cost -- --samples=500000 --iterations=7`.

| Misura | Risultato |
|---|---:|
| Calcolo lato worker, mediana sincrona | 4,70 ms |
| Ricalcolo fidato sullo stesso processo, mediana | 4,65 ms |
| Rapporto fra ricalcolo e calcolo worker | 0,99× |
| Pool thread: solo calcolo, mediana | 4,02 ms |
| Pool thread: round-trip end-to-end, mediana | 4,62 ms |
| Pool thread: round-trip p95 / p99 | 43,37 / 43,37 ms |
| Attesa coda p95 / p99 | 0,03 / 0,03 ms |

Il campione contiene sette prove; p95 e p99 coincidono con il valore massimo e non sono stime stabili di coda. Il costo aritmetico del controllo è circa un ricalcolo completo: la modifica isola il coordinatore HTTP e la transazione SQLite dal lavoro CPU, ma non riduce il calcolo totale. Il valore end-to-end include il costo del passaggio al thread e l'avvio iniziale del worker.

Con ridondanza di una frazione `p` dei task, il costo aritmetico stimato sull'insieme dei nodi e del coordinatore è circa `2 + 2p` volte un singolo calcolo senza controllo: ogni risultato verificato viene ricalcolato e i task ridondanti sono eseguiti da un secondo worker e verificati entrambi.

## Probe HTTP

Comando: `npm run batch:http-load -- --clients=8 --requests=100 --tasks=50`.

- 100 richieste concluse, 50 allocazioni attese, zero errori e zero risposte non riuscite.
- Throughput locale: 710 richieste/s.
- Latenza: p50 7,87 ms; p95 32,53 ms; p99 54,15 ms; massimo 58,06 ms.
- RSS del processo: delta +19.574.784 byte; heap: delta +3.983.072 byte.

Questa prova misura richieste concorrenti di pull sul loopback e SQLite in memoria; non invia risultati worker e non misura rete remota o dispositivi reali.

## Scala virtuale del ledger

Comando: `npm run batch:load -- --tasks=25`.

| Poller virtuali | Poll/s | Task/s | Heap delta |
|---:|---:|---:|---:|
| 1.000 | 10.815 | 270,4 | 216.968 byte |
| 10.000 | 89.084 | 222,7 | 1.681.248 byte |
| 100.000 | 190.359 | 47,6 | 3.676.440 byte |

Il numero di task è 25 in ogni prova; la parte crescente è il ciclo di poll simulato sequenzialmente. Sono dati diagnostici del ledger locale, non una simulazione di connessioni concorrenti o dispositivi.

## Limiti della misura

Le prove non quantificano ancora carico prolungato sul pool, saturazione della coda, competizione fra verifier e SQLite su hardware lento, crash nel mezzo di una verifica sotto traffico, storage persistente ad alto volume o confronto fra diverse dimensioni del pool. La CI esercita invece il recupero dopo riavvio, la scadenza lease, le risposte errate e i controlli HTTP su loopback.
