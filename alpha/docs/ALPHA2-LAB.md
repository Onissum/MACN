# MACN alpha.2 — laboratorio di scalabilità

Il traguardo è misurare la capacità di organizzare una rete più grande e più richieste. Non certifica ancora una rete Internet di mille dispositivi. La demo browser alpha.1 continua a funzionare; il laboratorio usa **lo stesso TaskEngine**, non un secondo scheduler inventato solo per il benchmark.

## Avvio rapido

Dalla cartella `alpha`, dopo `npm ci`:

```sh
npm test
npm run lab:scale
npm run lab:real
npm run lab:multi
npm start
```

Non eseguire i benchmark reali contemporaneamente ad altre prove pesanti. `lab:real` crea fino a 50 thread e connessioni locali: su un PC con poca memoria partire con `npm run lab:real -- --nodes 10 --repeats 1`. L'intera matrice richiede più tempo di un semplice test unitario.

Aprire `http://localhost:3003/lab.html` e selezionare un report JSON dalla cartella `results`. La pagina distingue tempi virtuali e misurati, mostra tutte le politiche, segnala report incompleti ed esporta un riepilogo Markdown. I report sono letti nel browser; non vengono caricati al server.

## Tre prove distinte

| Comando | Cosa esegue | Cosa dimostra | Cosa non dimostra |
|---|---|---|---|
| `lab:real` | 10 e 50 WebSocket reali, un worker thread per nodo, Monte Carlo reale | Correttezza end-to-end, recupero di risultati persi, comportamento degli scheduler con ritardi controllati | Prestazioni di 50 computer fisici, rete Wi-Fi/WAN, scaling della potenza con nodi indipendenti |
| `lab:scale` | 100 e 1.000 nodi in una simulazione deterministica a eventi | Gestione di task, nodi lenti/persi, tempi di coordinamento sul processo locale e risultati previsti dal modello | 1.000 socket reali, costi reali del sistema operativo/rete, speedup Monte Carlo su 1.000 dispositivi |
| `lab:multi` | Cinque richieste concorrenti di tre utenti logici su slot condivisi | Separazione dei job, ammissione, turni per utente, recupero, fencing dei duplicati | Identità autenticate, equità in CPU-secondi, più coordinatori o disponibilità pubblica |

### Parametri

`npm run lab -- --mode simulated --nodes 100,1000 --scenarios steady,slowdown,churn,latency --repeats 3 --seed 42 --out results/prova.json`

- `--mode`: `simulated`, `real`, `multi`.
- `--nodes`: elenco separato da virgole; massimo 50 reali locali o 1.000 nel CLI simulato. Multi richiede almeno 2.
- `--repeats`: da 1 a 10, default 3 per confronti scheduler. Multi esegue un workload concorrente per dimensione; non usa scenari o ripetizioni.
- `--samples`: opzionale, stesso totale per tutte le politiche. Default simulato: nodi × 1.000.000; reale: nodi × 5.000.000; multi: 2.000.000 per job.
- `--seed`: default 42, incrementato per ripetizione; ogni confronto è accoppiato sullo stesso seed.
- `--out`: percorso JSON. La CLI salva atomicamente dopo ogni prova, con `complete: false` finché manca una parte. Se una verifica fallisce, interrompe con exit code nonzero conservando i risultati parziali. Salvare con nomi diversi per conservare sessioni precedenti.

## Confronto equo delle politiche

**Equal:** quote totali uguali per nodo, assegnate all'inizio. **Calibrated:** quote totali proporzionali alla calibrazione iniziale. Entrambe continuano a dividere le proprie quote in task limitati, ma non trasferiscono il lavoro solo perché un altro nodo è libero. Il recupero di task persi e delle quote non ancora inviate di nodi disconnessi è comune a tutte le politiche.

**Adaptive:** pool comune, dimensione dinamica dei task, EWMA e correzione per RTT; i nodi liberi ricevono altro lavoro senza aspettare il completamento di una quota statica.

Condividono kernel, seed, totale, engine, numero di slot, limiti dei task e regole di correttezza. Nei confronti reali ogni terna condivide le stesse velocità di calibrazione iniziali, misurate nella prima prova della terna. Tutti i thread eseguono comunque warm-up. L'ordine delle tre politiche ruota a ogni ripetizione. Si riportano tutte le prove, anche quelle in cui l'adattivo non vince. Il rapporto uguale/adattivo è la mediana dei rapporti **accoppiati**, non il rapporto tra mediane disgiunte.

Il confronto con quote statiche non prova superiorità rispetto a tutti gli scheduler dinamici esistenti. Un prossimo controllo utile è un semplice pool dinamico a task fissi. Gli scenari sono piccoli modelli espliciti, non una distribuzione rappresentativa di Internet.

## Scenari e guasti

Simulazione:

- Capacità ripetute 600, 300, 120, 60 unità/ms. RTT 4–15 ms, oppure 80–239 ms nello scenario `latency`, generato dal seed.
- `slowdown`: i nodi inizialmente più veloci scendono all'8% della capacità dopo 300 ms virtuali; la durata tiene conto anche del rallentamento durante un task.
- `churn`: un nodo su dieci scompare a 600 ms; metà delle perdite è silenziosa e richiede heartbeat timeout. Altri nodi perdono il primo risultato o lo duplicano.
- Il workload `range-check-v1` verifica checksum e copertura esatta di intervalli in O(1). Tempi di calcolo e rete sono virtuali. Non viene spacciato per Monte Carlo calcolato davvero.

