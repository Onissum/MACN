// =====================================================
// MACN Mattone 1 — Signaling Server minimale
// Obiettivo: vedere i peer connessi e notificare entrate/uscite
// =====================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

// Serve i file statici nella stessa cartella
app.use(express.static(__dirname));

// Lista peer connessi
const peers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 Nuovo peer:", socket.id);

  peers.set(socket.id, {
    id: socket.id,
    connectedAt: Date.now()
  });

  // Manda al nuovo peer il suo ID
  socket.emit("my-id", socket.id);

  // Manda al nuovo peer la lista degli altri
  socket.emit(
    "peer-list",
    Array.from(peers.keys()).filter((id) => id !== socket.id)
  );

  // Avvisa gli altri che è entrato un nuovo peer
  socket.broadcast.emit("peer-joined", socket.id);

  console.log("📊 Peer totali:", peers.size);

  socket.on("get-peers", () => {
    socket.emit(
      "peer-list",
      Array.from(peers.keys()).filter((id) => id !== socket.id)
    );
  });

  socket.on("disconnect", () => {
    console.log("⚫ Peer uscito:", socket.id);

    peers.delete(socket.id);

    // Avvisa gli altri che questo peer è uscito
    socket.broadcast.emit("peer-left", socket.id);

    console.log("📊 Peer rimasti:", peers.size);
  });
});

server.listen(PORT, () => {
  console.log(`
====================================
 MACN Mattone 1 — Server attivo
====================================

Apri nel browser:

http://localhost:${PORT}/client.html

Obiettivo:
- apri due schede
- ogni scheda vede l'altra
`);
});