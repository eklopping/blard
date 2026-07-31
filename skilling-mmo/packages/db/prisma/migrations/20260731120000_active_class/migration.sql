-- Active class selection (dropdown); backfill from starter profession
ALTER TABLE "Player" ADD COLUMN "activeClassId" TEXT NOT NULL DEFAULT 'woodsman';

UPDATE "Player"
SET "activeClassId" = lower("profession"::text);

-- Testing: unlock all classes for existing characters (catch-up XP on next join)
UPDATE "ClassProgress" SET "unlocked" = true;
