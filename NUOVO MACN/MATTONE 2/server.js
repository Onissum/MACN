// =====================================================
// MACN Mattone 2 — Signaling + WebRTC relay
// Obiettivo: lista peer + passaggio offer/answer/ICE
// =====================================================

const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = 3000;

app.use(express.static(__dirname));

const peers = new Map();

io.on("connection", (socket) => {
  console.log("🟢 Peer connesso:", socket.id);

  peers.set(socket.id, { id: socket.id, connectedAt: Date.now() });

  socket.emit("my-id", socket.id);
  socket.emit("peer-list", Array.from(peers.keys()).filter(id => id !== socket.id));
  socket.broadcast.emit("peer-joined", socket.id);

  socket.on("get-peers", () => {
    socket.emit("peer-list", Array.from(peers.keys()).filter(id => id !== socket.id));
  });

  socket.on("offer", ({ target, offer }) => {
    console.log(`📤 Offer ${socket.id} -> ${target}`);
    io.to(target).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ target, answer }) => {
    console.log(`📥 Answer ${socket.id} -> ${target}`);
    io.to(target).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ target, candidate }) => {
    io.to(target).emit("ice-candidate", { from: socket.id, candidate });
  });

  socket.on("disconnect", () => {
    console.log("⚫ Peer uscito:", socket.id);
    peers.delete(socket.id);
    socket.broadcast.emit("peer-left", socket.id);
  });
});

server.listen(PORT, () => {
  console.log(`
====================================
 MACN Mattone 2 — Server attivo
====================================

Apri:
http://localhost:${PORT}/client.html

Obiettivo:
- due schede si vedono
- clic su peer
- DataChannel aperto
- ping/pong
`);
});