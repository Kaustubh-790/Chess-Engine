import { arenaService } from "./arenaService.js";
import { startMatch } from "../utils/socketStartMatch.js";

export const registerArenaHandlers = (io, socket) => {
  socket.on("join_arena", ({ arenaId }) => {
    const result = arenaService.joinArena(arenaId, socket, socket.user);

    if (result.error) {
      return socket.emit("arena_error", { message: result.error });
    }

    socket.join(`arena:${arenaId}`);

    console.log(
      `[Arena] ${socket.user.userName} joined arena ${arenaId}. Queue: ${result.queueLength}`,
    );

    arenaService.broadcastQueueUpdate(arenaId);

    const newGame = arenaService.matchArena(arenaId);
    startMatch(newGame);
  });

  socket.on("leave_arena", ({ arenaId }) => {
    arenaService.removePlayerFromArena(arenaId, socket.id);
    socket.leave(`arena:${arenaId}`);
    arenaService.broadcastQueueUpdate(arenaId);
  });

  socket.on("disconnect", () => {
    const affected = arenaService.removeSocketFromAllArenas(socket.id);
    for (const arenaId of affected) {
      arenaService.broadcastQueueUpdate(arenaId);
    }
  });
};
