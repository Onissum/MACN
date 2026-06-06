# MACN Historic Prototype v11

Questa cartella conserva una versione storica del prototipo MACN sviluppato durante la fase sperimentale di ottobre.

## Nome versione

MACN v11.0 - Asymmetric Distribution for Active Work-Stealing

## Funzioni presenti

Questo prototipo includeva già:

- comunicazione WebRTC tra peer
- server di signaling tramite Socket.IO
- distribuzione di task computazionali
- benchmark Mandelbrot
- stato dei peer in tempo reale
- workload tracking
- timeline eventi
- debug realtime
- help-offer
- help-accept
- help-decline
- cooperative work-stealing
- distribuzione asimmetrica del carico

## Strategia sperimentale

La distribuzione iniziale era volutamente asimmetrica:

- peer veloce: 10% dei task
- peer medio: 30% dei task
- coordinatore: 60% dei task

L'obiettivo era far terminare prima i nodi più liberi o veloci, permettendo loro di offrire aiuto ai nodi ancora impegnati.

## Test reale

Durante la fase sperimentale MACN è stato testato collegando 7 dispositivi contemporaneamente:

- 3 PC
- 3 smartphone
- 1 tablet

Questa prova rappresenta una delle prime dimostrazioni pratiche dell'idea MACN: una rete di dispositivi comuni capace di comunicare e distribuire lavoro computazionale.
