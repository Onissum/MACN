# MACN 1.0-alpha.2

Novità alpha.2: [laboratorio di scalabilità](docs/ALPHA2-LAB.md), tre scheduler confrontabili, prove con 10/50 worker di calcolo locali, 100/1.000/10.000 nodi simulati e fino a 2.000 connessioni WebSocket locali di control plane; broker sperimentale per richieste concorrenti e lettore report su `/lab.html`. La CI esegue il probe a 10/100/1.000/2.000 e conserva il report. Queste misure non equivalgono a dispositivi fisici distinti.

Prima alpha eseguibile e misurabile: più browser collaborano a **un solo job**, con calibrazione, assegnazione adattiva, recupero dei task persi e confronto verificato con un nodo solo.

**Topologia di questa alpha:** coordinatore Node.js e nodi browser collegati via Socket.IO/WebSocket. Non è ancora la versione P2P decentralizzata. I prototipi WebRTC/ComputeRTC sono conservati senza modifiche; motivazioni, architettura precedente e valutazione dei DataChannel in [ARCHITECTURE-AUDIT.md](docs/ARCHITECTURE-AUDIT.md).

## Avvio del coordinatore

Requisiti: Node.js 22 o successivo con npm; browser moderno con Web Worker su PC, notebook e smartphone. Sul telefono non serve installare Node.js.

Dalla cartella del repository:

```sh
git switch macn-alpha.2-lab
cd alpha
npm ci
npm test
npm start
```

Il server ascolta sulla porta **3003** e mostra un **token di sessione**. Apri `http://localhost:3003` sul PC. Il browser del PC è un nodo di calcolo; il processo server coordina e non esegue il kernel.

Il token è generato ad ogni avvio. Facoltativamente impostare `MACN_TOKEN` nell'ambiente per mantenere lo stesso token, oppure `PORT` per una porta diversa. Non occorrono servizi CDN, STUN, TURN, account o tunnel per la demo LAN. Il client Socket.IO viene servito localmente.

Per il test di capacità, esegui `npm run lab:capacity`: apre WebSocket di loopback veri a 10, 100, 1.000 e 2.000 client e ripete ogni dimensione tre volte. Tutti i client condividono un solo host e calcolano un checksum O(1), quindi il report misura connessioni, task e costo del coordinatore, non potenza CPU/GPU aggregata. I file escono in `results/alpha2-capacity.json` e `.md`. La simulazione discreta può estendersi a 10.000 nodi con `npm run lab:scale -- --nodes 1000,10000 --scenarios steady --repeats 1`.

## Prova precisa con tre dispositivi fisici

1. Collega PC, notebook e smartphone alla **stessa rete locale**, evitando una rete ospiti che isola i dispositivi.
2. Avvia il coordinatore sul PC. Su Windows esegui `ipconfig` e cerca l'indirizzo IPv4 della scheda Wi-Fi/Ethernet attiva, per esempio `192.168.1.20`. Se richiesto, consenti Node.js nel firewall solo sulla rete privata.
3. Sul PC apri `http://localhost:3003`; su notebook e telefono apri `http://192.168.1.20:3003`, sostituendo l'indirizzo con quello reale. `localhost` sul telefono indica il telefono, non il PC.
4. In ciascun browser inserisci un nome distinto e lo stesso token. Premi **Collega e misura**. Aspetta **Pronto** e verifica **3 nodi online**. Una sola scheda per dispositivo.
5. Lascia le schede in primo piano, schermi accesi, risparmio energetico disattivato durante la prova. Non usare altre applicazioni pesanti.
6. Dal PC scegli il nodo di riferimento (consigliato il più veloce), **500000000 campioni**, seed **42**, **3 ripetizioni**. Premi **Avvia confronto** una volta sola.
7. Ogni ripetizione esegue prima il job completo sul riferimento e poi lo stesso job sul gruppo. Verifica tre contributori, risultati identici, task completati, throughput, tempi e speedup. Per dispositivi lenti puoi partire da 50000000 campioni; per osservare più a lungo lo scheduler sali fino a 2000000000.
8. Premi **Esporta JSON**. Il coordinatore salva anche i report completati in `alpha/results/benchmark-<timestamp>.json`.
9. Ripeti con gli stessi parametri. Registra modelli dei dispositivi, sistema/browser, alimentazione e condizioni della rete: il nome del nodo non prova che i dispositivi siano diversi.

**Test di guasto separato:** scegli il PC come riferimento. Durante la fase **Distribuito** disconnetti il telefono dal Wi-Fi o premi **Disconnetti** mentre lavora. Il nodo deve diventare offline e i suoi task passare ai superstiti; il risultato finale deve coincidere con la baseline. In caso di perdita senza chiusura pulita l'attesa dipende da heartbeat e lease, generalmente alcuni secondi. Il confronto segnala `cohortChanged`: non confondere questa prova con la misura senza guasti.

Un nodo riconnesso riceve una nuova identità: parteciperà al **benchmark successivo**, perché la coorte del benchmark in corso rimane definita. Se scompaiono tutti i nodi selezionati la prova termina con un errore esplicito. Se sparisce il nodo di riferimento durante la baseline, la prova non può produrre un confronto valido.

## Cosa misura

