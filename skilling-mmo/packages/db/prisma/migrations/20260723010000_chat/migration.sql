-- CreateEnum
CREATE TYPE "ChatChannel" AS ENUM ('PUBLIC', 'DIRECT');

-- CreateTable
CREATE TABLE "ChatMessage" (
    "id" TEXT NOT NULL,
    "channel" "ChatChannel" NOT NULL,
    "senderId" TEXT NOT NULL,
    "recipientId" TEXT,
    "threadKey" TEXT,
    "body" TEXT NOT NULL,
    "senderName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ChatMute" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "mutedPlayerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMute_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatMessage_channel_createdAt_idx" ON "ChatMessage"("channel", "createdAt");
CREATE INDEX "ChatMessage_threadKey_createdAt_idx" ON "ChatMessage"("threadKey", "createdAt");
CREATE INDEX "ChatMessage_recipientId_createdAt_idx" ON "ChatMessage"("recipientId", "createdAt");
CREATE INDEX "ChatMessage_senderId_createdAt_idx" ON "ChatMessage"("senderId", "createdAt");
CREATE INDEX "ChatMute_playerId_idx" ON "ChatMute"("playerId");
CREATE UNIQUE INDEX "ChatMute_playerId_mutedPlayerId_key" ON "ChatMute"("playerId", "mutedPlayerId");

ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMute" ADD CONSTRAINT "ChatMute_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ChatMute" ADD CONSTRAINT "ChatMute_mutedPlayerId_fkey" FOREIGN KEY ("mutedPlayerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;
