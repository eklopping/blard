import type { FastifyInstance } from "fastify";
import argon2 from "argon2";
import { prisma, type Profession } from "@skilling-mmo/db";
import {
  INVENTORY_SIZE,
  BANK_SIZE,
  MAX_CHARACTERS_PER_ACCOUNT,
  PROFESSIONS,
  PROFESSION_STARTING_SKILLS,
  type ProfessionId,
  type SkillId,
} from "@skilling-mmo/shared";
import { z } from "zod";

const credsSchema = z.object({
  username: z.string().min(3).max(32).regex(/^[a-zA-Z0-9_]+$/),
  password: z.string().min(6).max(128),
});

const createCharacterSchema = z.object({
  name: z.string().min(1).max(24).regex(/^[a-zA-Z0-9 _-]+$/),
  profession: z.enum([PROFESSIONS.WOODSMAN, PROFESSIONS.FARMER, PROFESSIONS.MINER]),
});

const selectCharacterSchema = z.object({
  playerId: z.string().min(1),
});

function toPrismaProfession(profession: ProfessionId): Profession {
  return profession.toUpperCase() as Profession;
}

function fromPrismaProfession(profession: Profession): ProfessionId {
  return profession.toLowerCase() as ProfessionId;
}

function startingSkills(profession: ProfessionId): SkillId[] {
  const profSkills = PROFESSION_STARTING_SKILLS[profession] ?? [];
  return [...profSkills];
}

async function createPlayerForAccount(accountId: string, name: string, profession: ProfessionId) {
  const skills = startingSkills(profession);
  const player = await prisma.player.create({
    data: {
      accountId,
      name,
      profession: toPrismaProfession(profession),
      coins: 100,
      x: 160,
      y: 160,
      skills: {
        create: skills.map((skill) => ({ skill, level: 1, xp: 0 })),
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

function signAccountToken(reply: any, account: { id: string; username: string }) {
  return reply.jwtSign({ sub: account.id, username: account.username }, { expiresIn: "7d" });
}

function signCharacterToken(
  reply: any,
  account: { id: string; username: string },
  player: { id: string; name: string; profession: Profession },
) {
  return reply.jwtSign(
    {
      sub: account.id,
      username: account.username,
      playerId: player.id,
      profession: fromPrismaProfession(player.profession),
    },
    { expiresIn: "7d" },
  );
}

export async function authRoutes(app: FastifyInstance) {
  app.post("/register", async (req, reply) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const { username, password } = parsed.data;
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

    const accessToken = await signAccountToken(reply, account);
    return { accessToken, username: account.username };
  });

  app.post("/login", async (req, reply) => {
    const parsed = credsSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const { username, password } = parsed.data;
    const account = await prisma.account.findUnique({
      where: { username: username.toLowerCase() },
    });
    if (!account) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }
    const ok = await argon2.verify(account.passwordHash, password);
    if (!ok) {
      return reply.code(401).send({ error: "invalid_credentials" });
    }

    const accessToken = await signAccountToken(reply, account);
    return { accessToken, username: account.username };
  });

  app.get("/characters", { preHandler: [app.authenticate] }, async (req) => {
    const accountId = req.user.sub;
    const players = await prisma.player.findMany({
      where: { accountId },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        name: true,
        profession: true,
        coins: true,
        createdAt: true,
      },
    });

    return {
      characters: players.map((p) => ({
        id: p.id,
        name: p.name,
        profession: fromPrismaProfession(p.profession),
        coins: p.coins,
        createdAt: p.createdAt.toISOString(),
      })),
      maxCharacters: MAX_CHARACTERS_PER_ACCOUNT,
      slotsRemaining: Math.max(0, MAX_CHARACTERS_PER_ACCOUNT - players.length),
    };
  });

  app.post("/characters", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = createCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload", details: parsed.error.flatten() });
    }
    const accountId = req.user.sub;
    const { name, profession } = parsed.data;

    const count = await prisma.player.count({ where: { accountId } });
    if (count >= MAX_CHARACTERS_PER_ACCOUNT) {
      return reply.code(409).send({ error: "character_limit_reached" });
    }

    const player = await createPlayerForAccount(accountId, name.trim(), profession);
    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const accessToken = await signCharacterToken(reply, account, player);

    return {
      accessToken,
      username: account.username,
      playerId: player.id,
      displayName: player.name,
      profession: fromPrismaProfession(player.profession),
    };
  });

  app.post("/select", { preHandler: [app.authenticate] }, async (req, reply) => {
    const parsed = selectCharacterSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.code(400).send({ error: "invalid_payload" });
    }
    const accountId = req.user.sub;
    const player = await prisma.player.findFirst({
      where: { id: parsed.data.playerId, accountId },
    });
    if (!player) {
      return reply.code(404).send({ error: "character_not_found" });
    }

    const account = await prisma.account.findUniqueOrThrow({ where: { id: accountId } });
    const accessToken = await signCharacterToken(reply, account, player);

    return {
      accessToken,
      username: account.username,
      playerId: player.id,
      displayName: player.name,
      profession: fromPrismaProfession(player.profession),
    };
  });

  app.get("/me", { preHandler: [app.authenticateCharacter] }, async (req) => {
    const player = await prisma.player.findUniqueOrThrow({
      where: { id: req.user.playerId },
      include: {
        skills: true,
        inventory: { orderBy: { slot: "asc" } },
        bank: { orderBy: { slot: "asc" } },
      },
    });
    return {
      accountId: req.user.sub,
      username: req.user.username,
      player: {
        ...player,
        profession: fromPrismaProfession(player.profession),
      },
    };
  });
}
