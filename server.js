const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const cors = require("cors");

const app = express();
// live and local origins
app.use(cors({ origin: [
      "https://ruzzleboard.vercel.app",
      "http://localhost:4000"
    ]}));


app.get("/", (req, res) => {
  res.send("Ruzzle Backend is running");
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*" },
});

const players = {};
const rooms = {};
const scores_detial_list = {};

io.on("connection", (socket) => {
  console.log("Player Connected:", socket.id);

  // JOIN
  socket.on("join", (playerData) => {
    const player = {
      socketId: socket.id,
      id: playerData.id,
      name: playerData.name,
      joinedAt: new Date().toISOString(),
      currentRoom: null,
    };

    players[socket.id] = player;

    // ✅ Send self profile ONLY to this socket
    socket.emit("my_profile", player);

    // 🔔 Notify others about new player
    socket.broadcast.emit("join_player", player);

    // ✅ Send online players list WITHOUT self
    const onlineWithoutSelf = Object.values(players).filter(
      (p) => p.socketId !== socket.id
    );

    socket.emit("online_players", onlineWithoutSelf); // for self
    socket.broadcast.emit("online_players", Object.values(players)); // for others
  });

  // SEND GAME REQUEST
  socket.on("create_room", ({ targetSocketId }) => {
    const fromPlayer = players[socket.id];
    const toPlayer = players[targetSocketId];
    console.log("Create room request from", socket.id, "to", targetSocketId);

    if (!fromPlayer || !toPlayer) return;

    if (socket.id === targetSocketId) {
      socket.emit("error_msg", "You cannot play with yourself");
      return;
    }

    if (fromPlayer.currentRoom) {
      socket.emit("error_msg", "You are already in a room");
      return;
    }

    if (toPlayer.currentRoom) {
      socket.emit("error_msg", "Player is already in a room");
      return;
    }

    io.to(targetSocketId).emit("game_request", {
      from: socket.id,
      name: players[socket.id]?.name || "Unknown",
    });
    console.log(`Game request sent from ${socket.id} to ${targetSocketId}`);
  });

  // ACCEPT GAME REQUEST
  socket.on("accept_request", ({ from }) => {
    const accepter = players[socket.id];
    const requester = players[from];

    if (!accepter || !requester) return;

    // ❌ validation again (VERY IMPORTANT)
    if (accepter.currentRoom || requester.currentRoom) {
      socket.emit("error_msg", "Room already joined");
      return;
    }
    const roomId = `room_${socket.id}_${from}`;

    rooms[roomId] = {
      players: [socket.id, from],
      turn: from,
      serialNo: 0,
      board: Array(81).fill(null),
      scores: {
        [socket.id]: 0,
        [from]: 0,
      },
    };

    accepter.currentRoom = roomId;
    requester.currentRoom = roomId;
    socket.join(roomId);
    io.to(from).socketsJoin(roomId);

    io.to(roomId).emit("game_start", {
      roomId,
      game: rooms[roomId],
    });

    console.log("Game started:", roomId);
  });

  socket.on("leave_room", () => {
    const player = players[socket.id];
    if (!player || !player.currentRoom) return;

    const roomId = player.currentRoom;
    const room = rooms[roomId];

    if (room) {
      // notify other player
      socket.to(roomId).emit("player_left", {
        socketId: socket.id,
        name: player.name,
      });

      // cleanup
      room.players.forEach((pid) => {
        if (players[pid]) {
          players[pid].currentRoom = null;
        }
      });

      delete rooms[roomId];
    }

    socket.leave(roomId);
    player.currentRoom = null;

    console.log("Player left room:", roomId);
  });

  // MAKE MOVE
  socket.on("make_move", ({ roomId, index, value }) => {
    const game = rooms[roomId];
    if (!game) return;

    // validate turn
    if (game.turn !== socket.id) return;

    // prevent overwrite
    if (game.board[index]) return;

    game.serialNo++;

    game.board[index] = {
      sno: game.serialNo,
      index,
      value,
      playerId: socket.id,
      playerName: players[socket.id]?.name || "Unknown",
      playerNo: game.players[0] === socket.id ? 1 : 2,
    };

    // switch turn
    game.turn = game.players.find((p) => p !== socket.id);

    // broadcast update
    io.to(roomId).emit("game_update", game);
  });

  socket.on("selected_cells", ({ roomId, selectedCells }) => {
    const game = rooms[roomId];
    if (!game) return;

    // broadcast selected cells to other player
    socket
      .to(roomId)
      .emit("selected_cells_update", { selectedCells, playerId: socket.id });
  });

  // SPELL CHECK
  socket.on("spell_check", ({ roomId, word, playerId, status }) => {
    const game = rooms[roomId];
    if (!game) return;

    const score = status ? word.length : 0;

    // init history if not exists
    if (!scores_detial_list[roomId]) {
      scores_detial_list[roomId] = [];
    }

    // update total score
    game.scores[playerId] = (game.scores[playerId] || 0) + score;

    const score_details = {
      word,
      score,
      playerId,
      totalScore: game.scores[playerId],
      time: new Date().toISOString(),
    };

    // ✅ store move
    scores_detial_list[roomId].push(score_details);

    // 🧮 BUILD TOTAL SCORE MAP
    const totalScores = {};
    game.players.forEach((pid) => {
      totalScores[pid] = game.scores[pid] || 0;
    });

    // console.log("Moves:", scores_detial_list[roomId]);
    // console.log("Totals:", totalScores);

    // 📡 SEND EVERYTHING TO CLIENTS
    io.to(roomId).emit("score_update", {
      moves: scores_detial_list[roomId],
      totals: totalScores,
      lastMove: score_details,
    });
  });

  // DISCONNECT
  socket.on("disconnect", () => {
    delete players[socket.id];
    io.emit("online_players", Object.values(players));
    // console.log("Player Disconnected:", socket.id);
  });

  socket.on("send_reaction", ({ roomId, emoji }) => {
    if (!roomId || !emoji) return;

    io.to(roomId).emit("reaction", {
      id: Date.now() + socket.id, // unique id
      emoji,
      from: socket.id,
      time: Date.now(),
    });
  });
});

server.listen(5000, () => {
  console.log("Server running on port 5000");
});
