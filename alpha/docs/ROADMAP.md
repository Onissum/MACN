# Stato del progetto

## Stato Alpha.3 Batch (prototipo locale)

Implementati: API pull HTTP, worker CLI Node, benchmark locale ed EWMA per task, pacchetti proporzionali alla velocità misurata entro un limite, job/task persistiti in SQLite, lease stimate e rinnovabili, outbox locale dei risultati, fencing, retry limitato, accettazione idempotente e simulatore per 1k/10k/100k poller virtuali. Guida: [ALPHA3-BATCH.md](ALPHA3-BATCH.md). La simulazione misura il solo loop locale coda/SQLite; non certifica capacità di rete o dispositivi. La UI e l'adaptive scheduler restano nel percorso WebSocket precedente. Mancano capability/budget dei worker, dashboard Batch e test HTTP concorrente su macchine reali. SQLite è adatto a validare il lifecycle su un coordinatore singolo; la scelta di un archivio distribuito va fatta dopo misure di contesa.

Il laboratorio software confronta gli scheduler, simula fino a 10.000 nodi, verifica 2.000 WebSocket locali tre volte e completa uno stress a 5.000 una volta, oltre ai worker thread reali e alle richieste concorrenti. `lab:compare` misura lo stesso Monte Carlo sequenziale e via MACN con 1/2/4 worker. La matrice `lab:break-even` aggiunge banda sintetica, byte per unità e intensità di calcolo per trovare il pareggio parametrico; include incomplete da churn e retry-limit invece di nasconderle. Non è una misura fisica e non addebita ancora saturazione del coordinatore al tempo virtuale. Vedi [ALPHA2-LAB.md](ALPHA2-LAB.md) e [BREAK-EVEN-LAB.md](BREAK-EVEN-LAB.md). L'indice dei nodi liberi riduce le scansioni ripetute; la prova fisica a tre dispositivi rimane aperta. La CI archivia i report.

Il primo confronto CI, 50 milioni di campioni per tre ripetizioni, ha verificato 0,88× con un worker, 1,63× con due e 2,27× con quattro sul tempo del job. La matrice simulata mostra quanto il rapporto dati/calcolo può cambiare il pareggio, e un limite concreto: le lease non includono la dimensione trasferita; in alcune celle le partizioni calibrate esauriscono i retry. Prima di workload data-heavy migliorare la stima di lease/costo di rete e includere la saturazione del coordinatore nel modello. Poi ripetere i benchmark su un host di riferimento e PC/notebook/smartphone fisici in LAN; aggiungere un pool dinamico semplice come baseline degli scheduler. Restano autenticazione/ruoli del broker, persistenza e coordinatori multipli con ownership/failover misurati.

---

# Roadmap MACN: rete asincrona prima

Il modello principale è una rete di worker volontari che prelevano lavoro quando sono disponibili, lo elaborano con i propri tempi e restituiscono risultati verificabili. Non serve che tutti i nodi siano online insieme. Adaptive/WebSocket e ComputeRTC restano modalità specialistiche per workload che hanno davvero dipendenze o scambi frequenti.

Una rete che può avere milioni di partecipanti registrati non equivale a un coordinatore capace di servire un milione di richieste simultanee. La prima misura da scalare è il numero di worker attivi e di richieste concorrenti; i dati determineranno partizionamento, coda distribuita e numero di coordinatori. L'attuale SQLite valida il lifecycle su un singolo coordinatore e non è il backend della rete a quella scala.

## Alpha.3 — fondazione Batch, prototipo locale

- **Implementato:** task pull-based, SQLite locale, lease e rinnovi, riassegnazione con fencing, outbox locale dei risultati, benchmark per workload, pacchetti proporzionali alla velocità stimata e aggiornamento EWMA.
- **Verificato:** test automatici per job, duplicati, timeout, riassegnazione, restart del ledger e tre worker HTTP simulati; simulazione sequenziale di 1k/10k/100k poller; nuova simulazione a eventi discreti per nodi eterogenei e perdita nodo, basata sulla coda Batch reale e con risultato Monte Carlo verificato.
- **Limiti:** worker CLI Node, un coordinatore, SQLite e token condiviso; il simulatore non rappresenta richieste HTTP concorrenti o capacità di Internet. Il Batch non ha ancora una dashboard dedicata.

## Alpha.4 — rete asincrona affidabile e misurabile

- Rendere Batch il percorso di avvio e osservazione principale; costruire un pannello per coda, job, worker, lease, contributi, retry, tempi e risultati parziali.
- Definire il contratto di job versionato: input immutabile, task indipendenti, validatore, merge, cancellazione e politica per risultati parziali. Nessun codice arbitrario eseguito senza sandbox.
- Aggiungere profilo e budget volontario del worker (pause, batteria/alimentazione quando disponibili, banda e spazio), backoff di polling, coda locale limitata e ripresa dell'outbox al riavvio.
- Gestire il “collo di bottiglia finale”: task abbastanza piccoli da riassegnare i ritardatari e duplicazione speculativa limitata solo per task idempotenti; non assegnare due risultati come contributi distinti.
- Separare API stateless, coda durevole e archivio di input/output; introdurre partizionamento per job e backend multi-coordinatore solo dopo test di contesa SQLite e benchmark HTTP concorrenti.
- **Criteri:** nessuna unità persa nei crash test; al massimo un risultato accettato per task; job recuperabile dopo restart; task offline consegnabili o riassegnabili; metriche di completamento, memoria, CPU e I/O del coordinatore con carichi concorrenti ripetibili. Prima prova con 3 dispositivi, poi carico controllato crescente su worker virtuali/VM.

## Alpha.5 — workload con dati e verifiche realistiche

- Aggiungere Mandelbrot/rendering come secondo workload nel contratto Batch e misurare separatamente tempo di calcolo, byte trasferiti, merge e costo di verifica.
- Versionare gli input e riutilizzare dati immutabili; scegliere dimensione dei task in base a costo di calcolo, trasferimento e variabilità osservata.
- Per calcoli non deterministici o non fidati, introdurre validazione ridondante/quorum o prove specifiche del workload; i risultati non diventano attendibili solo perché sono ben formati.

## Alpha.6 — modalità interattiva specializzata

- Conservare Adaptive/WebSocket e ComputeRTC dietro lo stesso contratto di workload, senza renderli prerequisiti della rete Batch.
- Usarli per problemi che richiedono scambio frequente; misurare quando la latenza giustifica il coordinamento e confrontare mono/doppio DataChannel, backpressure, memoria e p50/p95/p99.

## Prima di una rete pubblica

HTTPS, identità e ruoli, quote e fair scheduling, sandbox/isolation per workload, protezione dei dati, rate limiting, anti-abuso, politiche di verifica, gestione delle chiavi e dei costi del coordinamento. Il P2P decentralizzato e il failover senza coordinatore centrale restano obiettivi separati, non proprietà già ottenute.
