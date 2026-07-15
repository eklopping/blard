import { Worker, Queue } from "bullmq";
import { prisma, OrderStatus } from "@skilling-mmo/db";

const redisEnabled =
  process.env.REDIS_ENABLED === "true" || process.env.REDIS_ENABLED === "1";
const redisUrl = process.env.REDIS_URL ?? "redis://127.0.0.1:6379";

const STALE_ORDER_MS = 1000 * 60 * 60 * 24; // 24h

async function cancelStaleOrders() {
  const cutoff = new Date(Date.now() - STALE_ORDER_MS);
  const result = await prisma.marketOrder.updateMany({
    where: {
      status: { in: [OrderStatus.OPEN, OrderStatus.PARTIAL] },
      createdAt: { lt: cutoff },
    },
    data: { status: OrderStatus.CANCELLED },
  });
  console.log(`[worker] cancelled ${result.count} stale orders`);
  return result.count;
}

async function dailyResetStub() {
  // TODO: daily skill streaks / login rewards
  console.log("[worker] daily reset stub ran");
}

async function main() {
  console.log("[worker] starting");
  await prisma.$connect();

  if (!redisEnabled) {
    console.log("[worker] Redis disabled — running periodic stubs via setInterval");
    setInterval(() => {
      void cancelStaleOrders();
      void dailyResetStub();
    }, 60_000);
    await cancelStaleOrders();
    return;
  }

  // URL connection opts — BullMQ constructs its own ioredis instance
  const connection = { url: redisUrl, maxRetriesPerRequest: null as null };
  const queueName = "skilling-jobs";

  const queue = new Queue(queueName, { connection });
  await queue.add(
    "cancel-stale-orders",
    {},
    { repeat: { every: 60_000 }, removeOnComplete: true },
  );
  await queue.add(
    "daily-reset-stub",
    {},
    { repeat: { pattern: "0 0 * * *" }, removeOnComplete: true },
  );

  const worker = new Worker(
    queueName,
    async (job) => {
      if (job.name === "cancel-stale-orders") return cancelStaleOrders();
      if (job.name === "daily-reset-stub") return dailyResetStub();
    },
    { connection, concurrency: Number(process.env.WORKER_CONCURRENCY ?? 2) },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.name} failed`, err);
  });

  console.log("[worker] BullMQ consumers ready");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
