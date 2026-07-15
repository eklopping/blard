import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { prisma } from "@skilling-mmo/db";
import { INVENTORY_SIZE, BANK_SIZE, SKILLS } from "@skilling-mmo/shared";
import { z } from "zod";

const credsSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(128),
  displayName: z.string().min(1).max(24).optional(),
});

async function createPlayerForAccount(accountId: string, displayName: string) {
  const player = await prisma.player.create({
    data: {
      accountId,
      name: displayName,
      coins: 100,
      x: 160,
      y: 160,
      skills: {
        create: [{ skill: SKILLS.WOODCUTTING, level: 1, xp: 0 }],
      },
      inventory: {
        create: Array.from({ length: INVENTORY_SIZE }, (_, slot) => ({
          slot,
          itemId: null,
          quantity: 0,
        })),
      },
      bank: {
        create: Array.from({ length: BANK_SIZE }, (_, slot) => ({
          slot,
          itemId: null,
          quantity: 0,
        })),
      },
    },
  });
  return player;
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (req, reply) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const { username, password, displayName } = parsed.data;
    const existing = await prisma.account.findUnique({ where: { username: username.toLowerCase() } });
    if (existing) {
      return reply.code(409).send({ error: "username_taken" });
    }

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const account = await prisma.account.create({
      data: {
        username: username.toLowerCase(),
        passwordHash,
      },
    });
    const player = await createPlayerForAccount(account.id, displayName ?? username);

    const accessToken = await reply.jwtSign(
      { sub: account.id, playerId: player.id, username: account.username },
      { expiresIn: "7d" },
    );

    return {
      accessToken,
      playerId: player.id,
      username: account.username,
      displayName: player.name,
    };
  });

  app.post("/login", async (req, reply) => {
    const parsed = credsSchema.omit({ displayName: true }).safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const { username, password } = parsed.data;
    const account = await prisma.account.findUnique({
      where: { username: username.toLowerCase() },
      include: { players: { take: 1, orderBy: { createdAt: "asc" } } },
    });
    if (!account) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await argon2.verify(account.passwordHash, password);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    let player = account.players[0];
    if (!player) {
      player = await createPlayerForAccount(account.id, account.username);
    }

    const accessToken = await reply.jwtSign(
      { sub: account.id, playerId: player.id, username: account.username },
      { expiresIn: "7d" },
    );

    return {
      accessToken,
      playerId: player.id,
      username: account.username,
      displayName: player.name,
    };
  });

  app.get("/me", { preHandler: [app.authenticate] }, async (req) => {
    const user = req.user;
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: user.playerId },
      include: {
        skills: true,
        inventory: { orderBy: { slot: "asc" } },
        bank: { orderBy: { slot: "asc" } },
      },
    });
    return {
      accountId: user.sub,
      username: user.username,
      player,
    };
  });
}
