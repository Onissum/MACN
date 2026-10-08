# Alpha.2 — verifica del 7 ottobre 2026

Base: `e940983` (alpha.1). Branch: `macn-alpha.2-lab`. Il lavoro non modifica `main` o la branch alpha.1; la PR di alpha.2 si basa sulla precedente alpha.1 ancora separata.

## Fasi e verifiche

1. **Engine e politiche:** riuso del ledger con quote uguali/calibrate, recupero delle quote non inviate e dispatch controllabile dal broker. Test di copertura, perdita nodo, arrotondamenti decimali, backpressure e limiti dei retry.
2. **Laboratorio:** un simulatore deterministico a heap ed esecuzione reale su worker thread e WebSocket. Stesso engine, politiche confrontabili, seed accoppiati, ordine ruotato e report atomici.
3. **Correzioni basate sulle prove:** task adattivi consapevoli di RTT, ultimo resto esatto nelle quote fisse, clamp al lavoro residuo, stop immediato del dispatch dopo abort. La condizione di completamento del driver multi-job legge lo stato leggero, senza costruire una dashboard completa a ogni evento; risultati e assegnazioni virtuali prima/dopo restano identici.
4. **Concorrenza:** owner round-robin, job ID separati, un solo slot globale per nodo, ammissione, cancellazione del proprietario, deadline e cronologia limitata. Test di un duplicato vecchio mentre il nodo possiede una nuova assegnazione.
5. **Interfaccia:** lettore di report JSON reale/simulato/multi, tabella di confronto, download riepilogo. Il test Playwright copre caricamento e classificazione di un report, oltre alla demo browser precedente.

## Esiti locali

- **38 test Node superati**, compresi 21 test precedenti e ulteriori regressioni/integrazioni. Nessun test saltato.
- **54 prove reali locali**: due dimensioni (10/50), tre scenari, tre ripetizioni e tre politiche. Tutte corrette e con copertura esatta.
- **72 prove simulate**: due dimensioni (100/1.000), quattro scenari, tre ripetizioni e tre politiche. Tutte corrette e con copertura esatta.
- **Due prove multiutente simulate**, a 20 e 1.000 nodi, ciascuna con cinque richieste e tre utenti logici. Tutti i job completati e verificati.
- Il primo esperimento reale di sviluppo ha individuato un resto non assegnato nelle quote decimali ed è terminato per deadline. È stato corretto, coperto da test e ripetuto; non viene conteggiato nelle 54 prove finali.
- Il confronto diagnostico precedente alla correzione RTT viene conservato separatamente; non viene mescolato ai 72 casi finali.
- I test originali ComputeRTC restano nella CI; nessun sorgente storico viene modificato.

Raw JSON, ambiente, tempi ed eccezioni: [examples/alpha2](../examples/alpha2/README.md). I benchmark reali finali sono stati eseguiti separatamente dalla matrice simulata; attività leggera di editing/documentazione era presente sullo stesso ambiente.

## Limiti espliciti

Non sono state collegate macchine fisiche esterne. Mille nodi simulati non sono mille connessioni WebSocket. Il broker non è ancora esposto come servizio pubblico autenticato e la UI ordinaria resta a una suite per volta. Non sono implementati più coordinatori, persistenza o failover. La correttezza dei risultati non è una difesa contro nodi malevoli.

## Probe del coordinatore su GitHub Actions — 8 ottobre 2026

Il commit `5d8e77c` ha superato **42/42 test Node**, la suite ComputeRTC storica, i test Playwright e il probe Socket.IO/WebSocket su 10, 100, 1.000 e 2.000 client locali. Tutte e tre le ripetizioni per dimensione hanno completato e verificato il risultato. Mediane job: **32,1 / 148,2 / 1.112,3 / 3.539,5 ms**. Mediane p95 del tempo task lato coordinatore: **4,09 / 16,53 / 118,88 / 388,04 ms**. Il JSON completo, con CPU, event loop, RSS e messaggi, è nell'artifact `alpha2-validation-artifacts` del run CI; questi dati descrivono il runner e client sullo stesso host, non una rete di dispositivi fisici.
