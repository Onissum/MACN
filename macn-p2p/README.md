# MACN P2P Prototype

Questa cartella contiene il primo prototipo sperimentale di MACN basato su WebRTC.

## Componenti principali

- `signaling-server.js`  
  Server Node.js basato su Express e Socket.IO, usato per il signaling tra peer.

- `client.html`  
  Client browser sperimentale per collegare più dispositivi alla rete MACN.

- `start-macn.bat`  
  Script Windows per avviare il server MACN.

- `start-tunnel.bat`  
  Script Windows per avviare il tunnel esterno tramite ngrok.

- `start-coturn.sh`  
  Script sperimentale per ambiente Linux/TURN server.

## Dipendenze

Il prototipo usa:

- Node.js
- Express
- Socket.IO
- WebRTC lato browser

## Primo test reale

Durante la fase sperimentale sono stati collegati contemporaneamente 7 dispositivi:

- 3 PC
- 3 smartphone
- 1 tablet

L'obiettivo era verificare la comunicazione tra dispositivi diversi usando WebRTC e un server di signaling.

## Note

Questa cartella contiene file sperimentali, copie e versioni successive del client create durante lo sviluppo.

Il progetto verrà progressivamente ripulito e organizzato nelle prossime versioni.