Nodi reali locali:

- Monte Carlo su thread distinti, Socket.IO/WebSocket di loopback, ritardo addizionale di consegna 4 ms.
- Fattori artificiali di durata 1, 2, 4, 8; calibrazione effettiva iniziale coerente con tali fattori.
- `slowdown`: dopo 50 ms, il gruppo inizialmente veloce applica un ulteriore fattore 20 alla consegna dei task successivi alla soglia. È ritardo artificiale, non CPU throttling del sistema operativo.
- `churn`: chiusura di un client su dieci dopo 100 ms, primo risultato perso su un altro gruppo e duplicati su un terzo.
- Calibrazione e verifica sequenziale finale sono **fuori** dal tempo del job distribuito. Il tempo del solo kernel di verifica non viene presentato come una baseline equivalente di speedup.

## Correzioni guidate dalle misure

1. Alpha.1 ricalcolava la somma delle velocità dei nodi liberi per ogni assegnazione. Ora prepara la lista e la somma una volta per dispatch. Rimane una scansione O(N) per dispatch: non è ancora una coda degli idle O(1).
2. La velocità consegnata include RTT. Usarla anche per ridurre i task creava un feedback negativo con alta latenza. Ora la dimensione usa una stima separata del servizio (`elapsed - RTT`, minimo 1 ms) e una finestra di almeno quattro RTT. Il peso continua a usare throughput consegnato. RTT è una stima e non separa perfettamente rete, code e CPU.
3. Quote statiche con pesi decimali potevano lasciare l'ultima unità senza proprietario. L'ultimo intervallo ora riceve il resto intero esatto, con test di regressione.
4. I client di laboratorio con ruolo `worker` non ricevono l'intera dashboard. Snapshot e broadcast vengono prodotti solo quando esiste un osservatore, evitando traffico inutile fra nodi di calcolo. È un'ottimizzazione di sottoscrizione, non un ruolo di sicurezza.

I dati precedenti alla correzione RTT sono conservati come evidenza diagnostica separata, non mescolati al confronto finale. Le esecuzioni di sviluppo interrotte o fallite non vengono conteggiate come benchmark superati.

## Richieste concorrenti

`src/broker.js` introduce `JobBroker`: `addNode`, `submit`, `accept`, `heartbeat`, `removeNode`, `cancel`, `tick`, `snapshot`. Usa un TaskEngine per richiesta con dispatch manuale. Uno slot globale per nodo impedisce assegnazioni simultanee a job diversi. Il round-robin sceglie prima il proprietario, poi una sua richiesta: aprire molti job non moltiplica automaticamente i turni.

Identificatori diversi per richiesta/job/task/tentativo; un risultato vecchio non libera uno slot nuovo. Cancellazione consentita al proprietario indicato, limite 32 richieste attive e 8 per proprietario, deadline di 5 minuti; cronologia terminale limitata a 64 richieste di default. Questi limiti non equivalgono a un sistema pubblico di autenticazione o antiabuso. Il broker è eseguibile nel laboratorio e testato; la dashboard browser ordinaria resta a una suite per volta.

## Metriche e limiti di scala

JSON simulato: tempo virtuale, tempo reale del simulatore, CPU del processo, tempo totale/massimo delle chiamate dispatch, numero di eventi/messaggi, picco della coda eventi, RSS campionato, task, retry, duplicati e checksum. I costi includono il simulatore; non sono il throughput di un cluster fisico. RSS è del processo locale, con campionamento e possibili residui dell'allocatore fra prove, non memoria isolata per singolo nodo.

JSON reale: tempo totale, throughput, CPU processo, utilizzo/event-loop delay del coordinatore, RTT aggregato di loopback, RSS campionato, calibrazione e conteggi di guasti. I thread competono sullo stesso host; timer e scheduling locale influenzano i risultati. Il report indica campioni e ambiente.

Resta da misurare: mille connessioni reali, WAN, browser mobili, più coordinatori, persistenza/failover, una distribuzione realistica dei workload e confronto con un pool dinamico semplice. Il limite predefinito del server demo resta 64 connessioni: i mille nodi qui sono **simulati**, non un innalzamento non verificato del limite.

## Lettura dei risultati

Gli esempi archiviati in `examples/alpha2/` accompagnano questa versione. Le medie/mediane di wall time di un singolo host non sono stime affidabili di Internet. In particolare il confronto locale ha variabilità fra ripetizioni e può favorire la calibrazione statica in singole prove: questi casi restano nel JSON.

La simulazione ha carico proporzionale al numero dei nodi. Quindi un tempo virtuale simile con 100 e 1.000 nodi è previsto dal modello: il carico totale cresce di dieci volte. Il costo reale del coordinamento si valuta invece da wall time, CPU e dispatchMs, non dal tempo virtuale. Aggiungere più coordinatori richiederà prima misure con socket reali crescenti e una definizione esplicita di ownership/failover.
