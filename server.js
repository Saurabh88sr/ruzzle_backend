const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();

/* ===============================
   EXPRESS CORS (REST APIs)
================================ */
app.use(
  cors({
    origin: "*",
    credentials: true,
  })
);



app.get("/", (req, res) => {
  res.send("Ruzzle Backend is running");
});

const server = http.createServer(app);

/* ===============================
   SOCKET.IO CORS (CRITICAL FIX)
================================ */
const io = new Server(server, {
  cors: {
    origin: (origin, callback) => {
      const allowedOrigins = [
        "http://localhost:5173",
      ];

      // polling requests me origin null hota hai
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("CORS not allowed: " + origin));
      }
    },
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["polling", "websocket"],
});



/* ===============================
   GAME STATE
================================ */
const players = {};
const rooms = {};
const scores_detial_list = {};

/* ===============================
   SOCKET EVENTS
================================ */
io.on("connection", (socket) => {
  console.log("Player Connected:", socket.id);

  /* ---------- JOIN ---------- */
  socket.on("join", (playerData) => {
    const player = {
      socketId: socket.id,
      id: playerData.id,
      name: playerData.name,
      joinedAt: new Date().toISOString(),
      currentRoom: null,
    };

    players[socket.id] = player;

    socket.emit("my_profile", player);

    socket.broadcast.emit("join_player", player);

    const onlineWithoutSelf = Object.values(players).filter(
      (p) => p.socketId !== socket.id
    );

    socket.emit("online_players", onlineWithoutSelf);
    socket.broadcast.emit("online_players", Object.values(players));
  });

  /* ---------- CREATE ROOM ---------- */
  socket.on("create_room", ({ targetSocketId }) => {
    const fromPlayer = players[socket.id];
    const toPlayer = players[targetSocketId];

    if (!fromPlayer || !toPlayer) return;

    if (socket.id === targetSocketId) {
      socket.emit("error_msg", "You cannot play with yourself");
      return;
    }

    if (fromPlayer.currentRoom || toPlayer.currentRoom) {
      socket.emit("error_msg", "One of the players is already in a room");
      return;
    }

    io.to(targetSocketId).emit("game_request", {
      from: socket.id,
      name: fromPlayer.name,
    });
  });

  /* ---------- ACCEPT REQUEST ---------- */
  socket.on("accept_request", ({ from }) => {
    const accepter = players[socket.id];
    const requester = players[from];

    if (!accepter || !requester) return;

    if (accepter.currentRoom || requester.currentRoom) {
      socket.emit("error_msg", "Room already joined");
      return;
    }

    const roomId = `room_${from}_${socket.id}`;

    rooms[roomId] = {
      players: [from, socket.id],
      turn: from,
      serialNo: 0,
      board: Array(81).fill(null),
      scores: {
        [from]: 0,
        [socket.id]: 0,
      },
    };

    accepter.currentRoom = roomId;
    requester.currentRoom = roomId;

    socket.join(roomId);
    io.sockets.sockets.get(from)?.join(roomId);

    io.to(roomId).emit("game_start", {
      roomId,
      game: rooms[roomId],
    });
  });

  /* ---------- LEAVE ROOM ---------- */
  socket.on("leave_room", () => {
    const player = players[socket.id];
    if (!player?.currentRoom) return;

    const roomId = player.currentRoom;
    const room = rooms[roomId];

    if (room) {
      socket.to(roomId).emit("player_left", {
        socketId: socket.id,
        name: player.name,
      });

      room.players.forEach((pid) => {
        if (players[pid]) players[pid].currentRoom = null;
      });

      delete rooms[roomId];
      delete scores_detial_list[roomId];
    }

    socket.leave(roomId);
    player.currentRoom = null;
  });

  /* ---------- MAKE MOVE ---------- */
  socket.on("make_move", ({ roomId, index, value }) => {
    const game = rooms[roomId];
    if (!game) return;

    if (game.turn !== socket.id) return;
    if (game.board[index]) return;

    game.serialNo++;

    game.board[index] = {
      sno: game.serialNo,
      index,
      value,
      playerId: socket.id,
      playerName: players[socket.id]?.name,
      playerNo: game.players[0] === socket.id ? 1 : 2,
    };

    game.turn = game.players.find((p) => p !== socket.id);

    io.to(roomId).emit("game_update", game);
  });

  /* ---------- SELECT CELLS ---------- */
  socket.on("selected_cells", ({ roomId, selectedCells }) => {
    socket.to(roomId).emit("selected_cells_update", {
      selectedCells,
      playerId: socket.id,
    });
  });

  /* ---------- SPELL CHECK ---------- */
  socket.on("spell_check", ({ roomId, word, playerId, status }) => {
    const game = rooms[roomId];
    if (!game) return;

    const score = status ? word.length : 0;

    scores_detial_list[roomId] ||= [];

    game.scores[playerId] += score;

    const score_details = {
      word,
      score,
      playerId,
      totalScore: game.scores[playerId],
      time: new Date().toISOString(),
    };

    scores_detial_list[roomId].push(score_details);

    io.to(roomId).emit("score_update", {
      moves: scores_detial_list[roomId],
      totals: game.scores,
      lastMove: score_details,
    });
  });

  /* ---------- REACTION ---------- */
  socket.on("send_reaction", ({ roomId, emoji }) => {
    io.to(roomId).emit("reaction", {
      id: `${Date.now()}_${socket.id}`,
      emoji,
      from: socket.id,
      time: Date.now(),
    });
  });

  /* ---------- DISCONNECT ---------- */
  socket.on("disconnect", () => {
    const player = players[socket.id];
    if (player?.currentRoom) {
      socket.to(player.currentRoom).emit("player_left", player);
      delete rooms[player.currentRoom];
      delete scores_detial_list[player.currentRoom];
    }

    delete players[socket.id];
    io.emit("online_players", Object.values(players));
  });
});

/* ===============================
   SERVER START
================================ */
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
