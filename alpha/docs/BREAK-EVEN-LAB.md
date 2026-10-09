# Laboratorio break-even MACN

Questo laboratorio esplora quando il tempo guadagnato con più nodi supera il costo di coordinamento e trasferimento. È una simulazione deterministica di eventi: **non** equivale a una prova LAN/WAN, a un benchmark di GPU o a una misura di telefoni e PC reali.

## Esecuzione rapida

```sh
cd alpha
npm run lab:break-even -- --nodes 1,4,16 --samples 1000000 --bytes 0,16,256 --compute 1,10 --scenarios steady,churn --repeats 2
```

Il report `results/alpha2-break-even.json` conserva ogni run e il file `.md` riassume la matrice. Per una prova rapida:

```sh
npm run lab:break-even -- --nodes 1,4 --samples 200000 --bytes 0,64 --compute 1 --scenarios steady --repeats 1 --out results/break-even-smoke.json
```

## Modello esplicito

- Ogni nodo ha una velocità di calcolo di profilo (600, 300, 120 o 60 unità/ms) e banda in download/upload (80/40/20/10 e 30/15/8/4 Mbps). Le classi si ripetono ciclicamente: questo crea eterogeneità controllata, non profili statistici ricavati da hardware reale.
- Ogni task trasferisce 256 byte di controllo più metà dei byte dati per unità; ogni risultato usa 64 byte più l'altra metà. `--bytes` varia i byte totali input+output per unità.
- Il tempo di rete per trasferimento è `byte × 8 / (Mbps × 1000)` millisecondi. Il task viaggia con RTT diviso fra andata e ritorno; trasferimento e calcolo sono serializzati sul singolo task.
- `--compute` moltiplica il tempo di calcolo rispetto al profilo nominale: 20 simula un kernel 20 volte più costoso per unità e rende il rapporto compute/communication più favorevole.
- `steady`, `latency`, `slowdown` e `churn` riusano gli scenari del simulatore alpha. Churn include nodi persi e risposte perse/duplicate in momenti deterministici; non simula ancora arrivi tardivi o rientri dello stesso dispositivo.
- La baseline è il tempo di calcolo stimato sul nodo simulato più veloce con dati locali. La misura MACN include le unità distribuite, RTT, banda e retry, ma non startup del coordinatore, congestione condivisa, trasferimento di dataset una tantum, consumi energetici o concorrenza con altre app.
- Ogni cella confronta scheduler equal, calibrated e adaptive con lo stesso seed e profili. Il break-even è il minimo `nodi` nella matrice per cui la mediana dello speedup adaptive è almeno 1. Se nessuna cella lo raggiunge, il report dice `none`.

## Come leggere i numeri

Un break-even a 16 nodi significa soltanto che **con questi parametri simulati** lo scheduler raggiunge la baseline a partire da 16 nodi. Non predice che una rete pubblica con 16 volontari lo farà: RTT, uplink, rate termico, disponibilità e geografia possono cambiare molto. `compute` e `bytes` sono manopole per studiare sensibilità, non proprietà misurate di un workload reale. Il simulatore non addebita la saturazione del coordinatore al tempo virtuale: gli speedup possono essere ottimistici, soprattutto quando cresce il numero di worker.

La baseline è volutamente favorevole al singolo nodo: dati già locali e nessun coordinamento. La matrice serve a scartare architetture o classi di lavoro chiaramente inadatte e a preparare le misure fisiche, non a proclamare equivalenza con una GPU.

## Limiti da affrontare dopo

- Il modello usa velocità indipendenti per nodo e non contesa di access point o uplink, code Internet, correlazione geografica, throttling termico/energetico o risvegli del browser.
- Il costo dati è per unità di lavoro; manca il modello per input condiviso scaricato una sola volta e cache riutilizzate.
- Le lease MACN sono dimensionate sul throughput osservato e RTT, non sulla dimensione trasferita. Un risultato della matrice che causa retry per task molto grandi segnala una lacuna dello scheduler da risolvere prima di considerare affidabile la previsione.
- Il coordinatore resta singolo; la simulazione non misura shard, replica del ledger, failover né sicurezza contro nodi ostili.
- Il workload è un checksum O(1), utile per controllare copertura e tempi modellati. Non misura costo CPU reale; il moltiplicatore lo rappresenta solo come parametro astratto.

## Prossimo miglioramento della simulazione

Calibrare profili di rete e compute da misure su dispositivi reali, simulare arrivi/rientri con identità e lease, aggiungere input condivisi cacheabili e un workload CPU reale. Confrontare queste previsioni con una matrice di prove su una LAN controllata; mantenere distinti nel report risultati simulati e misurati.
