# Aggiornamento alpha.2

Il laboratorio software confronta gli scheduler, simula fino a 10.000 nodi, verifica 2.000 WebSocket locali tre volte e completa uno stress a 5.000 una volta, oltre ai worker thread reali e alle richieste concorrenti. Il nuovo `lab:compare` misura lo stesso Monte Carlo sequenziale e via MACN con 1/2/4 worker, disabilitando i ritardi sintetici e verificando i risultati. Vedi [ALPHA2-LAB.md](ALPHA2-LAB.md). L'indice dei nodi liberi riduce le scansioni ripetute; la prova fisica a tre dispositivi rimane aperta. La CI archivia i report.

Il primo confronto CI, 50 milioni di campioni per tre ripetizioni, ha verificato 0,88× con un worker, 1,63× con due e 2,27× con quattro sul tempo del job. Ora ripeterlo su un host di riferimento e poi su PC/notebook/smartphone fisici in LAN; confrontare speedup end-to-end, RTT task e variabilità. Solo dopo questi dati introdurre workload che trasferiscono dataset voluminosi. Aggiungere inoltre un pool dinamico semplice come baseline degli scheduler. Restano autenticazione/ruoli del broker, persistenza e coordinatori multipli con ownership/failover misurati.

---

# Roadmap dopo 1.0-alpha.1

## Alpha.2 — prova fisica ripetibile

- PC + notebook + Android/iOS, modello/OS/browser e rete annotati nel report.
- Almeno 3 coppie a seed e campioni invariati, poi prova perdita Wi-Fi e rallentamento.
- Criteri: ogni dispositivo contribuisce; somme identiche alla baseline; zero unità perse o duplicate; riassegnazioni osservabili; report JSON completo, anche se speedup ≤ 1.
- Allungare i job per avere almeno 100 RTT prima di interpretare la coda p99. Misurare dispersione dei tempi; non presentare un singolo picco come velocità generale.

## Alpha.3 — recupero e variabilità estrema

- Suddividere i task ritentati troppo lunghi mantenendo copertura senza sovrapposizioni.
- Stato dei job e ledger persistenti; ripartenza del coordinatore dopo crash.
- Identità stabile per riconnessioni con fencing di sessione, ammissione controllata dei nuovi nodi.
- Criteri: crash/ripresa a metà lavoro; stessi risultati; limiti documentati su memoria, retry e coda.

## Alpha.4 — secondo workload reale

- Portare Mandelbrot dai prototipi nel registro modulare, con parametri immutabili, risultato pixel tipizzato e verifica della composizione.
- Separare velocità per workload; calibrazione rappresentativa di tile variabili; aggiungere priorità per evitare una lunga coda finale.
- Criteri: immagine identica alla baseline, cancellazione funzionante, adattamento testato con costo non uniforme, misure incluse dei byte trasferiti.

## Alpha.5 — ComputeRTC dietro lo stesso contratto

- Conservare engine e scheduler; implementare trasporto browser-coordinator e signaling per sessioni isolate.
- Correggere buffering ICE, glare, ready/ACK inter-canale, backpressure applicativa, max frame e chunk/reassembly; prevedere TURN.
- Testare uno vs due DataChannel sullo stesso dataset con traffico bulk; confronto p50/p95/p99, throughput, memoria e numero di retry; RTT RTC misurato separatamente da WebSocket.
- Criteri: stessi test di guasto, stessi risultati e comportamento sotto code sature. Il numero di canali si sceglie dai dati.

## Prima di un'alpha pubblica

HTTPS e ruoli coordinatore/worker, isolamento dei job, controllo di accesso/rate limit, validazione più forte dei risultati, gestione token storici, pulizia delle dipendenze vendorizzate tramite una modifica separata. Il P2P decentralizzato con failover del coordinatore è un traguardo successivo, non una proprietà già ottenuta.
