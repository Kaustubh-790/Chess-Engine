import { Chess } from "chess.js";
import crypto from "crypto";

class GameService {
  constructor() {
    this.arenaQueues = new Map();
    this.activeGames = new Map();
  }

  addToQueue(socket, user, timeControl) {
    const queueKey = timeControl ? timeControl.label : "unlimited";

    for (const queue of this.arenaQueues.values()) {
      if (queue.find((p) => p.socket.id === socket.id)) return false;
    }

    if (!this.arenaQueues.has(queueKey)) {
      this.arenaQueues.set(queueKey, []);
    }

    this.arenaQueues.get(queueKey).push({ socket, user, timeControl });
    return true;
  }

  removeFromQueue(socketId) {
    for (const [key, queue] of this.arenaQueues.entries()) {
      this.arenaQueues.set(
        key,
        queue.filter((p) => p.socket.id !== socketId),
      );
    }
  }

  getQueueLength() {
    let total = 0;
    for (const queue of this.arenaQueues.values()) total += queue.length;
    return total;
  }

  matchPlayers() {
    for (const queue of this.arenaQueues.values()) {
      if (queue.length >= 2) {
        const player1 = queue.shift();
        const player2 = queue.shift();
        return this.createGame(player1, player2, null, player1.timeControl);
      }
    }
    return false;
  }

  createGame(player1, player2, arenaId = null, timeControl = null) {
    const gameId = crypto.randomUUID();
    const tc = timeControl || { label: "unlimited", initial: 0, increment: 0 };
    const initialMs = tc.initial * 60 * 1000;

    const gameData = {
      instance: new Chess(),
      gameId,
      arenaId,
      timeControl: tc,
      players: {
        white: { ...player1, time: initialMs },
        black: { ...player2, time: initialMs },
      },
      lastMoveTime: null,
      timeoutTimer: null,
    };

    this.activeGames.set(gameId, gameData);
    return gameData;
  }

  getGame(gameId) {
    return this.activeGames.get(gameId);
  }

  getGameByUserId(userId) {
    for (const game of this.activeGames.values()) {
      const wId = game.players.white.user._id.toString();
      const bId = game.players.black.user._id.toString();
      if (wId === userId.toString() || bId === userId.toString()) {
        return game;
      }
    }
    return null;
  }

  rejoinGame(gameId, userId, newSocket) {
    const game = this.activeGames.get(gameId);
    if (!game) return null;

    const uid = userId.toString();
    let color = null;

    if (game.players.white.user._id.toString() === uid) color = "white";
    else if (game.players.black.user._id.toString() === uid) color = "black";

    if (!color) return null;

    game.players[color].socket = newSocket;
    return { game, color };
  }

  getGamesByArenaId(arenaId) {
    const games = [];
    for (const game of this.activeGames.values()) {
      if (game.arenaId === arenaId) games.push(game);
    }
    return games;
  }

  removeGame(gameId) {
    const game = this.activeGames.get(gameId);
    if (game?.timeoutTimer) clearTimeout(game.timeoutTimer);
    this.activeGames.delete(gameId);
  }
}

export const gameService = new GameService();
