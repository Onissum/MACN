# MACN + ComputeRTC v0.5.2 — milestone sperimentale

Questa cartella conserva come esperimento separato ComputeRTC v0.5.2, uno strato di trasporto orientato al calcolo costruito sopra i DataChannel WebRTC standard. ComputeRTC non sostituisce WebRTC: aggiunge corsie logiche, priorità, controllo delle code e messaggi adatti al calcolo distribuito.

## Funzionalità ComputeRTC

- due DataChannel per ogni peer: `computertc-control` e `computertc-data`;
- quattro corsie logiche: heartbeat, controllo critico, checkpoint e task;
- intestazione binaria `CRTC` con versione del protocollo e numero della corsia;
- priorità del controllo critico rispetto ai dati di calcolo;
- controllo di `bufferedAmount`, code limitate e backpressure;
- statistiche su pacchetti, byte, code e scarti;
- compatibilità con i messaggi JSON di MACN;
- ritorno `TASK_RESULT` da ogni worker al coordinatore;
- conteggio centralizzato dei risultati unici;
- messaggio finale `JOB_COMPLETE` inviato a tutti i peer;
- aggiornamenti del carico circa 30 ms dopo ogni variazione;
- heartbeat di sicurezza ogni 800 ms;
- richieste Help identificate e non duplicate mentre sono in volo;
- risposta Help con carico residuo aggiornata immediatamente.

## Prova convalidata

La versione è stata collaudata con due peer su un job Mandelbrot distribuito. Il coordinatore ha raccolto **40/40 risultati unici** e il flusso si è concluso con i messaggi `COMPLETED` e `JOB COMPLETE`.

Solo quando entrambi i canali `CONTROL` e `DATA` sono aperti un peer viene considerato pronto per il calcolo.

## Demo immediata nel browser

Apri la [demo ComputeRTC su GitHub Pages](https://onissum.github.io/MACN/macn-computertc-v0.5.2/demo.html) e premi **Avvia demo**. Il sorgente autonomo è disponibile in [`demo.html`](demo.html). La pagina crea due peer collegati da veri WebRTC DataChannel nello stesso browser e mostra dal vivo:

- traffico `CONTROL` e `DATA` su canali separati;
- distribuzione e calcolo di 40 task Mandelbrot;
- aggiornamenti del carico e richiesta Help anti-duplicato;
- work-stealing dal Coordinator al Worker;
- raccolta centralizzata dei risultati fino a `40/40`;
- messaggi finali `COMPLETED` e `JOB COMPLETE`.

La demo è autonoma e non richiede il server di signaling. È una rappresentazione locale a due peer; per la prova tra dispositivi fisici diversi usa `client.html` e `signaling-server.js`.

## Avvio locale

È richiesto Node.js. Dalla cartella di questa versione:

```text
npm install
node test-computertc.js
node signaling-server.js
```

In alternativa, su Windows, `START_TEST_COMPUTERTC.bat` installa le dipendenze se mancanti, avvia il server sulla porta dedicata `3002` e apre due peer nel browser.

## File inclusi

- `client.html`: client browser MACN e logica del calcolo distribuito;
- `demo.html`: dimostrazione autonoma a due peer nello stesso browser;
- `computertc-transport.js`: trasporto ComputeRTC sopra WebRTC DataChannels;
- `signaling-server.js`: server Express e Socket.IO per signaling e file statici;
- `test-computertc.js`: test del formato del protocollo e dei messaggi principali;
- `START_TEST_COMPUTERTC.bat`: avvio rapido del test locale su Windows;
- `package.json` e `package-lock.json`: dipendenze Node.js riproducibili.

## Stato

ComputeRTC v0.5.2 è una milestone sperimentale, mantenuta separata dalle versioni storiche e dagli altri prototipi MACN.
