const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

const PORT = process.env.PORT || 3000;
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
    io.to(target).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ target, answer }) => {
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

server.listen(PORT, "0.0.0.0", () => {
  console.log(`
====================================
 MACN Mattone 4 — Multi Peer attivo
====================================
http://localhost:${PORT}/client.html
`);
});