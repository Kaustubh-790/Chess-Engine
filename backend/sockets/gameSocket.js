import { gameService } from "../services/gameService.js";

export const registerGameHandler = (io, socket) => {
  socket.on("move_attempt", ({ gameId, from, to, promotion }) => {
    const game = gameService.getGame(gameId);

    if (!game) {
      return socket.emit("move_rejected", { reason: "game_not_found" });
    }

    const { instance, players } = game;

    const isWhite = players.white.socket.id === socket.id;
    const isBlack = players.black.socket.id === socket.id;
    const playerColor = isWhite ? "w" : isBlack ? "b" : null;

    if (!playerColor) {
      return socket.emit("move_rejected", { reason: "not_your_game" });
    }

    if (instance.turn() !== playerColor) {
      return socket.emit("move_rejected", { reason: "not_your_turn" });
    }

    try {
      const move = instance.move({
        from,
        to,
        promotion: promotion || "q",
      });

      if (!move) {
        return socket.emit("move_rejected", { reason: "illegal_move" });
      }

      io.to(gameId).emit("board_sync", {
        fen: instance.fen(),
        lastMove: move,
        turn: instance.turn(),
      });

      if (instance.isGameOver()) {
        let reason = "unknown";
        let winner = null;

        if (instance.isCheckmate()) {
          reason = "checkmate";
          winner = instance.turn() === "w" ? "black" : "white";
        } else if (
          instance.isDraw() ||
          instance.isStalemate() ||
          instance.isThreefoldRepetition() ||
          instance.isInsufficientMaterial()
        ) {
          reason = "draw";
          winner = "draw";
        }

        io.to(gameId).emit("game_over", {
          winner,
          reason,
          pgn: instance.pgn(),
        });

        gameService.removeGame(gameId);
      }
    } catch (error) {
      socket.emit("move_rejected", { reason: "illegal_move" });
    }
  });
};
