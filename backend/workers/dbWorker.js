import { Worker } from "bullmq";
import { redis } from "../config/redis.js";
import Match from "../models/Match.js";
import User from "../models/User.js";

console.log("Starting DB Worker for match-results-queue...");

export const matchResultWorker = new Worker(
  "match-results-queue",
  async (job) => {
    const { gameId, whitePlayerId, blackPlayerId, winner, reason, pgn, whiteStats, blackStats, moveCount } = job.data;

    console.log(`[Worker] Structuring match write for game ${gameId}...`);

    await Promise.all([
      User.findByIdAndUpdate(whitePlayerId, {
        $inc: {
          gamesPlayed: 1,
          wins: winner === "white" ? 1 : 0,
          losses: winner === "black" ? 1 : 0,
          draws: winner === "draw" ? 1 : 0,
        },
        $set: { rating: whiteStats.newRating },
      }),
      User.findByIdAndUpdate(blackPlayerId, {
        $inc: {
          gamesPlayed: 1,
          wins: winner === "black" ? 1 : 0,
          losses: winner === "white" ? 1 : 0,
          draws: winner === "draw" ? 1 : 0,
        },
        $set: { rating: blackStats.newRating },
      }),
    ]);

    await Match.create({
      gameId,
      whitePlayer: whitePlayerId,
      blackPlayer: blackPlayerId,
      winner,
      endReason: reason,
      pgn: pgn,
      ratingChanges: {
        white: whiteStats.delta,
        black: blackStats.delta,
      },
      moveCount,
    });

    console.log(`[Worker] Match ${gameId} successfully saved to MongoDB.`);
  },
  {
    connection: redis,
    concurrency: 5, 
  }
);

matchResultWorker.on("completed", (job) => {
  console.log(`[Worker] Job ${job.id} completed successfully`);
});

matchResultWorker.on("failed", (job, err) => {
  console.error(`[Worker] Job ${job.id} has failed:`, err);
});
