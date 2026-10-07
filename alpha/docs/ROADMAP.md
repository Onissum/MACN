# Aggiornamento alpha.2

Il laboratorio software è ora implementato: confronti degli scheduler, simulazione fino a 1.000 nodi, worker reali locali e richieste concorrenti. Vedi [ALPHA2-LAB.md](ALPHA2-LAB.md). La verifica fisica a tre dispositivi rimane aperta.

Prossimo controllo: pool dinamico semplice come ulteriore baseline, connessioni reali crescenti con metriche di rete/OS, coda degli idle e ammissione del broker su API autenticata. Più coordinatori richiedono ownership e failover misurati; non sono ancora implementati.

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
