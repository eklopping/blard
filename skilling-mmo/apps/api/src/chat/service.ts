import { prisma, ChatChannel } from "@skilling-mmo/db";
import {
  dmThreadKey,
  validateChatBody,
  type ChatMessageDto,
  type ChatInboxThreadDto,
} from "@skilling-mmo/shared";

function toDto(m: {
  id: string;
  channel: ChatChannel;
  senderId: string;
  senderName: string;
  recipientId: string | null;
  threadKey: string | null;
  body: string;
  createdAt: Date;
}): ChatMessageDto {
  return {
    id: m.id,
    channel: m.channel,
    senderId: m.senderId,
    senderName: m.senderName,
    recipientId: m.recipientId,
    threadKey: m.threadKey,
    body: m.body,
    createdAt: m.createdAt.toISOString(),
  };
}

export async function listMutedIds(playerId: string): Promise<string[]> {
  const rows = await prisma.chatMute.findMany({
    where: { playerId },
    select: { mutedPlayerId: true },
  });
  return rows.map((r) => r.mutedPlayerId);
}

export async function addMute(playerId: string, mutedPlayerId: string) {
  if (playerId === mutedPlayerId) throw new Error("cannot_mute_self");
  return prisma.chatMute.create({
    data: { playerId, mutedPlayerId },
  });
}

export async function removeMute(playerId: string, mutedPlayerId: string) {
  return prisma.chatMute.delete({
    where: { playerId_mutedPlayerId: { playerId, mutedPlayerId } },
  });
}

export async function createPublicMessage(input: {
  senderId: string;
  senderName: string;
  body: string;
}): Promise<ChatMessageDto> {
  const v = validateChatBody(input.body);
  if (!v.ok) throw new Error(v.error);
  const row = await prisma.chatMessage.create({
    data: {
      channel: ChatChannel.PUBLIC,
      senderId: input.senderId,
      senderName: input.senderName,
      body: v.body,
    },
  });
  return toDto(row);
}

export async function createDmMessage(input: {
  senderId: string;
  senderName: string;
  recipientId: string;
  body: string;
}): Promise<ChatMessageDto> {
  const v = validateChatBody(input.body);
  if (!v.ok) throw new Error(v.error);
  if (input.senderId === input.recipientId) throw new Error("dm_self");
  const recipient = await prisma.player.findUnique({ where: { id: input.recipientId } });
  if (!recipient) throw new Error("unknown_recipient");
  const threadKey = dmThreadKey(input.senderId, input.recipientId);
  const row = await prisma.chatMessage.create({
    data: {
      channel: ChatChannel.DIRECT,
      senderId: input.senderId,
      senderName: input.senderName,
      recipientId: input.recipientId,
      threadKey,
      body: v.body,
    },
  });
  return toDto(row);
}

export async function listPublicMessages(
  viewerId: string,
  limit: number,
): Promise<ChatMessageDto[]> {
  const muted = await listMutedIds(viewerId);
  const rows = await prisma.chatMessage.findMany({
    where: {
      channel: ChatChannel.PUBLIC,
      ...(muted.length ? { senderId: { notIn: muted } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map(toDto);
}

export async function listDmThread(
  viewerId: string,
  threadKey: string,
  limit: number,
): Promise<ChatMessageDto[]> {
  if (!threadKey.includes(viewerId)) throw new Error("forbidden_thread");
  const muted = await listMutedIds(viewerId);
  const rows = await prisma.chatMessage.findMany({
    where: {
      channel: ChatChannel.DIRECT,
      threadKey,
      ...(muted.length ? { senderId: { notIn: muted } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.reverse().map(toDto);
}

export async function listInbox(playerId: string): Promise<ChatInboxThreadDto[]> {
  const rows = await prisma.chatMessage.findMany({
    where: {
      channel: ChatChannel.DIRECT,
      OR: [{ senderId: playerId }, { recipientId: playerId }],
    },
    orderBy: { createdAt: "desc" },
    take: 200,
  });

  const muted = new Set(await listMutedIds(playerId));
  const seen = new Set<string>();
  const out: ChatInboxThreadDto[] = [];

  for (const m of rows) {
    if (!m.threadKey) continue;
    if (seen.has(m.threadKey)) continue;
    if (muted.has(m.senderId) && m.senderId !== playerId) continue;
    seen.add(m.threadKey);
    const otherPlayerId = m.senderId === playerId ? m.recipientId! : m.senderId;
    const other = await prisma.player.findUnique({ where: { id: otherPlayerId } });
    out.push({
      threadKey: m.threadKey,
      otherPlayerId,
      otherPlayerName: other?.name ?? m.senderName,
      lastBody: m.body,
      lastAt: m.createdAt.toISOString(),
    });
  }
  return out;
}
