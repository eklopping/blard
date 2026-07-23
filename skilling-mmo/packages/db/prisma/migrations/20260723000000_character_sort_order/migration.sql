-- AlterTable
ALTER TABLE "Player" ADD COLUMN IF NOT EXISTS "sortOrder" INTEGER NOT NULL DEFAULT 0;

-- Backfill existing characters by createdAt per account
WITH ordered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "accountId" ORDER BY "createdAt" ASC) - 1 AS rn
  FROM "Player"
)
UPDATE "Player" p
SET "sortOrder" = ordered.rn
FROM ordered
WHERE p.id = ordered.id;
