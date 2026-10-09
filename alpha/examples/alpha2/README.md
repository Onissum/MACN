# Misure MACN alpha.2

I report reali/simulati già validati hanno `complete: true` e `verified: true`. La nuova matrice break-even è un esperimento di sensibilità: `complete` significa che l'intera matrice è stata eseguita; alcune celle di churn sono intenzionalmente incomplete e hanno `verified: false`.

| Prova | Dimensioni | Esecuzioni | Verifica |
|---|---|---:|---|
| [Reale locale](real.md) / [JSON](real.json) | 10 e 50 worker thread + WebSocket | 54 | Monte Carlo identico alla verifica sequenziale, copertura esatta |
| [Simulata](simulated.md) / [JSON](simulated.json) | 100 e 1.000 nodi | 72 | Checksum sintetico e copertura esatta |
| [Richieste concorrenti](multi.json) | 20 e 1.000 nodi simulati; 5 job/3 utenti | 2 scenari | Job separati, uno slot per nodo, risultati duplicati respinti |
| [Scala 10→10.000](scale-simulated.md) / [JSON](scale-simulated.json) | 10, 100, 1.000 e 10.000 nodi simulati; carico per nodo invariato | 12 | Checksum e copertura esatta; una ripetizione per scheduler/dimensione |
| [Matrice break-even](break-even-example.md) / [JSON](break-even-example.json) | 1/4/16/64 nodi; dati e intensità di calcolo variati; steady/churn | 288 | 248 job completati; incomplete e retry-limit sono mantenuti come esiti diagnostici |

Le prove reali locali confrontano tre scheduler sugli stessi campioni; non confrontano 50 computer con uno. Il seed e i parametri coincidono all'interno di ogni terna, l'ordine ruota fra ripetizioni. I modelli simulati e il carico reale locale sono documentati in [ALPHA2-LAB.md](../../docs/ALPHA2-LAB.md).

La matrice 10→10.000 mantiene costante il lavoro medio per nodo, così gli intervalli virtuali sono confrontabili. Il suo tempo wall misura l'engine/simulatore di questo host. La prova con veri socket di loopback è invece eseguita nella CI a 10/100/1.000 e archiviata come artifact del workflow; non è inclusa in questo esempio perché dipende dal runner usato.

## Probe WebSocket del runner GitHub (8 ottobre)

Il run CI finale ha completato 42 test Node, ComputeRTC, browser e il job condiviso su 10/100/1.000/2.000 connessioni WebSocket locali, tre ripetizioni per dimensione. Mediane job: 32,3 / 153,0 / 1.156,9 / 3.617,1 ms. Mediane del p95 per round-trip task: 3,69 / 17,48 / 126,58 / 384,07 ms. Un ulteriore stress con 5.000 connessioni (una ripetizione) ha completato e verificato il job in 7.729,9 ms, con p95 task di 995,51 ms. Il JSON completo include CPU, event loop, memoria e messaggi nell'artifact GitHub Actions. Sono valori del runner e dei suoi client sullo stesso host: mostrano che questa implementazione ha retto il probe fino a 5.000 connessioni, non il massimo assoluto del coordinatore né la capacità di calcolo di 5.000 computer.

## Cosa emerge

- Nel modello stabile a 1.000 nodi, calibrazione statica e adattivo sono vicini: circa 4,079 e 4,025 secondi virtuali. La calibrazione iniziale da sola ha già molto valore.
- Se i nodi inizialmente veloci rallentano, il modello a 1.000 nodi termina in circa 43,480 secondi con quote calibrate fisse, contro 7,795 con l'adattivo.
- Ad alta latenza, l'adattivo corretto termina in 5,350 secondi virtuali contro 9,679 del calibrato. Il [report diagnostico precedente alla correzione](simulated-before-rtt-fix.json) mostra circa 24,5 secondi dell'adattivo: è evidenza di un difetto trovato e corretto, non parte della matrice finale. Il vecchio contatore dei messaggi di quel report diagnostico non includeva tutte le risposte ordinarie.
- Nei test reali locali con 50 nodi stabili, **la mediana della calibrazione statica è migliore**: 1,031 secondi contro 1,711 dell'adattivo. Non tutte le situazioni richiedono adattamento aggressivo; variabilità e contesa locale restano rilevanti.
- In una singola ripetizione reale con 50 nodi che rallentano, l'adattivo è anche più lento delle quote uguali e subisce due timeout. La prova è mantenuta nel report, con risultato finale corretto.

Queste misure non provano che la rete sia già pronta per mille connessioni Internet. Il simulatore esegue calcoli di checksum in O(1), e i thread reali condividono un solo host. Le prove reali hanno durata breve e variabilità fra ripetizioni: non si attribuisce significatività statistica universale ai rapporti osservati.

## Riprodurre

Da `alpha/`: `npm run lab:scale`, `npm run lab:real`, `npm run lab:multi -- --nodes 20,1000`. I nuovi dati vengono scritti in `results/` e non modificano questi esempi archiviati. `npm start`, poi `/lab.html`, permette di leggerli e confrontarli.

## Primo limite osservato

Nella prima implementazione, il processo locale impiegava fino a circa 6,7 secondi per le prove a 1.000 nodi; una singola chiamata dispatch arrivava a circa 182 ms. Erano costi del simulatore/engine, non latenza Internet. La matrice successiva a 10.000 nodi e la correzione sono descritte sotto.

Un successivo probe a 10.000 nodi ha trovato e corretto una scansione ripetuta degli idle: la medesima prova adattiva (1 miliardo di unità) è passata da circa 18,7 s wall/18,1 s di dispatch a circa 0,25 s wall/0,08 s di dispatch. La matrice archiviata usa un carico per nodo dieci volte maggiore e registra circa 1,8–4,7 s wall e fino a circa 559 MiB RSS a 10.000 nodi. Sono risultati del simulatore sullo stesso host, non una misura del coordinatore in rete; il JSON conserva tutte le 12 esecuzioni.

Il processo del laboratorio reale ha raggiunto circa 1,25 GiB di RSS campionato durante la matrice completa; non è una stima isolata della memoria di ogni worker. Su computer con poca memoria usare prima 10 nodi. Nella prova multiutente il conteggio dei turni durante lavoro non ancora completato può differire: un proprietario può avere già tutto il suo lavoro in volo e non richiedere nuovi slot.
