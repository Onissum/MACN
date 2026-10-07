# Misure MACN alpha.2

Tutti i file finali hanno `complete: true` e tutte le prove finali hanno `verified: true`.

| Prova | Dimensioni | Esecuzioni | Verifica |
|---|---|---:|---|
| [Reale locale](real.md) / [JSON](real.json) | 10 e 50 worker thread + WebSocket | 54 | Monte Carlo identico alla verifica sequenziale, copertura esatta |
| [Simulata](simulated.md) / [JSON](simulated.json) | 100 e 1.000 nodi | 72 | Checksum sintetico e copertura esatta |
| [Richieste concorrenti](multi.json) | 20 e 1.000 nodi simulati; 5 job/3 utenti | 2 scenari | Job separati, uno slot per nodo, risultati duplicati respinti |

Le prove reali locali confrontano tre scheduler sugli stessi campioni; non confrontano 50 computer con uno. Il seed e i parametri coincidono all'interno di ogni terna, l'ordine ruota fra ripetizioni. I modelli simulati e il carico reale locale sono documentati in [ALPHA2-LAB.md](../../docs/ALPHA2-LAB.md).

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

Nel processo locale, le prove a 1.000 nodi simulati hanno richiesto fino a circa 6,7 secondi di wall time; una singola chiamata dispatch ha raggiunto circa 182 ms nel campionamento. Sono costi del simulatore e dell'engine insieme, influenzati anche da allocazioni/GC: non misure di latenza Internet. Resta utile sostituire le scansioni dei nodi con strutture per i soli slot liberi.

Il processo del laboratorio reale ha raggiunto circa 1,25 GiB di RSS campionato durante la matrice completa; non è una stima isolata della memoria di ogni worker. Su computer con poca memoria usare prima 10 nodi. Nella prova multiutente il conteggio dei turni durante lavoro non ancora completato può differire: un proprietario può avere già tutto il suo lavoro in volo e non richiedere nuovi slot.
