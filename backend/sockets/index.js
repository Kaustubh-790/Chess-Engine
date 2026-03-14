import { authenticateSocket } from "./authSocket.js";
import { registerMatchMakingHandlers } from "./matchmakingSocket.js";
import { registerGameHandler } from "./gameSocket.js";

const setupSockets = (io) => {
  io.use(authenticateSocket);
  io.on("connection", (socket) => {
    console.log(
      `[Socket] User connected: ${socket.user.userName} (${socket.id})`,
    );

    registerMatchMakingHandlers(io, socket);
    registerGameHandler(io, socket);

    socket.on("disconnect", () => {
      console.log(`[Socket] User disconnected: ${socket.user.userName}`);
    });
  });
};

export default setupSockets;
