# BOINC come riferimento, MACN con implementazione propria

MACN studia BOINC come esperienza di volunteer computing. Questa nota registra le idee architetturali utili e le decisioni specifiche di MACN; non introduce codice BOINC nel repository.

## Principi trasferibili

- I nodi sono eterogenei e possono interrompersi senza preavviso.
- Il lavoro va diviso in unità verificabili, assegnate con scadenza e ritentabili.
- Capacità e comportamento osservati contano più di una stima iniziale immutabile.
- Il coordinatore deve distinguere lavoro assegnato, risultato ricevuto e risultato accettato.
- Per calcoli non fidati o scientificamente importanti servono strategie di validazione; la sola risposta del client non è una prova di correttezza.

BOINC documenta workunit e risultati, scheduler, trasferimento dati, validatori e assimilatori come componenti distinti. Il suo client richiede lavoro allo scheduler HTTP; i progetti possono inviare copie ridondanti e confrontare i risultati.

Riferimenti primari:

- [Come funziona BOINC](https://github.com/BOINC/boinc/wiki/How-BOINC-works)
- [Mappa dei componenti BOINC](https://github.com/BOINC/boinc/wiki/Source-code-map)
- [Introduzione per i partecipanti](https://boinc.berkeley.edu/intro.php)
- [Codice sorgente e licenza](https://github.com/BOINC/boinc)

## Cosa fa già MACN

- Ogni task ha proprietario, numero di tentativo e lease con scadenza.
- Heartbeat assenti e lease scadute rimettono il task in coda; il limite ai tentativi evita retry infiniti.
- Il coordinatore accetta un solo risultato per task e controlla job, proprietario, tentativo e forma del risultato.
- Il rate misurato aggiorna il peso dello scheduler adattivo.
- Un nodo compatibile che entra durante un job adattivo viene ora ammesso al lavoro ancora disponibile. Baseline e job con partizioni fisse conservano una coorte stabile.

Queste garanzie valgono nella memoria del coordinatore durante il processo. Un riavvio cancella job e lease: non esiste ancora un ledger persistente.

## Differenze deliberate

BOINC è progettato per throughput elevato, lavoro relativamente indipendente e client che chiedono blocchi di lavoro. La demo MACN usa un coordinatore interattivo con WebSocket persistenti, assegnazione push, feedback frequente e dashboard live. È adatto a misurare cooperazione a bassa latenza tra nodi collegati; per migliaia di volontari intermittenti servirà anche un protocollo di pull, coda durevole e trasferimento separato dei dati.

MACN non deve presumere che più nodi significhi sempre più velocità: task piccoli, rete, code, validazione e nodo finale più lento possono annullare il parallelismo. Per questo benchmark e risultati verificati restano parte del prodotto.

## Prossimi passi ispirati a BOINC

1. Ammissione e riconnessione con identità stabile e fencing della sessione.
2. Ledger durevole per job, tentativi e risultati; ripresa dopo riavvio.
3. Richiesta di lavoro lato client con lease e quantità basata su capacità, batteria e disponibilità dichiarata.
4. Validazione configurabile: controllo deterministico economico, campione ridondante oppure quorum per workload ad alto rischio.
5. Test di carico su rete simulata e dispositivi fisici prima di aumentare i limiti.

Il software BOINC è LGPL-3.0-or-later: eventuale riuso del suo codice richiederebbe una revisione degli obblighi della licenza e delle dipendenze. La fase MACN qui descritta riusa idee generali e documentazione pubblica, non porzioni di codice BOINC.
