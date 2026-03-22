import { Chess } from "chess.js";
import crypto from "crypto";
import { redis } from "../config/redis.js";

const GAME_TTL = 60 * 60 * 6;
const LOCK_TTL = 5000;

class GameService {
  async _acquireLock(key) {
    const token = crypto.randomUUID();
    const ok = await redis.set(`lock:${key}`, token, "NX", "PX", LOCK_TTL);
    return ok === "OK" ? token : null;
  }

  async _releaseLock(key, token) {
    await redis.eval(
      `if redis.call("get",KEYS[1])==ARGV[1] then return redis.call("del",KEYS[1]) else return 0 end`,
      1,
      `lock:${key}`,
      token,
    );
  }

  async addToQueue(socket, user, timeControl) {
    const label = timeControl?.label || "unlimited";
    const qKey = `arena_queue:${label}`;
    const items = await redis.lrange(qKey, 0, -1);
    if (items.some((i) => JSON.parse(i).socketId === socket.id)) return false;
    await redis.rpush(
      qKey,
      JSON.stringify({ socketId: socket.id, user, timeControl }),
    );
    await redis.sadd("queue:labels", label);
    return true;
  }

  async removeFromQueue(socketId) {
    const labels = await redis.smembers("queue:labels");
    for (const label of labels) {
      const qKey = `arena_queue:${label}`;
      const items = await redis.lrange(qKey, 0, -1);
      for (const item of items) {
        if (JSON.parse(item).socketId === socketId)
          await redis.lrem(qKey, 0, item);
      }
    }
  }

  async getQueueLength() {
    const labels = await redis.smembers("queue:labels");
    let n = 0;
    for (const label of labels) n += await redis.llen(`arena_queue:${label}`);
    return n;
  }

  async matchPlayers() {
    const labels = await redis.smembers("queue:labels");
    for (const label of labels) {
      const qKey = `arena_queue:${label}`;
      if ((await redis.llen(qKey)) < 2) continue;

      const lockToken = await this._acquireLock(`match:${label}`);
      if (!lockToken) continue;

      try {
        if ((await redis.llen(qKey)) < 2) continue;
        const p1Str = await redis.lpop(qKey);
        const p2Str = await redis.lpop(qKey);
        if (!p1Str || !p2Str) {
          if (p1Str) await redis.lpush(qKey, p1Str);
          continue;
        }
        const p1 = JSON.parse(p1Str);
        const p2 = JSON.parse(p2Str);
        return await this.createGame(p1, p2, null, p1.timeControl);
      } finally {
        await this._releaseLock(`match:${label}`, lockToken);
      }
    }
    return null;
  }

  async createGame(player1, player2, arenaId = null, timeControl = null) {
    const gameId = crypto.randomUUID();
    const tc = timeControl || { label: "unlimited", initial: 0, increment: 0 };
    const initialMs = tc.initial * 60 * 1000;

    const playersData = {
      white: {
        user: player1.user,
        time: initialMs,
        socketId: player1.socketId,
      },
      black: {
        user: player2.user,
        time: initialMs,
        socketId: player2.socketId,
      },
    };

    const pipe = redis.pipeline();
    pipe.hset(`game:${gameId}`, {
      gameId,
      arenaId: arenaId || "",
      timeControl: JSON.stringify(tc),
      players: JSON.stringify(playersData),
      fen: new Chess().fen(),
      moves: "[]",
      lastMoveTime: "",
    });
    pipe.expire(`game:${gameId}`, GAME_TTL);
    pipe.set(`user:game:${player1.user._id}`, gameId, "EX", GAME_TTL);
    pipe.set(`user:game:${player2.user._id}`, gameId, "EX", GAME_TTL);
    if (arenaId) {
      pipe.sadd(`arena:games:${arenaId}`, gameId);
      pipe.expire(`arena:games:${arenaId}`, GAME_TTL);
    }
    await pipe.exec();
    return this.getGame(gameId);
  }

  async getGame(gameId) {
    const data = await redis.hgetall(`game:${gameId}`);
    if (!data?.gameId) return null;

    const instance = new Chess();
    try {
      instance.load(data.fen);
    } catch (_) {}

    const players = JSON.parse(data.players);
    const tc = data.timeControl ? JSON.parse(data.timeControl) : null;
    const moves = data.moves ? JSON.parse(data.moves) : [];

    return {
      gameId: data.gameId,
      arenaId: data.arenaId || null,
      timeControl: tc,
      players,
      instance,
      moves,
      lastMoveTime: data.lastMoveTime ? parseInt(data.lastMoveTime, 10) : null,
    };
  }

  buildInstanceFromMoves(moves) {
    const chess = new Chess();
    for (const san of moves) {
      try {
        chess.move(san);
      } catch (_) {
        break;
      }
    }
    return chess;
  }

  buildFinalPgn(game, winner, players) {
    const chess = this.buildInstanceFromMoves(game.moves);
    const dateStr = new Date().toISOString().split("T")[0].replace(/-/g, ".");
    const resultStr =
      winner === "white" ? "1-0" : winner === "black" ? "0-1" : "1/2-1/2";
    chess.header("Event", "Arena Match");
    chess.header("Site", "local");
    chess.header("Date", dateStr);
    chess.header("White", players.white.user.userName);
    chess.header("Black", players.black.user.userName);
    chess.header("Result", resultStr);
    return chess.pgn();
  }

  async getGameByUserId(userId) {
    const gameId = await redis.get(`user:game:${userId.toString()}`);
    return gameId ? this.getGame(gameId) : null;
  }

  async rejoinGame(gameId, userId, newSocketId) {
    const game = await this.getGame(gameId);
    if (!game) return null;
    const uid = userId.toString();
    const { players } = game;
    let color = null;
    if (players.white.user._id.toString() === uid) {
      color = "white";
      players.white.socketId = newSocketId;
    } else if (players.black.user._id.toString() === uid) {
      color = "black";
      players.black.socketId = newSocketId;
    }
    if (!color) return null;
    await redis.hset(`game:${gameId}`, "players", JSON.stringify(players));
    game.players = players;
    const fullInstance = this.buildInstanceFromMoves(game.moves);
    return { game: { ...game, instance: fullInstance }, color };
  }

  async saveGameState(gameId, instance, players, lastMoveTime, updatedMoves) {
    const pipe = redis.pipeline();
    pipe.hset(`game:${gameId}`, {
      fen: instance.fen(),
      moves: JSON.stringify(updatedMoves),
      players: JSON.stringify(players),
      lastMoveTime: lastMoveTime ? lastMoveTime.toString() : "",
    });
    pipe.expire(`game:${gameId}`, GAME_TTL);
    await pipe.exec();
  }

  async getGamesByArenaId(arenaId) {
    const gameIds = await redis.smembers(`arena:games:${arenaId}`);
    if (!gameIds.length) return [];
    const games = await Promise.all(gameIds.map((id) => this.getGame(id)));
    return games.filter(Boolean);
  }

  async removeGame(gameId) {
    const data = await redis.hgetall(`game:${gameId}`);
    const pipe = redis.pipeline();
    pipe.del(`game:${gameId}`);
    if (data?.players) {
      const p = JSON.parse(data.players);
      pipe.del(`user:game:${p.white.user._id}`);
      pipe.del(`user:game:${p.black.user._id}`);
    }
    if (data?.arenaId) pipe.srem(`arena:games:${data.arenaId}`, gameId);
    await pipe.exec();
  }
}

export const gameService = new GameService();
