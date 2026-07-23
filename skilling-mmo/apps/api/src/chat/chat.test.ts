import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { dmThreadKey, validateChatBody, CHAT_MAX_BODY } from "@skilling-mmo/shared";
import { PrismaClient } from "@skilling-mmo/db";
import {
  createPublicMessage,
  createDmMessage,
  listPublicMessages,
  listInbox,
  listDmThread,
  listMutedIds,
  addMute,
  removeMute,
} from "./service.js";

describe("chat helpers", () => {
  it("dmThreadKey is order-independent", () => {
    expect(dmThreadKey("a", "b")).toBe("a:b");
    expect(dmThreadKey("b", "a")).toBe("a:b");
  });

  it("validateChatBody rejects empty and too long", () => {
    expect(validateChatBody("").ok).toBe(false);
    expect(validateChatBody("   ").ok).toBe(false);
    expect(validateChatBody("x".repeat(CHAT_MAX_BODY + 1)).ok).toBe(false);
    expect(validateChatBody(" hello ").ok).toBe(true);
    expect(validateChatBody(" hello ").body).toBe("hello");
  });
});

const DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://skilling:skilling@127.0.0.1:5432/skilling_mmo_test?schema=public";

const prisma = new PrismaClient({ datasources: { db: { url: DATABASE_URL } } });

let dbReady = false;

async function seedPlayer(name: string) {
  const account = await prisma.account.create({
    data: {
      username: `u_${name}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      passwordHash: "test",
      players: {
        create: { name },
      },
    },
    include: { players: true },
  });
  return account.players[0];
}

describe("chat service", () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = DATABASE_URL;
    try {
      await prisma.$connect();
      await prisma.$queryRaw`SELECT 1`;
      dbReady = true;
    } catch (err) {
      console.warn("[chat.test] Postgres unavailable — skipping DB tests:", err);
      dbReady = false;
      if (process.env.CI === "true") {
        throw err;
      }
    }
  });

  afterAll(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });

  beforeEach(async () => {
    if (!dbReady) return;
    await prisma.chatMute.deleteMany();
    await prisma.chatMessage.deleteMany();
    await prisma.inventorySlot.deleteMany();
    await prisma.bankSlot.deleteMany();
    await prisma.skillProgress.deleteMany();
    await prisma.player.deleteMany();
    await prisma.session.deleteMany();
    await prisma.account.deleteMany();
  });

  it("createPublicMessage validates body and persists", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");

    await expect(
      createPublicMessage({ senderId: alice.id, senderName: alice.name, body: "   " }),
    ).rejects.toThrow("empty");

    const msg = await createPublicMessage({
      senderId: alice.id,
      senderName: alice.name,
      body: " hi all ",
    });
    expect(msg.body).toBe("hi all");
    expect(msg.channel).toBe("PUBLIC");
    expect(msg.senderId).toBe(alice.id);
  });

  it("createDmMessage rejects self-DM and unknown recipient", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");

    await expect(
      createDmMessage({
        senderId: alice.id,
        senderName: alice.name,
        recipientId: alice.id,
        body: "hi",
      }),
    ).rejects.toThrow("dm_self");

    await expect(
      createDmMessage({
        senderId: alice.id,
        senderName: alice.name,
        recipientId: "does-not-exist",
        body: "hi",
      }),
    ).rejects.toThrow("unknown_recipient");
  });

  it("createDmMessage persists with order-independent threadKey", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");

    const msg = await createDmMessage({
      senderId: alice.id,
      senderName: alice.name,
      recipientId: bob.id,
      body: "hey bob",
    });

    expect(msg.channel).toBe("DIRECT");
    expect(msg.threadKey).toBe(dmThreadKey(alice.id, bob.id));
    expect(msg.recipientId).toBe(bob.id);
  });

  it("addMute throws cannot_mute_self and enforces unique constraint on duplicate", async ({
    skip,
  }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");

    await expect(addMute(alice.id, alice.id)).rejects.toThrow("cannot_mute_self");

    await addMute(alice.id, bob.id);
    await expect(addMute(alice.id, bob.id)).rejects.toThrow();

    expect(await listMutedIds(alice.id)).toEqual([bob.id]);

    await removeMute(alice.id, bob.id);
    expect(await listMutedIds(alice.id)).toEqual([]);
  });

  it("listPublicMessages filters out muted senders", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");

    await createPublicMessage({ senderId: alice.id, senderName: alice.name, body: "from alice" });
    await createPublicMessage({ senderId: bob.id, senderName: bob.name, body: "from bob" });

    let msgs = await listPublicMessages(alice.id, 50);
    expect(msgs.map((m) => m.body)).toEqual(["from alice", "from bob"]);

    await addMute(alice.id, bob.id);
    msgs = await listPublicMessages(alice.id, 50);
    expect(msgs.map((m) => m.body)).toEqual(["from alice"]);
  });

  it("listDmThread throws forbidden_thread when viewer not in threadKey", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");
    const carol = await seedPlayer("carol");

    await createDmMessage({
      senderId: alice.id,
      senderName: alice.name,
      recipientId: bob.id,
      body: "hi bob",
    });
    const threadKey = dmThreadKey(alice.id, bob.id);

    await expect(listDmThread(carol.id, threadKey, 50)).rejects.toThrow("forbidden_thread");

    const msgs = await listDmThread(alice.id, threadKey, 50);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].body).toBe("hi bob");
  });

  it("listDmThread filters out muted senders", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");

    await createDmMessage({
      senderId: bob.id,
      senderName: bob.name,
      recipientId: alice.id,
      body: "hi alice",
    });
    const threadKey = dmThreadKey(alice.id, bob.id);

    await addMute(alice.id, bob.id);
    const msgs = await listDmThread(alice.id, threadKey, 50);
    expect(msgs).toHaveLength(0);
  });

  it("listInbox returns distinct threads by latest message for both sides", async ({ skip }) => {
    if (!dbReady) skip();

    const alice = await seedPlayer("alice");
    const bob = await seedPlayer("bob");
    const carol = await seedPlayer("carol");

    await createDmMessage({
      senderId: alice.id,
      senderName: alice.name,
      recipientId: bob.id,
      body: "hi bob 1",
    });
    await createDmMessage({
      senderId: bob.id,
      senderName: bob.name,
      recipientId: alice.id,
      body: "hi alice back",
    });
    await createDmMessage({
      senderId: carol.id,
      senderName: carol.name,
      recipientId: alice.id,
      body: "hi alice from carol",
    });

    const aliceInbox = await listInbox(alice.id);
    expect(aliceInbox).toHaveLength(2);
    const bobThread = aliceInbox.find((t) => t.otherPlayerId === bob.id);
    expect(bobThread?.lastBody).toBe("hi alice back");
    const carolThread = aliceInbox.find((t) => t.otherPlayerId === carol.id);
    expect(carolThread?.lastBody).toBe("hi alice from carol");

    const bobInbox = await listInbox(bob.id);
    expect(bobInbox).toHaveLength(1);
    expect(bobInbox[0].otherPlayerId).toBe(alice.id);
    expect(bobInbox[0].lastBody).toBe("hi alice back");
  });
});
