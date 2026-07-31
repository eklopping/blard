-- Class progression rows (fed by skill level-ups)
CREATE TABLE "ClassProgress" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 1,
    "xp" INTEGER NOT NULL DEFAULT 0,
    "unlocked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ClassProgress_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClassProgress_playerId_classId_key" ON "ClassProgress"("playerId", "classId");
CREATE INDEX "ClassProgress_playerId_idx" ON "ClassProgress"("playerId");

ALTER TABLE "ClassProgress" ADD CONSTRAINT "ClassProgress_playerId_fkey"
  FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: one row per class per player; starter profession unlocked.
-- Catch-up XP applied on next game-server join from current skill levels.
INSERT INTO "ClassProgress" ("id", "playerId", "classId", "level", "xp", "unlocked")
SELECT
  md5(random()::text || clock_timestamp()::text || p."id" || c.class_id),
  p."id",
  c.class_id,
  1,
  0,
  (lower(p."profession"::text) = c.class_id)
FROM "Player" p
CROSS JOIN (
  VALUES ('woodsman'), ('farmer'), ('miner')
) AS c(class_id);
