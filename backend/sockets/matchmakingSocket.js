import { gameService } from "../services/gameService.js";

export const registerMatchMakingHandlers = (io, socket) => {
  socket.on("enter_arena", () => {
    const added = gameService.addToQueue(socket, socket.user);

    if (!added) return;

    console.log(
      `${socket.user.userName} joined arena. Queue length: ${gameService.getQueueLength()}`,
    );

    // attempt to match players
    const newGame = gameService.matchPlayers();
    if (newGame) {
      const { gameId, instance, players } = newGame;

      // puting both sockets in same room
      players.white.socket.join(gameId);
      players.black.socket.join(gameId);

      // emiting start event to white
      players.white.socket.emit("match_started", {
        gameId,
        color: "white",
        opponent: players.black.user.userName,
        opponentRating: players.black.user.rating,
        fen: instance.fen(),
        timeControl: "unlimited",
      });

      // emiting start event to black
      players.black.socket.emit("match_started", {
        gameId,
        color: "black",
        opponent: players.white.user.userName,
        opponentRating: players.white.user.rating,
        fen: instance.fen(),
        timeControl: "unlimited",
      });
    }
  });

  socket.on("disconnect", () => {
    gameService.removeFromQueue(socket.id);
  });
};