- **Potenza stimata:** campioni/s del workload, non GHz/GFLOPS o “GPU equivalente”. Calibrazione: warm-up e mediana di cinque misure; aggiornamento EWMA dopo ogni task.
- **Velocità ultima:** unità accettate / tempo coordinatore fra invio e risultato, compresi rete e attese.
- **Quota stimata:** peso relativo della velocità corrente; guida la dimensione del prossimo task. Sono previsti limiti minimo/massimo, perciò la quota non impone una divisione finale esatta.
- **Carico slot:** 0 oppure 100% per il singolo Web Worker. Nel JSON c'è anche il rapporto fra tempo di calcolo dichiarato e durata del job. Nessuno dei due valori è un contatore CPU dell'intero dispositivo.
- **Latenza:** RTT applicativo ping/pong, timer monotono del coordinatore, probe ogni 500 ms; p50/p95/p99 nearest-rank sugli ultimi 600 campioni. Non è latenza one-way o RTC. La dashboard mostra il numero di campioni: p99 con poche osservazioni non è una stima robusta.
- **Tempo totale:** dal primo invio al completamento/merge, comprensivo di rete e riassegnazioni; calibrazione, intervallo fra le prove e aggiornamento UI esclusi.
- **Throughput:** campioni accettati / tempo totale.
- **Speedup:** tempo baseline / tempo distribuito, solo dopo uguaglianza esatta di conteggio e hit Monte Carlo. Può essere minore di 1. Il report conserva le coppie e la mediana.
- **Task assegnati:** tentativi inviati, incluse riassegnazioni; **completati:** contributi unici accettati. Il totale dei task viene creato progressivamente; l'avanzamento usa unità di lavoro, non il numero variabile di task.

Il seed e l'indice assoluto determinano ciascun campione; partizionamento, ordine e retry non cambiano la somma. La stima di π è una dimostrazione, non un generatore casuale validato per simulazioni scientifiche. Si confrontano due esecuzioni della stessa implementazione; non si pretende una prova contro nodi malevoli.

## Test e benchmark automatici

```sh
npm test
npx playwright install chromium
npm run test:browser
npm run benchmark
```

- `npm test`: test deterministici di scheduler e task engine, orchestrazione, vere connessioni WebSocket, disconnessione durante task, nodo fermo ma vivo, duplicati, retry, timeout, isolamento dei job e regressioni ComputeRTC.
- `test:browser`: tre contesti browser isolati, Web Worker reali, due suite consecutive, download JSON, layout desktop/mobile, disconnessione. Salva screenshot in `results/`.
- `benchmark`: tre coppie baseline/distribuito da 500 milioni di campioni; salva `results/benchmark-example.json`. **Tre contesti sullo stesso computer non sono tre dispositivi fisici.**
- È possibile indicare un Chromium già disponibile con `CHROMIUM_PATH` nell'ambiente. L'esecuzione qui ha usato Chromium 153; il setup standard usa quello installato da Playwright.

Regressione storica: dalla cartella `macn-computertc-v0.5.2`, esegui `node test-computertc.js`.

Risultato misurato e condizioni: [examples/BENCHMARK.md](examples/BENCHMARK.md). Esiti e limiti delle verifiche: [docs/VALIDATION.md](docs/VALIDATION.md).

## Struttura e aggiunta di workload

`src/scheduler.js` è indipendente dalla rete. `engine.js` gestisce lease e risultati; `network.js` è l'adapter. `coordinator.js` orchestra gli esperimenti. `public/compute-worker.js` esegue il codice senza bloccare il browser.

Il registro in `src/workloads.js` contiene moduli versionati con `validate`, `totalUnits`, `makeTask`, `compute`, `validResult`, `merge`. Per aggiungere un workload: implementa questi metodi, il suo task di calibrazione e il criterio di uguaglianza della baseline; registra e seleziona il workload nell'orchestratore/interfaccia. La prima UI e il profilo nodo sono deliberatamente Monte Carlo. Rete, lease e algoritmo di scheduling restano riutilizzabili. Nessun codice remoto caricato via eval.

## Limiti e problemi aperti

- Manca ancora il collaudo su **tre dispositivi fisici eterogenei**; qui sono stati verificati browser e socket sullo stesso host.
- Coordinatore unico, stato del job in memoria; nessuna ripresa dopo riavvio del server, elezione o failover.
- Una sessione/calcolo per scheda, un solo job/suite alla volta, massimo 64 connessioni contemporanee. Niente pooling multicore/GPU/native workers.
- Demo per rete fidata: token condiviso, tutti i partecipanti possono avviare/interrompere. HTTP LAN non cifra il token; per una distribuzione esterna servono HTTPS, ruoli, isolamento, rate limit e revisione della sicurezza. Non esporre direttamente la porta a Internet.
- I risultati sono controllati per struttura e confrontati con una baseline, non autenticati matematicamente: un nodo ostile resta fuori dallo scopo.
- Browser mobili in background possono essere sospesi; il sistema recupera il lavoro, non può impedirlo.
- Un task troppo grande per un nodo può consumare retry fino al limite di 8; futura suddivisione dei task ritentati necessaria per eterogeneità estrema.
- Limite di 5 minuti per job; dataset massimo 2 miliardi di campioni. Workload troppo brevi sono dominati dall'overhead e generano pochi campioni RTT.
- Log live limitati a 300 eventi, RTT a 600 campioni/nodo, ultimi 10 report in memoria; report completi delle misure salvati su disco. Non esiste ancora un archivio di tutti gli eventi/task.
- ComputeRTC non è il trasporto di questa alpha. Valutazione RTC sotto carico e confronto mono/doppio canale restano da eseguire.
- Il file storico associato al token ngrok deve essere gestito dal proprietario con rotazione/revoca. La cronologia Git non è stata riscritta.

## Fase successiva

Vedi [docs/ROADMAP.md](docs/ROADMAP.md): prima il protocollo fisico a tre dispositivi, poi robustezza/persistenza, secondo workload e adapter ComputeRTC con misure comparabili.
