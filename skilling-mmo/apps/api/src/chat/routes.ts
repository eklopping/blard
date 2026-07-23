import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CHAT_HISTORY_LIMIT } from "@skilling-mmo/shared";
import {
  listPublicMessages,
  listInbox,
  listDmThread,
  listMutedIds,
  addMute,
  removeMute,
} from "./service.js";

export async function chatRoutes(app: FastifyInstance) {
  const auth = { preHandler: [app.authenticateCharacter] };

  app.get("/public", auth, async (req) => {
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit) || CHAT_HISTORY_LIMIT, 100);
    const messages = await listPublicMessages(req.user.playerId!, limit);
    return { messages };
  });

  app.get("/inbox", auth, async (req) => {
    const threads = await listInbox(req.user.playerId!);
    return { threads };
  });

  app.get("/dm/:threadKey", auth, async (req, reply) => {
    const { threadKey } = req.params as { threadKey: string };
    const q = req.query as { limit?: string };
    const limit = Math.min(Number(q.limit) || CHAT_HISTORY_LIMIT, 100);
    try {
      const messages = await listDmThread(req.user.playerId!, decodeURIComponent(threadKey), limit);
      return { messages };
    } catch {
      return reply.code(403).send({ error: "forbidden_thread" });
    }
  });

  app.get("/mutes", auth, async (req) => {
    const mutedPlayerIds = await listMutedIds(req.user.playerId!);
    return { mutedPlayerIds };
  });

  app.post("/mutes", auth, async (req, reply) => {
    const parsed = z.object({ mutedPlayerId: z.string().min(1) }).safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: "invalid_payload" });
    try {
      await addMute(req.user.playerId!, parsed.data.mutedPlayerId);
      return { ok: true };
    } catch (e: any) {
      if (e?.code === "P2002") return reply.code(409).send({ error: "already_muted" });
      if (String(e?.message) === "cannot_mute_self") {
        return reply.code(400).send({ error: "cannot_mute_self" });
      }
      throw e;
    }
  });

  app.delete("/mutes/:mutedPlayerId", auth, async (req, reply) => {
    const { mutedPlayerId } = req.params as { mutedPlayerId: string };
    try {
      await removeMute(req.user.playerId!, mutedPlayerId);
      return { ok: true };
    } catch {
      return reply.code(404).send({ error: "not_found" });
    }
  });
}
