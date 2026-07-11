// =============================================================
// 🌐 MACN Signaling Server (Anti-Peer Fantasma 4.0 definitivo)
// =============================================================
// Requisiti:
//   npm install express socket.io
// =============================================================

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);

// =============================================================
// 🔐 Blocco handshake diretto da ngrok o bot
// =============================================================
// Permette handshake WebSocket solo se la richiesta proviene
// da /client.html o da una pagina che lo include.
server.on('upgrade', (req, socket) => {
  const ua = req.headers['user-agent'] || '';
  const referer = req.headers['referer'] || '';
  const origin = req.headers['origin'] || '';

  const looksLikeBrowser = ua.includes('Mozilla') && origin.startsWith('http');
  const fromClientPage = referer.includes('/client.html') || referer.includes('localhost') || referer.includes('ngrok-free.dev');

  if (!looksLikeBrowser || !fromClientPage) {
    console.log('\n🚫 Handshake WebSocket bloccato (non proveniente da client.html):');
    console.log('   UA:', ua);
    console.log('   Referer:', referer);
    console.log('   Origin:', origin);
    socket.destroy();
  }
});

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// Porta dedicata alla v0.5.2, così non può rispondere un vecchio server.
const PORT = 3002;

// =============================================================
// Servizio dei file statici (client.html, script.js, ecc.)
// =============================================================
app.use(express.static(__dirname));

// =============================================================
// Mappa peer connessi
// =============================================================
const peers = new Map();

// =============================================================
// Gestione connessioni valide
// =============================================================
io.on('connection', (socket) => {
  console.log(`\n🟢 Nuovo peer connesso: ${socket.id}`);

  peers.set(socket.id, {
    id: socket.id,
    status: 'available',
    connectedAt: new Date()
  });

  // Invia al nuovo peer la lista degli altri
  socket.emit('peer-list', Array.from(peers.keys()).filter(id => id !== socket.id));

  // Notifica gli altri peer del nuovo arrivato
  socket.broadcast.emit('peer-joined', socket.id);

  console.log(`📊 Peer totali: ${peers.size}`);

  // OFFER
  socket.on('offer', (data) => {
    console.log(`📤 Offer da ${socket.id} verso ${data.target}`);
    io.to(data.target).emit('offer', { offer: data.offer, from: socket.id });
  });

  // ANSWER
  socket.on('answer', (data) => {
    console.log(`📥 Answer da ${socket.id} verso ${data.target}`);
    io.to(data.target).emit('answer', { answer: data.answer, from: socket.id });
  });

  // ICE
  socket.on('ice-candidate', (data) => {
    console.log(`🧊 ICE da ${socket.id} verso ${data.target}`);
    io.to(data.target).emit('ice-candidate', { candidate: data.candidate, from: socket.id });
  });

  // RICHIESTA LISTA
  socket.on('get-peers', () => {
    socket.emit('peer-list', Array.from(peers.keys()).filter(id => id !== socket.id));
  });

  // DISCONNESSIONE
  socket.on('disconnect', () => {
    console.log(`\n⚫ Peer disconnesso: ${socket.id}`);
    peers.delete(socket.id);
    socket.broadcast.emit('peer-left', socket.id);
    console.log(`📊 Peer rimasti: ${peers.size}`);
  });
});

// =============================================================
// Avvio del server
// =============================================================
server.listen(PORT, '0.0.0.0', () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║        🌐 MACN Signaling Server ATTIVO           ║
╚══════════════════════════════════════════════════╝

📡 Server in ascolto su: http://localhost:${PORT}
📂 File client: apri client.html nel browser

💡 Istruzioni:
   1. Avvia Coturn (sudo systemctl start coturn)
   2. Avvia questo server (node signaling-server.js)
   3. Avvia Ngrok, se necessario (ngrok http 3002)
   4. Apri http://localhost:3002/client.html in un browser
   5. Connetti peer da più dispositivi per testare il P2P

🔥 Pronto per distribuire calcoli in rete!
  `);
});
