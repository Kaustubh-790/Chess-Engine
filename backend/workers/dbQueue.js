import { Queue } from "bullmq";
import { redis } from "../config/redis.js";

export const matchResultQueue = new Queue("match-results-queue", {
  connection: redis,
  defaultJobOptions: {
    attempts: 5,
    backoff: {
      type: "exponential",
      delay: 5000, 
    },
    removeOnComplete: true, 
  },
});
